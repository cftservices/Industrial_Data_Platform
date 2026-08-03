# Vendor-eilanden: Connect, Condition, Model

> De vla-demo was één OPC-UA server. Technisch netjes, maar het demonstreerde de
> stelling niet: een fabriek waar niets los staat bewijst niet dat losstaande
> systemen het probleem zijn. Deze uitbreiding zet gesimuleerde leveranciers-
> systemen naast de lijn-PLC, elk een echt eiland, en bouwt daarna de laag die ze
> ordent, schoonmaakt en modelleert.
>
> **De milkdemo blijft ongewijzigd.** Alles hier zit achter compose-profile
> `vendor`. Zonder die vlag start exact dezelfde acht services als voorheen.

---

## 1. In één plaatje

```
  vla-factory (lijn-PLC)          vla-vendor-opcda            vla-vendor-opcua
  ns=2, urn:dairyworks            ns=2, urn:datunnel          ns=2, urn:vendorline
        |                               |                            |
        | native OPC-UA ingest          | (DA/UA-tunneller)          |
        v                               v                            v
   DairyWorks/Vla/#              raw/vla/{systeem}/{native item}
   (de schone UNS)                      |
        |                               v
        |                        vla-conditioner
        |                        Condition -> Model
        |                               |
        +-------------------------------+
                                        v
                            DairyWorks/Vla/{Area}/{Equipment}/Status/{tag}
                            DairyWorks/Vla/DataQuality/cross-check-01/Status/#
                                        |
                                        v
                     TDengine-bridge -> TDengine -> Grafana / batch-engine / UI
```

**TDengine spreekt nooit een fabrieksprotocol.** De data-in connectoren van
TDengine (taosX) zijn Enterprise; de OSS-editie kan alleen line protocol,
OpenTSDB, SQL en REST. Daarom vertaalt de bestaande `tdengine-poc/bridge.py` zelf
MQTT naar line protocol, ná Condition en Model. Dat is precies de stelling: de
data layer is wat een historian mogelijk maakt. Zonder Model zou je 31
betekenisloze reeksen wegschrijven.

---

## 2. De eilanden

Negen systemen, 41 punten, drie protocollen. Alles generiek: `vendor-a` t/m
`vendor-f`, geen merknamen, geen modelnummers, geen echte IP's (PR-15).

| Systeem | Area | Protocol | Punten | Waarom het er staat |
|---|---|---|---|---|
| `pasteuriser-01` | Cook | OPC-DA | 5 | **Conflict 3.** Holdbuis vs kooktemperatuur: veiligheidsdossier tegen procesdossier |
| `intake-skid-01` | Receiving | OPC-DA | 4 | **Conflict 1.** Totalisator vs tankniveau: goederenontvangst tegen procesbeeld |
| `dosing-station-01` | Mixing | OPC-DA | 5 | **Conflict 2.** Gecertificeerde weegschaal tegen flow-schatting |
| `chiller-01` | Cooling | OPC-DA | 5 | Alarm-bitfield als kwaliteitsbron |
| `homogeniser-01` | Mixing | OPC-UA | 6 | **Het bewijs dat OPC-UA niet de data layer is** |
| `cip-station-01` | Utilities | OPC-UA | 6 | Utility op eigen schema, voedt de bestaande CIP-gate |
| `lims-01` | Utilities | SQL Server | 3 | **Het paar sluit.** Levert de meting bij `fat_setpoint_pct` |
| `cmms-01` | Utilities | SQL Server | 4 | **De pure alias-les.** `CK-UNIT-1` is `cook-unit-01` |
| `ems-01` | Utilities | SQL Server | 3 | Lokale tijd zonder zone, en het sluit kosten-per-batch |

### SQL Server: de silo zonder technisch excuus

MonsterMQ heeft geen SQL-**bron**connector (`jdbcLogger` en verwanten zijn sinks),
dus `vla-vendor-gateway` pollt deze en publiceert op dezelfde raw-root als de rest.
Condition en Model weten daardoor niet welk protocol een meting binnenkwam.

