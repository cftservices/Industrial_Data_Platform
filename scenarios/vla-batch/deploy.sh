#!/usr/bin/env bash
# ============================================================================
# Vla Batch v2 demo — VPS deploy / verify helper (run ON the Ubuntu VPS)
# ============================================================================
# Brings up the slim-base + vla-batch overlay, waits for MonsterMQ, lets the
# one-shot `vla-opcua-init` register the native OPC-UA device, and verifies the
# end-to-end path (factory -> MonsterMQ UNS -> TDengine + batch-engine).
#
# Usage (from the idp-os root, i.e. the dir with docker-compose.slim.yml):
#   ./scenarios/vla-batch/deploy.sh up        # build + start the stack (default)
#   ./scenarios/vla-batch/deploy.sh verify    # health + UNS-flow + device checks
#   ./scenarios/vla-batch/deploy.sh vendor    # de leverancierseilanden + Condition/Model
#   ./scenarios/vla-batch/deploy.sh vendor-sql  # alleen het SQL-eiland (zwaarste component)
#   ./scenarios/vla-batch/deploy.sh smoke     # run one demo batch via the API
#   ./scenarios/vla-batch/deploy.sh fallback  # switch ingest to the connector
#   ./scenarios/vla-batch/deploy.sh logs [svc]
#   ./scenarios/vla-batch/deploy.sh down      # stop (keeps volumes)
#
# Requires: docker + docker compose v2, a filled ./.env (see .env.example).
# ----------------------------------------------------------------------------
set -euo pipefail

SLIM="docker-compose.slim.yml"
VLA="scenarios/vla-batch/docker-compose.vla.yml"
NET="idp-network"
# Optionele extra overlay (bv. docker-compose.vps-shared.yml op een gedeelde
# VPS met host-nginx). Zet VLA_EXTRA_COMPOSE naar het pad van de overlay.
EXTRA="${VLA_EXTRA_COMPOSE:-}"
DC="docker compose -f $SLIM -f $VLA${EXTRA:+ -f $EXTRA}"

c_g(){ printf "\033[32m%s\033[0m\n" "$*"; }
c_y(){ printf "\033[33m%s\033[0m\n" "$*"; }
c_r(){ printf "\033[31m%s\033[0m\n" "$*"; }
hr(){ printf -- "----------------------------------------------------------------\n"; }

# Ephemeral helpers that join the internal network (image tools, not host tools)
# usage: curl_net <timeout-seconds> <curl-args...>
curl_net(){ local t="$1"; shift; docker run --rm --network "$NET" curlimages/curl:latest -s --max-time "$t" "$@" 2>/dev/null || true; }
gql(){ docker run --rm --network "$NET" curlimages/curl:latest -s --max-time 10 \
        -X POST http://monstermq:4000/graphql -H 'Content-Type: application/json' \
        -d "{\"query\":\"$1\"}" 2>/dev/null || true; }

require(){
  command -v docker >/dev/null || { c_r "docker niet gevonden — installeer Docker Engine."; exit 1; }
  docker compose version >/dev/null 2>&1 || { c_r "docker compose v2 niet gevonden."; exit 1; }
  [ -f "$SLIM" ] || { c_r "Run dit script vanuit de idp-os root (mist $SLIM)."; exit 1; }
  [ -f .env ] || { c_r "Geen .env — kopieer scenarios/vla-batch/.env.example naar ./.env en vul in."; exit 1; }
  if grep -q "replace_with_real_bcrypt_hash" .env; then
    c_r "DASHBOARD_AUTH staat nog op de placeholder — genereer een echte hash:"
    c_y "   htpasswd -nbB demo 'sterk-wachtwoord'   (verdubbel elke \$ naar \$\$ in .env)"; exit 1
  fi
  if grep -qE "TRAEFIK_ACME_EMAIL=your@email.com" .env; then
    c_y "WAARSCHUWING: TRAEFIK_ACME_EMAIL staat nog op de placeholder (Let's Encrypt cert kan falen)."
  fi
  check_generated
}

# The OPC-UA address space, the MonsterMQ ingest list and the fallback connector
# tables are all generated from factory-model/isa95-vla.json. Deploying a stack
# whose generated files lag behind the model is how tags silently stop reaching
# the UNS, so refuse to build. Pure file I/O: no broker, no network.
check_generated(){
  command -v python3 >/dev/null || return 0
  if ! python3 scenarios/vla-batch/tools/gen-connect.py --check; then
    c_r "Gegenereerde connect-bestanden lopen achter op factory-model/isa95-vla.json."
    c_y "   Draai:  python3 scenarios/vla-batch/tools/gen-connect.py   en commit het resultaat."
    exit 1
  fi
}

