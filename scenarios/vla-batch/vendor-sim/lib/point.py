"""point.py: one native vendor point, shared by every island.

The DA island and the UA island differ in how they PUBLISH (scaled integers plus
a DA quality word, versus real doubles with a proper StatusCode and a source
timestamp). They do not differ in how a reading is DERIVED. Keeping that shared
means a machine can be moved between protocols by editing source-systems.json,
which is what PR-16 promises about swapping the model.
"""
from __future__ import annotations

from .distortion import Distorter, encode_native

# The house convention puts the unit in the tag name (06-Model B.2b), so the
# canonical unit is readable straight off the canonical tag id. Longest suffix
# wins: "_L_min" must beat "_L".
UNIT_BY_SUFFIX = {
    "_C": "C", "_L_min": "L/min", "_m3_h": "m3/h", "_kg": "kg", "_bar": "bar",
    "_pct": "%", "_rpm": "rpm", "_sec": "s", "_min": "min", "_cP": "cP",
    "_mS": "mS", "_L": "L",
}

# Modes that generate a reading without following any process value.
SOURCELESS_MODES = {"constant"}


def canonical_unit(tag_id: str) -> str:
    tag = tag_id.split(":", 1)[1]
    for suffix, unit in sorted(UNIT_BY_SUFFIX.items(), key=lambda kv: -len(kv[0])):
        if tag.endswith(suffix):
            return unit
    return ""


class Point:
    """A single native item: how it is derived, and what it is called natively."""

    __slots__ = ("native", "cfg", "distorter", "canon_unit", "node", "q_node")

    def __init__(self, cfg: dict) -> None:
        self.native = cfg["native"]
        self.cfg = cfg
        self.distorter = Distorter(cfg["native"], cfg.get("distortion") or {})
        self.canon_unit = canonical_unit(cfg["canonical_tag_id"])
        self.node = None
        self.q_node = None

    @property
    def distortion(self) -> dict:
        return self.cfg.get("distortion") or {}

    @property
    def source_path(self) -> str | None:
        return self.distortion.get("source")

    @property
    def sourceless(self) -> bool:
        return self.distortion.get("mode") in SOURCELESS_MODES

    def value(self, truth: dict[str, float | None], dt: float) -> tuple[float | None, bool]:
        """Return (engineering value in CANONICAL units, whether the process was visible).

        The second element is what separates "the instrument is fine but the
        process is not running" from "the instrument cannot see anything". Both
        end up as a non-GOOD quality, but only one of them is a fault.
        """
        if self.sourceless:
            return self.distorter.apply(0.0, dt), True
        src = self.source_path
        raw = truth.get(src) if src else None
        return self.distorter.apply(raw, dt), raw is not None

    def native_int(self, value: float | None) -> int | None:
        """Scale a canonical value into the integer a legacy register would hold."""
        return encode_native(
            value,
            native_unit=self.cfg.get("native_unit", ""),
            canonical_unit=self.canon_unit,
            native_scale=float(self.cfg.get("native_scale", 1) or 1),
        )

    def native_float(self, value: float | None) -> float | None:
        """Convert to the vendor's unit but keep full precision.

        A modern UA server has no reason to quantise into an integer, and that
        difference is worth showing: the payload is cleaner, the timestamps are
        real, the status codes are real, and the tag name is STILL meaningless
        outside its own endpoint. Protocol quality was never the problem.
        """
        if value is None:
            return None
        from .distortion import to_native
        native_unit = self.cfg.get("native_unit", "")
        if native_unit in ("bool", "", self.canon_unit):
            return value
        return to_native(value, self.canon_unit, native_unit)