Deze drie tellen het zwaarst, juist omdat er geen protocolgat is om de schuld aan
te geven. De data staat in een database, in een modern formaat, met een prima
query-interface. En hij is onzichtbaar voor de fabriek, omdat niemand hem heeft
gekoppeld.

**`lims-01` is het scherpste van de hele demo, in één regel.** De lijn publiceert
`receiving-tank-01/fat_setpoint_pct`: een target zonder meting. Die meting bestaat
wel, elke batch, en staat in een database die niemand heeft aangesloten. Canon
`06-Model §B.2b`: target en actual bestaan altijd als **paar**. De helft van dit
paar is al die tijd onzichtbaar geweest.

Let op waar de canonieke tag landt: op `receiving-tank-01`, niet op `lims-01`.
Een labsysteem bezit geen meting, het *rapporteert* er een over een asset.
Wegschrijven onder het lab zou het paar gescheiden houden, en dat is de bug.

### OPC-DA: wees eerlijk over wat dit is

OPC-DA is DCOM, draait alleen op Windows, en **wij hebben het niet
geïmplementeerd**. Wat we simuleren is hoe je een DA-eiland in de praktijk
bereikt vanaf een Linux-datalaag: een DA-server achter een DA/UA-tunneller, en
wij verbinden met het UA-endpoint van die tunneller.

Het transport is dus UA. De **data** is DA, en dat is wat telt:

- platte ItemID's zonder hiërarchie: `Ch1.Dev2.TT_3003_PV`
- het DA-qualityword als apart companion-item (192 GOOD, 64 UNCERTAIN, 0 BAD), niet als UA StatusCode
- geen source-timestamp per item, dus je krijgt alleen aankomsttijd
- geschaalde integers, want de registers eronder zijn integers

Zeg dit hardop in de demo. Claimen dat je DCOM hebt gebouwd is precies het soort
ding waar het publiek dat je wilt overtuigen op controleert.

### Namespace-index is per server

Zowel de fabriek als beide vendor-servers gebruiken `ns=2`. Dat is geen botsing:
namespace-indices zijn per server, niet globaal. Het maakt het punt sterker dan
een ander nummer zou doen. **`ns=2;s=X` is geen identiteit.** Dezelfde string
adresseert twee volstrekt losstaande dingen, afhankelijk van welk endpoint je hem
naartoe stuurde. Daarom moet de Model-stap een eigen stabiele identiteit uitgeven.

De servers **weigeren te starten** als hun index afwijkt van wat het model zegt.
De fabriek logt alleen een waarschuwing; deze eilanden niet, want de gegenereerde
adreslijst hardcodeert de index en zou er stilzwijgend naast grijpen.

---

## 3. Waarom raw buiten de UNS landt

Root is `raw/vla/{systeem}/{native item}`, met opzet **niet** onder `DairyWorks/`.

1. **Concreet:** archive-group `dairyworks_data` matcht `DairyWorks/#`. Alles wat
   daar staat wordt stil naar MongoDB gearchiveerd. Raw vendor-tags daar parkeren
   zou een data-swamp aanleggen binnen de demo die data-swamps veroordeelt.
2. **Retorisch:** in een topic-browser wijst de presentator naar twee bomen. De
   ene is een gemodelleerde fabriek. De andere is een rommella. Dat contrast ís
   de demo.

`raw/vla/#` staat daarom in **geen enkele** archive-group en niet in
`MQTT_TOPICS` van de TDengine-bridge. Ongemodelleerde data wordt niet opgeslagen.

> Eén uitzondering, standaard uit: zet archive-group `dw_raw_swamp` aan om te
> laten zien hoe een lake zonder model eruitziet. Kost niets als hij uit staat.

### De payload is geen contract

Er is geen enkele raw-payloadvorm, en dat is geen slordigheid. MonsterMQ's
OPC-UA-client publiceert `{value, timestamp, status}`. Het UNS-contract is
`{value, unit, ts, quality}`. Die sluiten niet op elkaar aan: andere sleutels,
geen eenheid, en een numerieke StatusCode waar het contract GOOD/BAD/UNCERTAIN
wil. **De Condition-stap is dus structureel verplicht, geen luxe.**

---

## 4. Condition en Model