wait_monstermq(){
  c_y "Wachten tot MonsterMQ (:4000) er is..."
  for i in $(seq 1 40); do
    [ -n "$(curl_net 3 http://monstermq:4000/)" ] && { c_g "MonsterMQ is up."; return 0; }
    sleep 3
  done
  c_r "MonsterMQ kwam niet online binnen ~2 min — check: $DC logs monstermq"; return 1
}

cmd_up(){
  require
  hr; c_y "Stack starten (build)..."; hr
  $DC up -d --build
  wait_monstermq
  c_y "De one-shot 'vla-opcua-init' registreert nu het OPC-UA-device in MonsterMQ..."
  sleep 8
  cmd_verify || c_y "Verify nog niet volledig groen — geef het ~30s en draai opnieuw: $0 verify"
  hr; c_g "Klaar. URLs:"
  local dom; dom=$(grep -E '^DOMAIN=' .env | cut -d= -f2)
  echo "  Dashboard : https://milkdemo.${dom}   (basic-auth)"
  echo "  Grafana   : https://grafana.${dom}"
  hr
}

cmd_verify(){
  require; local ok=1
  hr; c_y "1) Container-status"; hr
  $DC ps
  hr; c_y "2) OPC-UA device geregistreerd in MonsterMQ?"; hr
  local dev; dev=$(gql "{opcUaDevices{name enabled}}")
  echo "$dev"
  echo "$dev" | grep -q '"vla"' && c_g "  device 'vla' aanwezig." || { c_r "  device 'vla' NIET gevonden — init-container gefaald? ($DC logs vla-opcua-init)"; ok=0; }
  hr; c_y "3) batch-engine health"; hr
  local h; h=$(curl_net 8 http://vla-batch-engine:8000/api/v1/health)
  echo "  $h"; echo "$h" | grep -q '"ok"' && c_g "  batch-engine gezond." || { c_r "  batch-engine niet gezond."; ok=0; }
  hr; c_y "4) UNS-flow: publiceert MonsterMQ DairyWorks/Vla/# ? (5 msgs, 12s)"; hr
  local uns; uns=$(docker run --rm --network "$NET" eclipse-mosquitto:latest \
        mosquitto_sub -h monstermq -t 'DairyWorks/Vla/#' -C 5 -W 12 -v 2>/dev/null || true)
  if [ -n "$uns" ]; then c_g "  UNS stroomt:"; echo "$uns" | sed 's/^/    /'; else
    c_r "  GEEN UNS-berichten. Waarschijnlijk de OPC-UA ns-index (asyncua ns=2)."
    c_y "     -> Check: $DC logs vla-factory | grep -i namespace   en   $DC logs monstermq | grep -i opcua"
    c_y "     -> Werkt native niet? Gebruik de fallback-connector:  $0 fallback"
    ok=0
  fi
  hr; c_y "5) TDengine historian gevuld?"; hr
  local tdpass; tdpass=$(grep -E '^TD_PASS=' .env 2>/dev/null | cut -d= -f2-); tdpass="${tdpass:-taosdata}"
  local td; td=$(curl_net 8 -u "root:${tdpass}" -d 'select count(*) from idp.telemetry' http://vla-tdengine:6041/rest/sql)
  echo "  $td"; echo "$td" | grep -q '"code":0' && c_g "  TDengine bereikbaar." || c_y "  TDengine nog geen data (kan even duren, of geen UNS-flow)."
  hr; [ "$ok" = 1 ] && c_g "VERIFY: primaire pad OK." || c_r "VERIFY: aandachtspunten hierboven (zie ns-index / fallback)."
  return 0
}

# ---------------------------------------------------------------------------
# Vendor-eilanden: Connect -> Condition -> Model
# ---------------------------------------------------------------------------
# Het primaire pad (cmd_verify) blijft ongemoeid. Dit is een APART commando,
# want de eilanden draaien achter --profile vendor en horen de bestaande verify
# niet rood te maken als dat profile uit staat.
#
# Drie koppelvlakken zijn nooit buiten een container getest en dit commando is
# er precies voor:
#   * leest MonsterMQ de DA/UA-tunneller op ns=2 (de ns-index-aanname)
#   * ziet de conditioner raw en publiceert hij op de UNS
#   * praat de gateway TDS met SQL Server (alleen met --profile vendor-sql)
#
# Plus twee regressies die stil blijven als je er niet naar kijkt:
#   * de archive-val: raw/vla/# mag NOOIT in idp.dairyworks_data landen
#   * de cardinaliteit: de bridge maakt een sub-table PER TOPIC
cmd_vendor(){
  require; local ok=1
  local DCV="$DC --profile vendor"

  hr; c_y "1) Vendor-containers"; hr
  $DCV ps vla-vendor-opcda vla-vendor-opcua vla-conditioner 2>/dev/null || true

  hr; c_y "2) Vendor-devices geregistreerd in MonsterMQ?"; hr
  local dev; dev=$(gql "{opcUaDevices{name enabled}}")
  echo "$dev"
  for d in vendor-da vendor-ua; do
    if echo "$dev" | grep -q "\"$d\""; then c_g "  device '$d' aanwezig."
    else c_r "  device '$d' NIET gevonden — check: $DCV logs vla-vendor-${d#vendor-}-init"; ok=0; fi
  done

  hr; c_y "3) Stroomt raw/vla/# ? (8 msgs, 15s)"; hr
  local raw; raw=$(docker run --rm --network "$NET" eclipse-mosquitto:latest \
        mosquitto_sub -h monstermq -t 'raw/vla/#' -C 8 -W 15 -v 2>/dev/null || true)
  if [ -n "$raw" ]; then
    c_g "  raw stroomt (en is met opzet onleesbaar):"; echo "$raw" | sed 's/^/    /'
  else
    c_r "  GEEN raw-berichten. Meest waarschijnlijk de ns-index-aanname."
    c_y "     -> $DCV logs vla-vendor-opcda | grep -i namespace"
    c_y "     -> $DC logs monstermq | grep -i opcua"
    ok=0
  fi

  hr; c_y "4) Conditioner: draait de Model-laag?"; hr
  local st; st=$(curl_net 8 http://vla-conditioner:8080/api/v1/status)
  echo "  $st"
  if echo "$st" | grep -q '"model_layer_enabled":true'; then
    c_g "  Model-laag aan."
    echo "$st" | grep -q '"published":0' && { c_y "  maar published=0: er is nog niets doorgezet."; ok=0; }
  else
    c_r "  conditioner niet bereikbaar of laag uit."; ok=0
  fi

  hr; c_y "5) Komt er gemodelleerde vendor-data op de UNS? (5 msgs, 15s)"; hr
  local uns; uns=$(docker run --rm --network "$NET" eclipse-mosquitto:latest \
        mosquitto_sub -h monstermq -t 'DairyWorks/Vla/Cook/pasteuriser-01/Status/#' \
        -t 'DairyWorks/Vla/DataQuality/#' -C 5 -W 15 -v 2>/dev/null || true)
  if [ -n "$uns" ]; then c_g "  gemodelleerd:"; echo "$uns" | sed 's/^/    /'
  else c_r "  niets op de UNS vanuit de eilanden. Zie stap 3 en 4."; ok=0; fi

  hr; c_y "6) REGRESSIE: raw mag NIET gearchiveerd worden"; hr
  # archive-group dairyworks_data matcht DairyWorks/#. Belandt raw daar ooit,
  # dan bouwt deze demo de data-swamp die hij veroordeelt. Twee metingen met 30s
  # ertussen: het aantal mag stijgen door de LIJN, niet door raw/vla.
  local mongo_count
  mongo_count(){ docker exec mongo mongosh --quiet idp --eval \
      "db.getCollection('dairyworks_data').countDocuments({topic:/^raw\\/vla/})" 2>/dev/null || echo "n/a"; }
  local a; a=$(mongo_count)
  if [ "$a" = "n/a" ]; then
    c_y "  kon Mongo niet bevragen (container heet anders?), check handmatig:"
    c_y "     db.dairyworks_data.countDocuments({topic:/^raw\\/vla/})   moet 0 zijn"
  elif [ "$a" = "0" ]; then
    c_g "  0 raw-documenten in idp.dairyworks_data. Goed: raw wordt niet opgeslagen."
  else
    c_r "  $a raw-documenten in het archief. De raw-root lekt DairyWorks/# in."; ok=0
  fi

  hr; c_y "7) CARDINALITEIT: sub-tables in TDengine"; hr
  # tdengine-poc/bridge.py maakt EEN SUB-TABLE PER TOPIC. Deze stack is hier al
  # een keer door omgevallen (agitator_rpm: 5,34 van 5,35 miljoen rijen), dus
  # leg de baseline vast voordat je uitbreidt.
  local tdpass; tdpass=$(grep -E '^TD_PASS=' .env 2>/dev/null | cut -d= -f2-); tdpass="${tdpass:-taosdata}"
  local n; n=$(curl_net 8 -u "root:${tdpass}" \
      -d "select count(*) from information_schema.ins_tables where db_name='idp'" \
      http://vla-tdengine:6041/rest/sql)
  echo "  $n"
  c_y "  Noteer dit getal. Groeit het sneller dan het aantal nieuwe topics, dan"
  c_y "  lekt raw/vla in MQTT_TOPICS van vla-tdengine-bridge."

  hr
  [ "$ok" = 1 ] && c_g "VENDOR-VERIFY: de keten Connect -> Condition -> Model staat." \
                || c_r "VENDOR-VERIFY: aandachtspunten hierboven."
  return 0
}

# Alleen het SQL-eiland. Apart, want dat draait achter --profile vendor-sql en
# is de zwaarste component: je wilt hem niet per ongeluk starten.
cmd_vendor_sql(){
  require; local ok=1
  hr; c_y "1) SQL Server bereikbaar?"; hr
  $DC --profile vendor-sql ps vla-vendor-sql 2>/dev/null || true
  hr; c_y "2) Publiceert de gateway op raw/vla/{lims,cmms,ems}-01/# ? (5 msgs, 90s)"; hr
  # Poll-intervallen zijn 60s (lims, cmms) en 300s (ems), dus wachten hoort erbij.
  local raw; raw=$(docker run --rm --network "$NET" eclipse-mosquitto:latest \
        mosquitto_sub -h monstermq -t 'raw/vla/lims-01/#' -t 'raw/vla/cmms-01/#' \
        -t 'raw/vla/ems-01/#' -C 5 -W 90 -v 2>/dev/null || true)
  if [ -n "$raw" ]; then c_g "  SQL-eiland stroomt:"; echo "$raw" | sed 's/^/    /'
  else c_r "  niets van het SQL-eiland. Check: $DC --profile vendor-sql logs vla-vendor-gateway"; ok=0; fi
  hr; c_y "3) Sluit het paar? fat_setpoint_pct naast fat_actual_pct"; hr
  local pair; pair=$(docker run --rm --network "$NET" eclipse-mosquitto:latest \
        mosquitto_sub -h monstermq -t 'DairyWorks/Vla/Receiving/receiving-tank-01/Status/fat_+' \
        -C 2 -W 90 -v 2>/dev/null || true)
  if echo "$pair" | grep -q fat_actual_pct; then
    c_g "  het paar is compleet:"; echo "$pair" | sed 's/^/    /'
  else
    c_y "  fat_actual_pct nog niet gezien (lab pollt elke 60s)."; fi
  hr
  [ "$ok" = 1 ] && c_g "VENDOR-SQL: OK." || c_r "VENDOR-SQL: aandachtspunten hierboven."
  return 0
}

cmd_smoke(){
  require
  hr; c_y "Smoke-test: één demo-batch via de batch-engine API"; hr
  local start; start=$(curl_net 10 -X POST http://vla-batch-engine:8000/api/v1/batches \
        -H 'Content-Type: application/json' -d '{"recipe_id":"chocolate-vla-1L"}')
  echo "  create: $start"
  local id; id=$(echo "$start" | grep -oE '"batch_id"[: ]*"[^"]+"' | head -1 | grep -oE 'B-[^"]+' || true)
  [ -z "$id" ] && { c_r "  kon batch_id niet lezen — draait de factory + control-pad?"; return 1; }
  c_y "  batch $id gestart; volg de state (~2-3 min tot COMPLETE)..."
  for i in $(seq 1 30); do
    local st; st=$(curl_net 8 "http://vla-batch-engine:8000/api/v1/batches/$id")
    echo "    $(echo "$st" | grep -oE '"state"[: ]*"[^"]+"' | head -1)  $(echo "$st" | grep -oE '"end_viscosity_cP"[: ]*[0-9.]+' | head -1)"
    echo "$st" | grep -q '"COMPLETE"' && { c_g "  batch COMPLETE."; echo "$st" | grep -oE '"verdict"[: ]*"[^"]+"'; break; }
    sleep 6
  done
  c_y "  rapport (PDF) opvraagbaar via: https://milkdemo.<domain>/api/v1/report/$id?format=pdf"
}

cmd_fallback(){
  require
  hr; c_y "Overschakelen naar de connector-fallback (MonsterMQ native OPC-UA uit)"; hr
  c_y "1) MonsterMQ OPC-UA device 'vla' uitschakelen..."
  gql "mutation{opcUaDevice{toggle(name:\\\"vla\\\",enabled:false){success}}}"; echo
  c_y "2) connector starten (profile fallback)..."
  $DC --profile fallback up -d --build vla-connector
  c_g "Fallback actief. Verifieer opnieuw: $0 verify"
}

cmd_logs(){ $DC logs -f --tail=120 "${1:-}"; }
cmd_down(){ $DC down; c_g "Gestopt (volumes behouden)."; }

case "${1:-up}" in
  up) cmd_up ;;
  verify) cmd_verify ;;
  vendor) cmd_vendor ;;
  vendor-sql) cmd_vendor_sql ;;
  smoke) cmd_smoke ;;
  fallback) cmd_fallback ;;
  logs) shift || true; cmd_logs "${1:-}" ;;
  down) cmd_down ;;
  *) c_r "onbekend commando: $1"; sed -n '2,26p' "$0"; exit 1 ;;
esac
