"""vla-vendor-opcua: the MODERN vendor island, and the sharpest argument in the demo.

This server does everything right. Real OPC-UA, not a tunnelled legacy protocol.
Source timestamps that are actually the measurement time. Real StatusCodes
instead of a proprietary quality word. Real doubles instead of registers holding
tenths. Subscriptions. Everything a vendor puts on the datasheet under
"Industry 4.0 ready", and all of it genuinely present.

And it is still a silo.

    PT_1101_PV on ns=2 of urn:vendorline

means nothing to any consumer in the plant. Not because the protocol is weak,
but because nobody has said what it IS. Compare it to the DA island next door:
that one is objectively worse in every technical respect, and after the Model
step both are equally useful. The delta between them is protocol quality. The
delta between raw and modelled is meaning. Only one of those is worth money.

That is why "OPC-UA is not the data layer" is the sharpest line in the deck, and
this container is the evidence for it. Put it on the slide right after the
protocol zoo.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.point import Point  # noqa: E402
from lib.process_tap import ProcessTap  # noqa: E402

log = logging.getLogger("vendor-opcua")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)

ENDPOINT = os.environ.get("ENDPOINT", "opc.tcp://0.0.0.0:4842/VendorLine")
FACTORY = os.environ.get("OPCUA_ENDPOINT", "opc.tcp://vla-factory:4840/DairyWorks")
SOURCES = os.environ.get("SOURCE_SYSTEMS", "/model/source-systems.json")
SCAN_S = float(os.environ.get("SCAN_INTERVAL", "1.0"))
# Instrument time constants are quoted in PROCESS seconds; see the same note in
# opcda/server.py. Keep TIME_SCALE in step with vla-factory.
TIME_SCALE = float(os.environ.get("TIME_SCALE", "1.0"))
PROCESS_DT = SCAN_S * TIME_SCALE
PROTOCOL = "OPC_UA"


class VendorLine:
    """One OPC-UA server carrying every modern vendor skid on this island."""

    def __init__(self, systems: list[dict]) -> None:
        self.systems = systems
        # Unlike DA, a modern server DOES nest: one object per machine. The
        # hierarchy is real and still local to this vendor, which is the point.
        self.by_machine: list[tuple[str, list[Point]]] = [
            (s["equipment_id"], [Point(p) for p in s["points"]]) for s in systems
        ]
        self.points: list[Point] = [p for _, pts in self.by_machine for p in pts]
        self.ns_uri = systems[0]["opcua_namespace_uri"]
        self.ns_expected = int(systems[0]["opcua_namespace_index"])
        self.idx = self.ns_expected

    def source_paths(self) -> list[str]:
        return [p.source_path for p in self.points if p.source_path]

    async def build(self, server) -> None:
        from asyncua import ua

        objects = server.nodes.objects
        for machine, points in self.by_machine:
            folder = await objects.add_object(
                ua.NodeId(machine, self.idx, ua.NodeIdType.String),
                ua.QualifiedName(machine, self.idx),
            )
            for pt in points:
                is_int = pt.cfg.get("datatype") == "Int32"
                pt.node = await folder.add_variable(
                    ua.NodeId(pt.native, self.idx, ua.NodeIdType.String),
                    ua.QualifiedName(pt.native, self.idx),
                    0 if is_int else 0.0,
                    ua.VariantType.Int32 if is_int else ua.VariantType.Double,
                )
        log.info("vendor UA line exposes %d nodes across %d machines on ns=%d",
                 len(self.points), len(self.by_machine), self.idx)

    async def scan(self, tap: ProcessTap) -> None:
        from asyncua import ua

        while True:
            truth = tap.truth()
            now = datetime.now(timezone.utc)
            for pt in self.points:
                value, saw_process = pt.value(truth, PROCESS_DT)
                is_int = pt.cfg.get("datatype") == "Int32"
                if value is None:
                    # A proper UA server does not go silent either: it reports the
                    # last value with a Bad status. Everything a consumer needs to
                    # judge the reading is in the StatusCode, correctly, which is
                    # exactly what makes the tag NAME the remaining problem.
                    status = ua.StatusCode(
                        ua.StatusCodes.BadNoCommunication if not saw_process
                        else ua.StatusCodes.UncertainLastUsableValue
                    )
                    dv = ua.DataValue(StatusCode=status, SourceTimestamp=now)
                else:
                    native = pt.native_float(value)
                    variant = (ua.Variant(int(round(native)), ua.VariantType.Int32)
                               if is_int else
                               ua.Variant(float(native), ua.VariantType.Double))
                    dv = ua.DataValue(variant, SourceTimestamp=now)
                await pt.node.write_value(dv)
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
    line = VendorLine(systems)
    log.info("serving %s: %s", PROTOCOL, ", ".join(s["equipment_id"] for s in systems))

    server = Server()
    await server.init()
    server.set_endpoint(ENDPOINT)
    server.set_server_name("Vendor line OPC-UA server (simulated)")
    idx = await server.register_namespace(line.ns_uri)
    if idx != line.ns_expected:
        raise SystemExit(
            f"namespace {line.ns_uri} registered at ns={idx}, expected ns="
            f"{line.ns_expected}. The generated ingest addresses would all miss. "
            f"Fix opcua_namespace_index in source-systems.json and regenerate."
        )
    line.idx = idx
    await line.build(server)

    tap = ProcessTap(FACTORY, line.source_paths(), poll_s=SCAN_S)
    async with server:
        await asyncio.gather(tap.run(), line.scan(tap))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