`vla-conditioner` is een eigen service, geen broker-config. MonsterMQ's
flow-engine bewaart regels in Mongo, dus de transformatielogica zou niet in git
staan. Dat breekt versiebeheer, de eerste DataOps-discipline, en is niet offline
testbaar. NiFi wil ~1,5 GB heap. Node-RED is verboden.

> **De broker doet wat configuratie is, deze service doet wat logica is, want
> logica moet je in een diff kunnen reviewen.** Een conversie die je niet in een
> git-diff ziet, kun je niet auditen, en in voedselproductie is audit het punt.

Wat Condition moet repareren, en wat nergens in de payload staat:

| Probleem | Waar de oplossing vandaan komt |
|---|---|
| 1904 is tienden, geen eenheden | `scale` in `conditioning.json` |
| en het is Fahrenheit, geen Celsius | `native_unit` -> `canonical_unit` |
| kwaliteit staat in een **ander topic** (`.Q`) | `quality_source: da-quality-word` |
| een StatusCode is severity-bits, geen boolean | `quality_source: opcua-statuscode` |
| een DA-item heeft **geen meettijd** | `timestamp_source: none` -> `ts_source: receive` |
| lokale tijd zonder zone | `assume_tz`, gedeclareerd, nooit geraden |
| één tag verzuipt de historian | `deadband` |

Ontbrekende DA-kwaliteit is **UNCERTAIN**, nooit een aangenomen GOOD. Een
niet-numerieke waarde wordt geweigerd, nooit naar 0 gedwongen. Stilte is stale,
geen nul.

### De alias-tabel

`aliases.json` en `conditioning.json` worden **gegenereerd** uit
`source-systems.json`, dus de alias-tabel kan niet uit de pas lopen met de
eilanden die hij mapt.

`canonical_signal_uuid` is uuid5 over de canonieke tag-id, dus de identiteit is
stabiel wanneer een **leverancier** zijn item hernoemt: de historian houdt één
doorlopende reeks in plaats van stilletjes een tweede te beginnen. Een rij met
`retired_at` resolvet nog wel bij lezen maar publiceert niet meer, en dát maakt
een hernoeming bovenstrooms een non-event.

---

## 5. De conflicten

Twee systemen die hetzelfde meten zijn het oneens. De goedkope opties zijn er één
stil kiezen of middelen, en allebei zijn fout: stil kiezen is wat vandaag gebeurt
en niemand weet dat er gekozen is, en een gemiddelde is een getal dat geen enkel
instrument ooit gemeten heeft.

Dus: precies één bron is `of_record`, de ander blijft publiceren onder zijn eigen
equipment, en de laag publiceert het **verschil** als eigen signaal plus een
alarm buiten tolerantie.

| Check | Tolerantie | Van record voor |
|---|---|---|
| `XC-COOK-TEMP` | 1,5 °C | pasteur = wettelijk pasteurisatiedossier, lijn = viscositeitsmodel |
| `XC-STARCH-DOSE` | 2,5 kg | weegstation = batchrapport en etiket, lijn = live procesbesturing |
| `XC-INTAKE-VOLUME` | `delta_only` | totalisator = goederenontvangst, niveau = wat er nu in de tank zit |

`XC-INTAKE-VOLUME` alarmeert bewust niet: een totalisator en een niveau zijn niet
dezelfde grootheid, dus een divergentie-alarm zou een vals alarm zijn, en dat is
exact de fout die deze demo elders bekritiseert.

**De scherpste:** draai `cook_undertemp` op magnitude 0,65. De lijn leest 76,3 °C
→ ~110 cP → onder de 150 cP spec → de batch moet vast. Het skid leest 77,1 °C →
boven de wettelijke 72 °C → het **veiligheidsdossier is schoon**. Veilig om te
eten én buiten specificatie, tegelijk. De fabriek heeft beide antwoorden nodig en
ziet er vandaag één.

---

## 6. Draaien

