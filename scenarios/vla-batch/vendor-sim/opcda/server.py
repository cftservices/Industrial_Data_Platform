"""vla-vendor-opcda: the legacy island, reached through a DA/UA tunneller.

WHAT THIS IS, HONESTLY
----------------------
OPC-DA is DCOM. It runs on Windows and it is not implementable in a Linux
container, and this file does NOT implement it. What it simulates is how you
actually reach a DA island from a Linux data layer in real life: the DA server
sits behind a DA/UA tunneller and you connect to the tunneller's UA endpoint.

So the transport is UA. The DATA is DA, and that is the part that carries the
lesson:

  * flat ItemIDs, no hierarchy at all      Ch1.Dev2.TT_3003_PV
  * the DA quality word as a companion item, not an OPC-UA StatusCode
        192 GOOD | 64 UNCERTAIN | 0 BAD
  * no per-item source timestamp, so the only time available is receive time
  * scaled integers, because the registers underneath are integers
        1915 is not a temperature until something tells you it is tenths of degF

Do not let anyone leave the room believing we implemented DCOM. Say what this is.

WHY THIS MACHINE MATTERS
------------------------
The hold-tube RTD on this skid and the line PLC's cook temperature are the same
fluid at the same moment. They disagree by design (see source-systems.json).
Under a cook_undertemp fault the legal pasteurisation record on this island says
the product is safe while the line's viscosity says it is out of spec. Both are
correct. Only one of them is currently visible to anybody.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.point import Point  # noqa: E402
from lib.process_tap import ProcessTap  # noqa: E402

log = logging.getLogger("vendor-opcda")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)

# Only the BIND address is an env var: the container binds 0.0.0.0 while the
# model advertises the service name other containers dial. The namespace URI and
# its expected index come from source-systems.json, because that is the same file
# the generated MonsterMQ address list is built from. Two copies of a namespace
# index is exactly the drift tools/gen-connect.py exists to prevent.
ENDPOINT = os.environ.get("ENDPOINT", "opc.tcp://0.0.0.0:4843/DATunnel")
FACTORY = os.environ.get("OPCUA_ENDPOINT", "opc.tcp://vla-factory:4840/DairyWorks")
SOURCES = os.environ.get("SOURCE_SYSTEMS", "/model/source-systems.json")
SCAN_S = float(os.environ.get("SCAN_INTERVAL", "1.0"))

# The factory runs accelerated (TIME_SCALE process-seconds per real second) so a
# two-minute batch fits in a demo. Instrument time constants are quoted in
# PROCESS seconds, because that is how an instrument datasheet quotes them, so
# one real scan advances the lag filter by SCAN_S * TIME_SCALE process-seconds.
#
# Getting this wrong is visible and embarrassing: with lag_s treated as real
# seconds, the vendor RTD trailed the line PLC by 35 C during the cooling phase
# and the demo looked broken rather than instructive. Keep this in step with
# TIME_SCALE on vla-factory.
TIME_SCALE = float(os.environ.get("TIME_SCALE", "1.0"))
PROCESS_DT = SCAN_S * TIME_SCALE
PROTOCOL = "OPC_DA"

# DA quality word. Not an OPC-UA StatusCode: a consumer has to know this table
# exists, which is exactly why an unmodelled tag is worthless.
Q_GOOD, Q_UNCERTAIN, Q_BAD = 192, 64, 0

class DATunnel:
    def __init__(self, systems: list[dict]) -> None:
        self.systems = systems
        self.points: list[Point] = []
        for sys_cfg in systems:
            for p in sys_cfg["points"]:
                self.points.append(Point(p))
        self.ns_uri = systems[0]["opcua_namespace_uri"]
        self.ns_expected = int(systems[0]["opcua_namespace_index"])
        self.idx = self.ns_expected

    def source_paths(self) -> list[str]:
        return [p.source_path for p in self.points if p.source_path]

    @staticmethod
    def read_point(pt: Point, truth: dict) -> tuple[int | None, int]:
        """Derive one item and map its condition onto the DA quality word."""
        value, saw_process = pt.value(truth, PROCESS_DT)
        if value is None:
            # A real DA server holds its last value and flags it rather than
            # going silent. BAD means the field connection is gone; UNCERTAIN
            # means the instrument answered but the reading is not trustworthy.
            return None, Q_BAD if not saw_process else Q_UNCERTAIN
        return pt.native_int(value), Q_GOOD

    async def build(self, server) -> None:
        from asyncua import ua

        objects = server.nodes.objects
        # DA has no hierarchy worth the name: one flat bag of ItemIDs. Modelling
        # that faithfully is the point, so resist the urge to nest by equipment.
        root = await objects.add_object(
            ua.NodeId("DATunnel", self.idx, ua.NodeIdType.String),
            ua.QualifiedName("DATunnel", self.idx),
        )
        for pt in self.points:
            pt.node = await root.add_variable(
                ua.NodeId(pt.native, self.idx, ua.NodeIdType.String),
                ua.QualifiedName(pt.native, self.idx),
                0, ua.VariantType.Int32,
            )
            pt.q_node = await root.add_variable(
                ua.NodeId(f"{pt.native}.Q", self.idx, ua.NodeIdType.String),
                ua.QualifiedName(f"{pt.native}.Q", self.idx),
                Q_BAD, ua.VariantType.Int32,
            )
        log.info("DA tunnel exposes %d items (+%d quality items) on ns=%d",
                 len(self.points), len(self.points), self.idx)

    async def scan(self, tap: ProcessTap) -> None:
        from asyncua import ua

        while True:
            truth = tap.truth()
            for pt in self.points:
                value, quality = self.read_point(pt, truth)
                if value is not None:
                    # No SourceTimestamp on purpose: a DA item does not carry one,
                    # so a consumer only ever learns when the VALUE WAS RECEIVED,
                    # never when it was measured. That gap is the timestamp lesson
                    # the Condition step has to close, and hiding it here would
                    # make the demo easier and dishonest.
                    await pt.node.write_value(
                        ua.DataValue(ua.Variant(int(value), ua.VariantType.Int32),
                                     SourceTimestamp=None)
                    )
                await pt.q_node.write_value(
                    ua.DataValue(ua.Variant(int(quality), ua.VariantType.Int32),
                                 SourceTimestamp=None)
                )
            await asyncio.sleep(SCAN_S)


def load_systems(path: str) -> list[dict]:
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    return [
        s for s in doc["source_systems"]
        if s.get("protocol") == PROTOCOL and s.get("enabled", True)
    ]


async def main() -> None:
    from asyncua import Server

    systems = load_systems(SOURCES)
    if not systems:
        log.error("no enabled %s systems in %s; nothing to serve", PROTOCOL, SOURCES)
        return
    tunnel = DATunnel(systems)
    log.info("serving %s: %s", PROTOCOL, ", ".join(s["equipment_id"] for s in systems))

    server = Server()
    await server.init()
    server.set_endpoint(ENDPOINT)
    server.set_server_name("Vendor DA/UA tunneller (simulated)")
    idx = await server.register_namespace(tunnel.ns_uri)
    if idx != tunnel.ns_expected:
        # The factory only warns here. This one refuses, because the generated
        # MonsterMQ address list hardcodes the index: booting with a different
        # index would look healthy and silently deliver nothing.
        raise SystemExit(
            f"namespace {tunnel.ns_uri} registered at ns={idx}, expected ns="
            f"{tunnel.ns_expected}. The generated ingest addresses would all miss. "
            f"Fix opcua_namespace_index in source-systems.json and regenerate."
        )
    tunnel.idx = idx
    await tunnel.build(server)

    tap = ProcessTap(FACTORY, tunnel.source_paths(), poll_s=SCAN_S)
    async with server:
        await asyncio.gather(tap.run(), tunnel.scan(tap))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
