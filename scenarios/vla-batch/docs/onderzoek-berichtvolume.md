# Openstaand: het berichtvolume van het park

> Status op 2026-08-09: **niet opgelost.** Twee hypotheses zijn hard uitgesloten,
> de derde is aangewezen maar niet bewezen. Dit moet af vóór de volgende uitrol,
> want bij twaalf machines bepaalt het of het park op de VPS past.

## De waarneming

Gemeten op de VPS met `park-slim` (vier machines, waarvan twee via OPC UA):

```
raw/vla-park/#         6,0 msg/s     klopt met het budget
DairyWorks/Vla-B/#   196,2 msg/s     ~4x te hoog, budget was ~50
```

Per topic uitgesplitst over 12 seconden:

```
326  DairyWorks/Vla-B/pasteuriser-01/Ch1.Dev1.TT_2049_PV     = 27 Hz
280  DairyWorks/Vla-B/pasteuriser-01/Ch1.Dev1.TT_2042_PV
258  DairyWorks/Vla-B/pasteuriser-01/Ch1.Dev1.TT_2056_PV
223  DairyWorks/Vla-B/separator-01/Machine.Process.Rpm
212  DairyWorks/Vla-B/separator-01/Machine.Process.FatPct
```

`TT_2049_PV` is `temp_out_C`, sampling-klasse `fast`, dus **1 Hz** volgens het
model. Gemeten: 27 Hz.

Let op dat deze topics onder `DairyWorks/` staan. Dat was een tweede, losstaande
fout (device-namespace) en is inmiddels gecorrigeerd naar `raw/vla-park`, met een
gate in `tools/check-generated.sh`. Het volume-probleem staat daar los van.

## Hypothese 1: dubbele registraties — UITGESLOTEN

`init-park.sh` is drie keer gedraaid terwijl het "bestaat al"-patroon nog kapot
was, dus dubbel toegevoegde adressen waren aannemelijk. Gemeten in
`idp.deviceconfigs`:

```
intake-silo-01    60 adressen, unieke 60, DUBBEL 0
separator-01      30 adressen, unieke 30, DUBBEL 0
pasteuriser-01    60 adressen, unieke 60, DUBBEL 0
```

60 = 30 signalen + 30 `.Q`-companions voor vendor-a; 30 voor vendor-b, die geen
companions heeft. Precies zoals bedoeld, geen duplicaten.

## Hypothese 2: OPC-UA samplingInterval — UITGESLOTEN

MonsterMQ zet `subscriptionSamplingInterval: 1000`, maar de per-item
`monitoringParameters.samplingInterval` staat default op `0.0`, en 0 betekent in
OPC UA "zo snel als de server aankan". Dat leek de dader.

Gemeten met een gecontroleerd experiment: de pasteur lokaal gedraaid met zijn
OPC-UA-oppervlak, tegelijk geteld hoe vaak de SIM naar een node schrijft en
hoeveel notificaties een echte asyncua-client terugkrijgt.

```
samplingInterval 0      sim 1,00/s   client 0,92/s   verhouding 0,9x
samplingInterval 1000   sim 1,00/s   client 1,00/s   verhouding 1,0x
```

Een op een, in beide gevallen. De sim schrijft niet te vaak en het protocol
meldt niet te vaak. De instelling maakt geen verschil.

Script: `scratchpad/rate_experiment.py` uit de sessie van 2026-08-09; de kern is
twee tellers over hetzelfde venster, een aan de schrijfkant en een aan de
subscription-kant.

## Hypothese 3: MonsterMQ's eigen OPC-UA-client — AANGEWEZEN, NIET BEWEZEN

Wat overblijft. Het lokale experiment gebruikte een **asyncua**-client; MonsterMQ
gebruikt zijn eigen implementatie (Eclipse Milo, Kotlin). Als die per
sample-cyclus publiceert in plaats van per verandering, dan levert 30 tags op
1 Hz al 30 msg/s per device op, en met de `.Q`-companions het dubbele.

Dat verklaart de ORDE van grootte (114-196 msg/s over twee OPC-devices) maar
niet de 27 Hz op een enkele tag. Er ontbreekt dus nog een stap.

## Hoe je het afmaakt

Het lokale experiment kan dit niet beantwoorden: je hebt MonsterMQ zelf nodig.

1. Start **een** OPC-UA-machine plus MonsterMQ, verder niets.
2. Tel tegelijk drie dingen over hetzelfde venster: hoe vaak de sim naar de node
   schrijft, hoeveel notificaties MonsterMQ van de OPC-UA-server krijgt (uit
   `docker logs monstermq` op debug), en hoeveel MQTT-berichten er uitgaan.
3. Herhaal met `publishMode: SINGLE` in plaats van `SEPARATE` op de adressen; dat
   is de enige adres-optie in het schema die het gedrag kan verklaren.

Doe dit met EEN machine. Twaalf machines erbij zetten om een volume-vraag te
beantwoorden is dezelfde fout als deze demo elders bekritiseert.

## Wat er ondertussen geldt

De drie bevindingen uit de go/no-go van 2026-08-09 zijn wel verwerkt:
geheugenlimiet 192m voor OPC-machines (asyncua zat op 96% van 96m), een throttle
van 5 s op cross-check-delta's, en de raw-namespace. `park-slim` draaide met
0 ongemapte topics en een correct werkende Condition/Model-laag; het volume is
het enige dat een uitrol van twaalf machines nu blokkeert.