```bash
# vanuit de idp-os root

# de milkdemo zoals altijd, ongewijzigd
docker compose -f docker-compose.slim.yml \
               -f scenarios/vla-batch/docker-compose.vla.yml up -d --build

# mét de vendor-eilanden en de conditioner
docker compose -f docker-compose.slim.yml \
               -f scenarios/vla-batch/docker-compose.vla.yml \
               --profile vendor up -d --build

# raw komt binnen (rommel)
mosquitto_sub -h localhost -t 'raw/vla/#' -C 20

# de UNS blijft schoon (betekenis)
mosquitto_sub -h localhost -t 'DairyWorks/Vla/Cook/pasteuriser-01/Status/#' -C 5
mosquitto_sub -h localhost -t 'DairyWorks/Vla/DataQuality/#' -C 5

# status van de laag
curl -s http://localhost:8080/api/v1/status   # binnen het netwerk: vla-conditioner:8080
```

### De aan/uit-schakelaar

```bash
# Model-laag uit: raw blijft stromen, de UNS valt stil, Grafana en de UI lopen leeg
curl -XPOST http://vla-conditioner:8080/api/v1/model-layer -d '{"enabled":false}'

# en weer aan
curl -XPOST http://vla-conditioner:8080/api/v1/model-layer -d '{"enabled":true}'
```

Tien seconden, en het hele argument. Bewust een vlag en geen container-stop,
want opstarttijd verpest het moment.

### Alles offline verifiëren

```bash
python tools/gen-connect.py --check      # geen drift tussen model en artefacten
python vendor-sim/selftest.py            # eilanden, vervorming, het conflict
python conditioner/selftest.py           # Condition, Model, cross-checks
python vendor-gateway/selftest.py        # de SQL-mapping, met sqlite als stand-in
python factory/selftest.py               # de physics
python batch-engine/selftest.py          # de MES-laag
```

Geen broker, geen Mongo, geen netwerk. Offline-first is niet onderhandelbaar.

---

## 7. Een eiland toevoegen

1. Voeg een blok toe aan `factory-model/source-systems.json`: `id`,
   `equipment_id`, `area`, `protocol`, `endpoint`, `device_name`, `raw_prefix`,
   en per punt `native`, `native_unit`, `native_scale`, `canonical_tag_id`,
   `condition_rule` en een `distortion`.
2. `python tools/gen-connect.py` genereert het MonsterMQ init-script, de
   alias-tabel en de conditioning-regels.
3. `python vendor-sim/selftest.py` controleert dat elk punt afleidbaar en
   encodeerbaar is. Deze check bestaat omdat een ontbrekende L-naar-gal-conversie
   ooit een heel eiland omlegde bij de eerste scan.
4. Compose-service erbij met `profiles: ["vendor"]`.

**Alle getallen in een `distortion` staan in de CANONIEKE (SI) eenheid**, nooit
in die van de leverancier. De conversie gebeurt daarna. Door elkaar halen levert
een plausibel getal op dat er een factor 3,8 naast zit, en dat is precies de
klasse fouten waar deze demo over gaat.

---

## 8. Wat hier nog niet staat

Eerlijk, zodat niemand ernaar zoekt:

- **MQTT-eiland** (`checkweigher-01` met PackML, `case-packer-01` met Sparkplug B)
  op een eigen broker. Zou de per-kop vulgewichten leveren die
  `frontend-uiux-spec.md §13` al tekent en die niets in de stack vandaag maakt.
- **UI-schermen**: de Connect-kaart en het kwaliteitsscherm in `vla-ui`, plus
  Grafana-panelen op de nieuwe topics.
- **Datalayer-docs** in `project-os/projects/datalayer`: PR-42 t/m PR-47, UC17
  t/m UC20, en de Connect/Condition/Model-sectie in `05-Backend`.

Modbus en S7 zijn bewust weggelaten (protocolkeuze: OPC-UA, OPC-DA, MQTT, SQL
Server), maar MonsterMQ's `plc4xDevice` ondersteunt bevestigd `MODBUS_TCP`,
`MODBUS_RTU`, `S7`, `ADS`, `ETHERNET_IP` en `BACNET_IP`. Toevoegen is later één
regel in `source-systems.json` plus een gegenereerd init-script, geen herbouw.
Dat is een sterk antwoord op "maar onze lijn draait op een ander merk PLC".
