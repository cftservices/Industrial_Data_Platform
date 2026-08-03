"""vla-conditioner: raw vendor islands -> the ISA-95 UNS.

    raw/vla/{system}/{native}  --Condition-->  --Model-->  DairyWorks/Vla/{Area}/{Equipment}/Status/{tag}

WHY THIS IS AN OWNED SERVICE AND NOT BROKER CONFIG
--------------------------------------------------
MonsterMQ has a flow engine and it works. But every rule would be a FlowInstance
created over GraphQL and persisted in Mongo, which means the transformation
logic would not be in git. That breaks the first DataOps-for-OT discipline
(version control) and it cannot be tested offline. NiFi was the other candidate
and wants ~1.5 GB of heap, which is dead against the cheap-VPS requirement.
Node-RED is banned outright.

So: the broker does the transformations that are CONFIGURATION (subscriptions,
publish-on-change), and this service does the ones that are LOGIC, because logic
has to be reviewable in a diff.

THE DEMO SWITCH
---------------
POST /api/v1/model-layer {"enabled": false} stops publication to the UNS while
raw keeps arriving. Grafana and the UI drain; the Connect view keeps filling.
Turn it back on and everything returns. Ten seconds, and the whole argument.

Implemented as a flag rather than by stopping the container, because container
start-up time would ruin the moment.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from condition import ConditionError, condition, is_stale, parse_payload

log = logging.getLogger("vla-conditioner")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/model"))
MQTT_HOST = os.environ.get("MQTT_HOST", "monstermq")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
RAW_ROOT = os.environ.get("RAW_ROOT", "raw/vla")
HTTP_PORT = int(os.environ.get("HTTP_PORT", "8080"))
# Off by default: publishing the intermediate tree doubles broker traffic and is
# only useful when a presenter wants to show step 2 apart from step 3.
TRACE = os.environ.get("CONDITION_TRACE", "off").lower() == "on"


class Layer:
    """Everything the conditioner knows, reloadable on demand."""

    def __init__(self) -> None:
        self.enabled = True
        self.aliases: dict[str, dict] = {}
        self.rules: dict[str, dict] = {}
        self.defaults: dict = {}
        self.stale_threshold_s = 90.0
        # runtime state, keyed by raw topic
        self.quality: dict[str, int] = {}      # from the .Q companion items
        self.last_value: dict[str, float] = {}  # for the deadband
        self.last_seen: dict[str, datetime] = {}
        self.counters = {"raw_in": 0, "published": 0, "suppressed": 0,
                         "unmapped": 0, "errors": 0}
        self.load()

    def load(self) -> None:
        aliases = json.loads((MODEL_DIR / "aliases.json").read_text(encoding="utf-8"))
        cond = json.loads((MODEL_DIR / "conditioning.json").read_text(encoding="utf-8"))
        # retired_at set means the alias still RESOLVES for a reader but must not
        # PUBLISH any more. That is what makes an upstream rename a non-event
        # instead of a broken dashboard.
        self.aliases = {a["legacy_tag"]: a for a in aliases["aliases"]
                        if not a.get("retired_at")}
        self.retired = {a["legacy_tag"]: a for a in aliases["aliases"]
                        if a.get("retired_at")}
        self.rules = cond["rules"]
        self.defaults = cond.get("defaults", {})
        try:
            model = json.loads((MODEL_DIR / "isa95-vla.json").read_text(encoding="utf-8"))
            self.stale_threshold_s = float(model.get("stale_threshold_s", 90))
        except Exception:
            pass
        log.info("loaded %d active aliases (%d retired), %d rules",
                 len(self.aliases), len(self.retired), len(self.rules))

    def status(self) -> dict:
        now = datetime.now(timezone.utc)
        stale = [t for t, a in self.aliases.items()
                 if is_stale(self.last_seen.get(t), now,
                             self.rules.get(a["condition_rule"], {}),
                             self.stale_threshold_s)]
        return {
            "model_layer_enabled": self.enabled,
            "aliases_active": len(self.aliases),
            "aliases_retired": len(self.retired),
            "stale_tags": len(stale),
            "counters": dict(self.counters),
            "trace": TRACE,
        }


LAYER = Layer()


def on_message(client, _userdata, msg) -> None:
    topic = msg.topic
    LAYER.counters["raw_in"] += 1

    # The DA islands carry quality in a companion item. Remember it and stop:
    # a quality word is metadata about another tag, not a tag of its own, so it
    # must never reach the UNS as if it were a measurement.
    if topic.endswith(".Q"):
        try:
            LAYER.quality[topic[:-2]] = int(parse_payload(msg.payload)["value"])
        except Exception:
            pass
        return

    alias = LAYER.aliases.get(topic)
    if alias is None:
        # Unmapped raw data is not an error, it is the normal state of a plant
        # that has not done the Model step. Count it and say so on the Connect
        # view; do not invent a destination for it.
        LAYER.counters["unmapped"] += 1
        return

    rule = LAYER.rules.get(alias["condition_rule"])
    if rule is None:
        LAYER.counters["errors"] += 1
        log.warning("no conditioning rule %s for %s", alias["condition_rule"], topic)
        return

    now = datetime.now(timezone.utc)
    LAYER.last_seen[topic] = now
    try:
        payload = parse_payload(msg.payload)
        out = condition(
            payload, alias, rule, LAYER.defaults,
            received=now,
            companion_quality=LAYER.quality.get(topic),
            last_published=LAYER.last_value.get(topic),
        )
    except ConditionError as ex:
        LAYER.counters["errors"] += 1
        log.warning("cannot condition %s: %s", topic, ex)
        return

    if out is None:
        LAYER.counters["suppressed"] += 1
        return

    if TRACE:
        client.publish(topic.replace(RAW_ROOT, "cond/vla", 1),
                       json.dumps(out), qos=0, retain=True)

    if not LAYER.enabled:
        # The switch is off. Raw still flows, the UNS goes quiet. This is the
        # demo, not a failure mode, so do not log it per message.
        return

    LAYER.last_value[topic] = out["value"]
    LAYER.counters["published"] += 1
    client.publish(alias["canonical_topic"], json.dumps(out), qos=0, retain=False)


class Control(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") in ("/api/v1/status", "/health", ""):
            self._send(200, LAYER.status())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send(400, {"error": "body must be JSON"})
            return
        path = self.path.rstrip("/")
        if path == "/api/v1/model-layer":
            LAYER.enabled = bool(body.get("enabled", True))
            log.info("model layer %s", "ENABLED" if LAYER.enabled else "DISABLED")
            self._send(200, LAYER.status())
        elif path == "/api/v1/reload":
            LAYER.load()
            self._send(200, LAYER.status())
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *_args):  # keep the container log about data, not HTTP
        return


def serve_control() -> None:
    HTTPServer(("0.0.0.0", HTTP_PORT), Control).serve_forever()


def main() -> None:
    import paho.mqtt.client as mqtt

    threading.Thread(target=serve_control, daemon=True).start()
    log.info("control API on :%d", HTTP_PORT)

    # paho 2.x needs the callback API version; the rest of this stack pins 2.1.0.
    # Keep the 1.x fallback so the module still runs in a bare checkout.
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                             client_id="vla-conditioner")
    except AttributeError:
        client = mqtt.Client(client_id="vla-conditioner")

    def _on_connect(c, _userdata, _flags, _rc, *_args):
        c.subscribe(f"{RAW_ROOT}/#", qos=0)
        log.info("subscribed %s/#", RAW_ROOT)

    client.on_message = on_message
    client.on_connect = _on_connect
    client.reconnect_delay_set(1, 30)
    while True:
        try:
            client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
            client.loop_forever()
        except Exception as ex:
            log.warning("broker unreachable (%s); retrying", ex)
            import time
            time.sleep(5)


if __name__ == "__main__":
    main()
