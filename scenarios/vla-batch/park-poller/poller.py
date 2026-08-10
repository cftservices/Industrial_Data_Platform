# -*- coding: utf-8 -*-
"""vla-park-poller: haalt data op bij machines die zelf niets publiceren.

Modbus TCP en REST hebben geen push. Iemand moet ze POLLEN, en dat is precies
het punt: bij die protocollen is de frequentie een keuze van de datalaag en niet
van de machine, en het tijdstempel is per definitie aankomsttijd. Dat is geen
tekortkoming van deze implementatie maar van het protocol, en het hoort in de
conditioning-regel te staan (`timestamp_source: none`) en niet verzwegen te
worden.

Wat hij publiceert is RUWE data op `raw/vla-park/{machine}/{native}`, precies
zoals de andere transporten. De conditioner weet daardoor niet via welk
protocol iets binnenkwam, en dat hoort ook zo: zou hij dat wel weten, dan kreeg
je zes takken code die elk net iets anders doen, en dan zit het verschil straks
in de data.

De decodering hier is met OPZET een tweede implementatie, los van
packml-sim/modbus_surface/server.py. Zouden beide kanten dezelfde functie
delen, dan bewijst de round-trip alleen dat een functie zichzelf kan omkeren.
"""

from __future__ import annotations

import io
import json
import logging
import os
import time

log = logging.getLogger("park-poller")

MODEL_DIR = os.environ.get("MODEL_DIR", "/model")
RAW_ROOT = os.environ.get("RAW_ROOT", "raw/vla-park")


# ------------------------------------------------------------------ decoderen

def decode(words, encoding):
    """Registerwoorden -> waarde. De inverse van modbus_surface.encode()."""
    if encoding == "ascii_packed":
        chars = []
        for w in words:
            chars.append(chr((w >> 8) & 0xFF))
            chars.append(chr(w & 0xFF))
        return "".join(chars).rstrip("\0")
    if encoding == "int32_hi_lo":
        if len(words) < 2:
            return 0
        # Hoog woord EERST. Omgekeerd lezen geeft een gigantisch maar volstrekt
        # plausibel getal, en niets in het protocol waarschuwt daarvoor.
        return (int(words[0]) << 16) | int(words[1])
    return int(words[0]) if words else 0


STATUS_TO_RAW = {0: 0, 1: 1, 2: 2}


# ------------------------------------------------------------------- modbus

class ModbusTarget:
    """Eén Modbus-machine: registerkaart plus verbinding."""

    def __init__(self, machine, rules):
        self.machine = machine
        self.rules = [r for r in rules if r.get("modbus_addr") is not None]
        first = self.rules[0]
        self.status_addr = first.get("modbus_status_addr")
        self.base = min(r["modbus_addr"] for r in self.rules)
        top = max(r["modbus_addr"] + r["modbus_width"] for r in self.rules)
        if self.status_addr:
            top = max(top, self.status_addr + 1)
        self.count = top - self.base
        self.host = os.environ.get(
            "MODBUS_HOST_%s" % machine.replace("-", "_").upper(), machine)
        self.port = int(os.environ.get("MODBUS_PORT", "5020"))
        self.device_id = int(os.environ.get("MODBUS_UNIT_ID", "1"))
        self.client = None
        self.ok = False

    def connect(self):
        from pymodbus.client import ModbusTcpClient
        self.client = ModbusTcpClient(self.host, port=self.port, timeout=3)
        self.ok = self.client.connect()
        if self.ok:
            log.info("%s: verbonden met %s:%d, %d registers vanaf %d",
                     self.machine, self.host, self.port, self.count, self.base)
        else:
            log.warning("%s: geen verbinding met %s:%d", self.machine,
                        self.host, self.port)
        return self.ok

    def poll(self):
        """[(topic, payload)] of een lege lijst."""
        if not self.ok and not self.connect():
            return []
        try:
            rr = self.client.read_holding_registers(
                self.base - 40001, count=self.count, device_id=self.device_id)
        except Exception as e:  # noqa: BLE001
            log.warning("%s: leesfout %s", self.machine, e)
            self.ok = False
            return []
        if rr is None or rr.isError():
            log.warning("%s: modbus-fout %s", self.machine, rr)
            self.ok = False
            return []

        regs = rr.registers
        status = None
        if self.status_addr is not None:
            i = self.status_addr - self.base
            if 0 <= i < len(regs):
                status = regs[i]

        out = []
        for r in self.rules:
            i = r["modbus_addr"] - self.base
            w = r["modbus_width"]
            if i < 0 or i + w > len(regs):
                continue
            value = decode(regs[i:i + w], r["modbus_encoding"])
            topic = "%s/%s/%s" % (RAW_ROOT, self.machine, r["native_name"])
            # Geen tijdstempel: Modbus heeft er geen. De conditioner gebruikt
            # aankomsttijd en LABELT dat ook zo. Er hier een verzinnen zou een
            # precisie suggereren die niet bestaat.
            out.append((topic, json.dumps({"v": value})))
            if status is not None:
                # Eén statuswoord voor het hele apparaat, uitgewaaierd over alle
                # signalen. Zo hoeft de conditioner niets van Modbus te weten.
                out.append(("%s.Q" % topic, str(STATUS_TO_RAW.get(status, 2))))
        return out


