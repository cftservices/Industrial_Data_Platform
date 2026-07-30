# Grafana KPI-bevindingen — input voor `batch-engine/vla/kpi.py` (fase 4)

**Datum:** 2026-07-30
**Aanleiding:** het dashboard `vla-mes` is gebouwd als *engineering view* om vast te stellen
wat de data feitelijk ondersteunt. Het is expliciet **niet de bron van waarheid**: geen enkel
scherm en geen enkel rapport leest eruit. KPI's worden in fase 4 op één plek berekend, in
`GET /api/v1/kpi/summary` plus `losses[]` in `report/period`, gevoed door een nieuwe
`batch-engine/vla/kpi.py`.

Dit document legt per KPI vast **welke query nodig was** en, belangrijker, **wat niet
berekenbaar bleek**. Dat tweede is de eigenlijke opbrengst.

---

## Twee bronnen, en wat er in elk zit

| Bron | Bevat | Mist |
|---|---|---|
| **TDengine** `idp.telemetry` (historian) | tijdreeksen per UNS-topic: temperaturen, viscositeit, packs, doseringen, lijn- en equipmentstates | geen batch-context. `batch_id` is een topic, geen tag, dus je kunt een meting niet aan een batch koppelen. Geen verdict, geen order, geen kosten |
| **batch-engine REST** (MongoDB) | orders, batches, doses, verdicts, samples, HU's, equipment-meta, voorraad | geen tijdreeksen. Alles is de huidige stand of een aggregaat over een venster |

Dat verschil is de kern: **een KPI die zowel historie als batch-context nodig heeft, kan
vandaag door geen van beide bronnen alleen worden beantwoord.** Dat is precies het gat dat
`kpi.py` moet dichten.

---

## Per KPI: wat werkte

Alle onderstaande velden zijn geverifieerd tegen de echte respons (36 van 36 JSONPath-velden
resolveerden, nul leeg, nul fout).

| KPI | Endpoint | Pad | Opmerking |
|---|---|---|---|
| Batches in periode | `/report/period?days=N` | `$.batches_total` | bruikbaar |
| Yield % | `/report/period?days=N` | `$.yield_pct` | **definitie discutabel, zie hieronder** |
| Hold/reject-ratio | `/report/period?days=N` | `$.hold_reject_ratio` | bruikbaar |
| Verdictverdeling | `/report/period?days=N` | `$.batches_by_verdict.{APPROVED,HOLD,REJECTED,PENDING}` | bruikbaar |
| Packs geproduceerd | `/inventory` | `$.produced_packs` | **all-time, niet per periode** |
| Volume geproduceerd | `/inventory` | `$.produced_L` | idem |
| Materialen onder bestelniveau | `/inventory` | `$.materials[?(@.below_reorder == true)].material_id` + count | bruikbaar |
| OEE per equipment | `/oee` | `$[*].{equipment_id,availability,performance,quality,oee}` | huidige stand, geen historie |
| Orders | `/orders` | `$[*].{order_id,status,target_qty_L,created_at}` + `$[*].progress.{batched_L,produced_L,produced_packs,progress_pct,batches_count}` | bruikbaar |
| Voorraad & verbruik | `/inventory` | `$.materials[*].{name,category,stock_qty,reorder_level,stock_pct,consumed_total,batches_count}` | `consumed_total` is **all-time** |
| Equipment health / CIP | `/equipment/health` | `$[*].{equipment_id,area,state,batches_since_cip,running_hours}` | bruikbaar |

---

## Wat NIET berekenbaar bleek

Dit is de lijst die `kpi.py` moet adresseren.

### 1. Rejects bestaan niet
`reject_count` wordt in `factory/physics.py` alleen geïnitialiseerd en gereset, nooit
opgehoogd. De waarde is permanent 0, en dus publiceert een data-change-subscription hem
vrijwel nooit (6 rijen in de hele historian). Elke KPI die op afkeur leunt (first-pass yield,
kwaliteitsverlies, verliesbedrag door afkeur) is vandaag onberekenbaar.
**Nodig:** een reject-simulatie in de factory, of afkeur als MES-boeking.

