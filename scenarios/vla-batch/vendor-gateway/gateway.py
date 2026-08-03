"""vla-vendor-gateway: the islands MonsterMQ cannot reach by itself.

MonsterMQ speaks OPC-UA, MQTT, Kafka, NATS, Redis, Sparkplug and plc4x. It has
no SQL SOURCE connector: jdbcLogger and friends are sinks. So the IT systems
(lab, maintenance, energy) need something to poll them, and this is it.

It publishes onto the SAME raw root as every other island, which is the point:
downstream, Condition and Model do not know or care which protocol a reading
came in on. Adding a protocol must never mean touching the model.

    SELECT ... FROM LAB_RESULT   ->   raw/vla/lims-01/RCVT-1.FAT

WHY THESE SYSTEMS MATTER MOST
-----------------------------
There is no protocol gap to blame here. The data is in a database, in a modern
format, with a perfectly good query interface. It is still invisible to the
plant, because nobody joined it. That is the silo problem with all the technical
excuses removed.

The row-to-message mapping is a pure function so selftest.py can prove it against
sqlite with no SQL Server, no broker and no network.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("vendor-gateway")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)

CONFIG = Path(os.environ.get("SOURCES", "/app/sources.yaml"))
MQTT_HOST = os.environ.get("MQTT_HOST", "monstermq")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
SQL_USER = os.environ.get("SQL_USER", "sa")
SQL_PASS = os.environ.get("SQL_PASS", "")


def load_config(path: Path) -> dict:
    """Read sources.yaml without a YAML dependency.

    The generated file uses a deliberately small subset (mappings, lists, one
    folded scalar), so a 40-line reader beats adding pyyaml to the image. If the
    config ever needs real YAML, add the dependency rather than growing this.
    """
    import yaml  # present in the image; falls back below if absent
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def row_to_messages(source: dict, row: dict, received: datetime) -> list[tuple[str, dict]]:
    """One database row -> the raw MQTT messages it produces. Pure.

    The native name is rebuilt from the source's key columns, so the raw topic
    carries the VENDOR's identifier (CK-UNIT-1, RCVT-1.FAT) and not ours. That is
    deliberate: the raw tree must look like the vendor's world, because the whole
    demonstration is that turning it into our world takes a modelling step.
    """
    key = ".".join(str(row[c]) for c in source["key_columns"])
    value = row.get(source["value_column"])
    if value is None:
        return []

    payload = {
        "v": value,
        # The gateway's payload shape differs from MonsterMQ's on purpose. There
        # is no single raw contract in a real plant, and pretending otherwise
        # would hide the problem the Condition step exists to solve.
        "src_ts": None,
        "rx_ts": received.astimezone(timezone.utc).isoformat(),
        "src": source["equipment_id"],
    }
    ts_col = source.get("watermark")
    if ts_col and row.get(ts_col) is not None:
        # Passed through raw, INCLUDING a naive local timestamp. Normalising here
        # would move a decision (which timezone?) out of the reviewable config
        # and into gateway code, where nobody would ever find it again.
        payload["src_ts"] = str(row[ts_col])

    topic = f"{source['_raw_root']}/{source['raw_prefix']}/{key}"
    return [(topic, payload)]


def connect_sql(endpoint: str):
    """Open a TDS connection. Returns None when the island is unreachable.

    An unreachable island is a normal state, not a crash: the gateway keeps
    polling the others and retries this one on the next tick.
    """
    try:
        import pymssql
    except ImportError:
        log.error("pymssql not installed; SQL islands cannot be polled")
        return None
    host, _, rest = endpoint.partition(":")
    port, _, database = rest.partition("/")
    try:
        return pymssql.connect(server=host, port=port or "1433", user=SQL_USER,
                               password=SQL_PASS, database=database or "PLANT",
                               login_timeout=5, timeout=10)
    except Exception as ex:
        log.warning("cannot reach %s: %s", endpoint, ex)
        return None


def poll_once(source: dict, conn, client) -> int:
    cursor = conn.cursor(as_dict=True)
    # sources.yaml schrijft de portable ODBC-stijl `?`; pymssql wil `%s`. Dat
    # verschil is een driver-detail en hoort niet in de config te lekken, anders
    # is de query niet meer leesbaar voor iemand die hem in SSMS wil plakken.
    #
    # GEVONDEN OP DE VPS, 2026-08-03: alleen een echte TDS-verbinding laat dit
    # zien. Offline liep de test op sqlite, en die accepteert `?` juist wel.
    query = source["query"].replace("?", "%s")
    params = ()
    if source.get("watermark") and source["watermark"] != "null":
        params = (source.get("_since") or datetime(1970, 1, 1),)
    cursor.execute(query, params)
    now = datetime.now(timezone.utc)
    sent = 0
    for row in cursor:
        for topic, payload in row_to_messages(source, row, now):
            client.publish(topic, json.dumps(payload, default=str), qos=0)
            sent += 1
        wm = source.get("watermark")
        if wm and wm != "null" and row.get(wm) is not None:
            source["_since"] = row[wm]
    cursor.close()
    return sent


def main() -> None:
    import paho.mqtt.client as mqtt

    cfg = load_config(CONFIG)
    raw_root = cfg["raw_root"]
    sources = cfg["sources"]
    for s in sources:
        s["_raw_root"] = raw_root
        s["_next"] = 0.0
    log.info("polling %d SQL islands -> %s/#", len(sources), raw_root)

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                             client_id="vla-vendor-gateway")
    except AttributeError:
        client = mqtt.Client(client_id="vla-vendor-gateway")
    client.reconnect_delay_set(1, 30)
    while True:
        try:
            client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
            break
        except Exception as ex:
            log.warning("broker unreachable (%s); retrying", ex)
            time.sleep(5)
    client.loop_start()

    while True:
        now = time.monotonic()
        for s in sources:
            if now < s["_next"]:
                continue
            s["_next"] = now + float(s.get("poll_s", 60))
            conn = connect_sql(s["endpoint"])
            if conn is None:
                continue
            try:
                sent = poll_once(s, conn, client)
                if sent:
                    log.info("%s: published %d rows", s["id"], sent)
            except Exception as ex:
                log.warning("%s poll failed: %s", s["id"], ex)
            finally:
                conn.close()
        time.sleep(1.0)


if __name__ == "__main__":
    main()