# --------------------------------------------------------------------- rest

class RestTarget:
    """Eén REST-machine, in de vorm van de bestaande ip21-stub."""

    def __init__(self, machine, rules):
        self.machine = machine
        self.rules = rules
        self.base_url = os.environ.get(
            "REST_URL_%s" % machine.replace("-", "_").upper(),
            "http://%s:8000" % machine)
        self.session = None

    def poll(self):
        import urllib.error
        import urllib.request
        out = []
        for r in self.rules:
            url = "%s/tags/%s/current" % (self.base_url, r["native_name"])
            try:
                with urllib.request.urlopen(url, timeout=3) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
            except (urllib.error.URLError, ValueError, OSError) as e:
                log.debug("%s: %s onbereikbaar (%s)", self.machine, url, e)
                continue
            topic = "%s/%s/%s" % (RAW_ROOT, self.machine, r["native_name"])
            out.append((topic, json.dumps(body)))
        return out


# --------------------------------------------------------------------- main

def load_targets():
    with io.open(os.path.join(MODEL_DIR, "park-conditioning.json"),
                 encoding="utf-8") as fh:
        rules = json.load(fh)["rules"]
    by_machine = {}
    for r in rules:
        by_machine.setdefault(r["source_system"], []).append(r)

    targets = []
    for machine, rs in sorted(by_machine.items()):
        if any(x.get("modbus_addr") is not None for x in rs):
            targets.append(ModbusTarget(machine, rs))
        elif rs and rs[0].get("protocol") == "rest":
            targets.append(RestTarget(machine, rs))
    return targets, rules


def main():
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s | %(message)s", datefmt="%H:%M:%S")

    import paho.mqtt.client as mqtt

    targets, rules = load_targets()
    if not targets:
        log.warning("geen pollbare machines in het model; niets te doen")
    for t in targets:
        log.info("doel: %s (%s)", t.machine, type(t).__name__)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="vla-park-poller")
    user = os.environ.get("MQTT_USERNAME")
    if user:
        client.username_pw_set(user, os.environ.get("MQTT_PASSWORD") or None)
    client.connect(os.environ.get("MQTT_HOST", "monstermq"),
                   int(os.environ.get("MQTT_PORT", 1883)), 60)
    client.loop_start()

    interval = float(os.environ.get("POLL_INTERVAL_S", "1.0"))
    hb = "DairyWorks/Vla-B/DataQuality/connector-poller/Status/last_poll_ok"
    try:
        while True:
            started = time.time()
            sent, alive = 0, 0
            for t in targets:
                msgs = t.poll()
                if msgs:
                    alive += 1
                for topic, payload in msgs:
                    client.publish(topic, payload, qos=0)
                    sent += 1
            # Hartslag. Een poller die dood gaat levert geen foutmelding op maar
            # stilte, en stilte lijkt op een machine die niets doet. Daarom
            # publiceert hij actief dat hij nog leeft.
            client.publish(hb, json.dumps({
                "value": alive, "unit": "", "quality": "GOOD",
                "targets": len(targets), "messages": sent}), qos=0)
            time.sleep(max(0.05, interval - (time.time() - started)))
    except KeyboardInterrupt:
        pass
    finally:
        client.loop_stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