### 2. `yield_pct` deelt appels door peren
De huidige definitie is `packs / planned_L × 100`. Bij een order van 5000 L die 5000 packs
oplevert is dat 100%, maar de historische batches van vóór de volumefix geven 117%. Een
yield boven 100% is per definitie een signaal dat de noemer niet klopt.
**Nodig:** één expliciete definitie in `kpi.py`, met de bedoelde noemer (besteld volume?
gedoseerde massa? theoretische opbrengst uit het recept?) en een bovengrens-check.

### 3. Alles in `/inventory` is all-time, niet per periode
`consumed_total`, `produced_packs` en `produced_L` tellen sinds het begin der tijden. Er is
geen `?days=`-parameter en geen periodefilter. Een KPI-scherm met een periodekiezer toont dus
een getal dat niet met die periode meebeweegt, wat erger is dan geen getal.
**Nodig:** periodefiltering op de consumptie- en productie-aggregatie, of een aparte
`kpi/summary?days=N` die dit per venster berekent uit `dw_doses` en `dw_production` op `ts`.

### 4. Geen enkele KPI heeft historie
De REST geeft alleen de huidige stand. Je kunt vandaag geen "OEE-verloop over 30 dagen" of
"yield per week" tekenen: er is geen tijdreeks van KPI's, en de historian kent de
batch-context niet om ze achteraf te reconstrueren.
**Nodig:** ofwel `kpi/summary` per periode-emmer laten teruggeven (`buckets[]`), ofwel
periodiek een KPI-snapshot wegschrijven.

### 5. Geen kosten, dus geen verliesbedrag
Nergens in het datamodel staat een prijs: niet op `dw_materials`, niet op het recept, niet op
de order. Het "verliesbedrag" uit scherm 12 is met de huidige data niet te berekenen.
**Nodig:** een kostprijs per materiaal en per pack, plus een definitie van welke verliezen
meetellen (overdosering, afkeur, niet-gevulde ordervolumes, stilstand).

### 6. Overdosering is wel berekenbaar, maar wordt nergens gepresenteerd
`GET /orders/{id}` geeft sinds gisteren `consumption[]` met `qty_target`, `qty_actual`,
`delta` en `delta_pct` per materiaal. Dat is de bouwsteen voor materiaalverlies, maar alleen
per order, niet plant-breed of per periode.
**Nodig:** dezelfde rollup over een tijdvenster in plaats van over één order.

### 7. Batch-context ontbreekt in de historian
`batch_id` is een topic (`DairyWorks/Vla/Batch/Status/batch_id`), geen TDengine-tag. Je kunt
dus geen `GROUP BY batch_id` doen en geen meting aan een batch koppelen zonder in de
applicatie op tijdvensters te joinen.
**Nodig, als batch-gebonden tijdreeks-KPI's ooit gewenst zijn:** `batch_id` als tag in het
bridge-schema, wat een schemawijziging op `idp.telemetry` betekent.

### 8. Ingest-tijd in plaats van brontijd
`tdengine-poc/bridge.py` schrijft `int(time.time()*1000)`, dus het moment waarop de bridge de
MQTT-boodschap verwerkte, niet de OPC UA source-timestamp. Bij fases van 30 s is de afwijking
(~1 s) verwaarloosbaar, maar voor een KPI die duur meet (bijvoorbeeld exacte faseduur of
doorlooptijd) is het een systematische fout die bij een backlog of reconnect groter wordt.

---

## Wat Grafana wél goed doet, en dus mag blijven

Het dashboard **`vla-line`** (uid `vla-line`) is de ad-hoc analysesurface: tijdreeksen uit de
historian, een state-timeline over zes uur, temperatuur- en viscositeitsverloop, dosering en
vulling. Dat is exact waar Grafana sterk in is en het rekent geen enkele KPI uit; het toont
gemeten waarden. Dat dashboard is de bron voor scherm 5.

`vla-mes` blijft staan als engineering view met een waarschuwingsbanner bovenaan, buiten de
KPI-keten om.
