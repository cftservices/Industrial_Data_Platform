"""process_tap.py: how a vendor skid learns what the process is doing.

THE ONE RULE
------------
This module talks OPC-UA to vla-factory and NOTHING ELSE. It never touches the
MQTT broker, never reads the UNS, never imports the batch engine.

That is not a style preference, it is the demonstration. Stop MonsterMQ and
every vendor island keeps running and keeps producing readings. The machines do
not need the data layer. The BUSINESS needs the data layer. If a "disconnected"
island had to subscribe to the UNS to function, the architecture would be
arguing against its own slide.

WHY READ THE FACTORY AT ALL
---------------------------
Because these skids are physically in the same pipe. The pasteuriser and the
line PLC measure the same fluid; they must therefore agree about what the batch
is doing and disagree only about the numbers. Alternatives were considered and
rejected:

  * each sim running its own physics: drifts apart within a minute, so the two
    systems end up measuring different batches. The conflict becomes a bug, and
    a sharp person in the room will spot it.
  * sims subscribing to the UNS: contradicts the whole premise, and creates a
    cycle clean -> raw -> clean.

Reading process state is what a sensor does. The tap is the pipe, not a network.

OFFLINE-FIRST
-------------
No factory reachable is a normal state, not a crash. truth() returns None for
every tag and the caller reports DA quality BAD. A vendor box with a dead field
connection still answers the poll; it answers badly. That is worth showing.
"""
from __future__ import annotations

import asyncio
import logging

log = logging.getLogger("vendor-sim.tap")

SITE = "DairyWorks"
LINE = "Vla"


class ProcessTap:
    """Read-only OPC-UA client on the line PLC.

    Keyed by the canonical "Area/Equipment/tag" path used in the distortion
    blocks of source-systems.json, so a config line reads the same as the topic
    a viewer sees.
    """

    def __init__(self, endpoint: str, paths: list[str], poll_s: float = 1.0,
                 ns: int = 2) -> None:
        self.endpoint = endpoint
        self.paths = sorted(set(paths))
        self.poll_s = poll_s
        self.ns = ns
        self._values: dict[str, float | None] = {p: None for p in self.paths}
        self._connected = False
        self._stop = asyncio.Event()

    @property
    def connected(self) -> bool:
        return self._connected

    def truth(self) -> dict[str, float | None]:
        """Latest known process state. Values are None until the first good read."""
        return dict(self._values)

    @staticmethod
    def node_id(path: str) -> str:
        """'Cook/cook-unit-01/temp_C' -> 'DairyWorks.Vla.Cook.cook-unit-01.temp_C'."""
        return f"{SITE}.{LINE}." + path.replace("/", ".")

    async def run(self) -> None:
        """Poll forever, reconnecting with backoff. Never raises."""
        from asyncua import Client, ua  # imported late so selftest needs no asyncua

        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with Client(url=self.endpoint) as client:
                    nodes = [
                        client.get_node(ua.NodeId(self.node_id(p), self.ns,
                                                  ua.NodeIdType.String))
                        for p in self.paths
                    ]
                    self._connected = True
                    backoff = 1.0
                    log.info("tap connected to %s (%d tags)", self.endpoint, len(nodes))
                    while not self._stop.is_set():
                        try:
                            values = await client.read_values(nodes)
                        except Exception as ex:  # a read failure is not a session failure
                            log.debug("tap read failed: %s", ex)
                            raise
                        for path, value in zip(self.paths, values):
                            self._values[path] = (
                                float(value) if isinstance(value, (int, float)) else None
                            )
                        await asyncio.sleep(self.poll_s)
            except Exception as ex:
                self._connected = False
                for p in self.paths:
                    self._values[p] = None
                log.warning("tap disconnected (%s); retry in %.0fs", ex, backoff)
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=backoff)
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 2, 30.0)

    def stop(self) -> None:
        self._stop.set()
