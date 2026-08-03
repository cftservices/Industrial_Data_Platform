"""crosscheck.py: publish the disagreement instead of hiding it. Pure, no I/O.

When two systems measure the same physical thing they will differ. The cheap
options are to pick one silently or to average them, and both are wrong:

  * picking silently is what happens today, and nobody knows a choice was made
  * averaging produces a number no instrument ever measured, which is unauditable

So the layer publishes the DELTA as a signal in its own right, on the same locked
UNS topic form as everything else, and raises an alarm when the delta leaves the
declared tolerance. Which side is of record is written down in
source-systems.json, once, where it can be reviewed.

The canon rule that both a target and its actual must exist as a PAIR has a twin
here: when two sources answer the same question, a consumer is entitled to see
both answers AND the size of the argument.
"""
from __future__ import annotations

from datetime import datetime, timezone

DQ_AREA = "DataQuality"
DQ_EQUIPMENT = "cross-check-01"
UNS_ROOT = "DairyWorks/Vla"


def topic_for(name: str) -> str:
    return f"{UNS_ROOT}/{DQ_AREA}/{DQ_EQUIPMENT}/Status/{name}"


class CrossChecks:
    """Holds the latest canonical value per tag id and compares declared pairs."""

    def __init__(self, definitions: list[dict]) -> None:
        self.defs = definitions
        self.latest: dict[str, float] = {}
        # tag id -> the checks it takes part in, so a value update is O(1)
        self.index: dict[str, list[dict]] = {}
        for d in definitions:
            for side in ("a", "b"):
                self.index.setdefault(d[side]["tag_id"], []).append(d)

    def of_record_topic(self, tag_id: str) -> dict | None:
        """Return the check where this tag is the of-record side, if any."""
        for d in self.defs:
            if d["a"]["tag_id"] == tag_id:
                return d
        return None

    def observe(self, tag_id: str, value: float,
                now: datetime | None = None) -> list[tuple[str, dict]]:
        """Record a value and return any (topic, payload) messages it produced.

        Nothing is emitted until BOTH sides have been seen. A divergence computed
        against a value that was never received is not a divergence, it is a
        guess, and this whole layer exists to stop guessing.
        """
        self.latest[tag_id] = value
        now = now or datetime.now(timezone.utc)
        ts = now.astimezone(timezone.utc).isoformat()
        out: list[tuple[str, dict]] = []

        for d in self.index.get(tag_id, []):
            a_id, b_id = d["a"]["tag_id"], d["b"]["tag_id"]
            if a_id not in self.latest or b_id not in self.latest:
                continue
            a_val, b_val = self.latest[a_id], self.latest[b_id]
            delta = a_val - b_val

            out.append((topic_for(f"{d['id']}_delta"), {
                "value": delta,
                "unit": d.get("unit", ""),
                "ts": ts,
                "quality": "GOOD",
                "cross_check": d["id"],
                "a_tag": a_id, "a_value": a_val,
                "b_tag": b_id, "b_value": b_val,
                "of_record": a_id,
                "of_record_for": d["a"].get("of_record_for"),
            }))

            # delta_only pairs measure related but not identical quantities, so
            # an out-of-tolerance alarm would be a false alarm. Publishing false
            # alarms is the exact failure this demo criticises elsewhere.
            if d.get("compare") == "delta_only":
                continue

            breached = abs(delta) > float(d["tolerance"])
            out.append((topic_for(f"{d['id']}_alarm"), {
                "value": 1 if breached else 0,
                "unit": "",
                "ts": ts,
                "quality": "GOOD",
                "cross_check": d["id"],
                "severity": d.get("severity", "medium"),
                "tolerance": d["tolerance"],
                "delta": delta,
                "message": (
                    f"{d['title']}: {a_id} reads {a_val:.2f} and {b_id} reads "
                    f"{b_val:.2f}, a gap of {delta:+.2f} {d.get('unit','')} against a "
                    f"tolerance of {d['tolerance']}. Of record: {a_id}."
                ) if breached else "within tolerance",
            }))
        return out
