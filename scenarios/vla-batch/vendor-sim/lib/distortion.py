"""distortion.py: turn true process state into what a vendor instrument reports.

Every vendor island in this demo is physically wired to the same product line as
the line PLC, so it measures the same fluid. It still disagrees, because a real
instrument sits somewhere else in the pipe, has its own calibration error, its
own response time and its own resolution.

The disagreement is DECLARED, never hidden in code. Each point in
factory-model/source-systems.json carries a distortion block:

    {"source": "Cook/cook-unit-01/temp_C",
     "offset": 0.8, "gain": 1.0, "noise_sigma": 0.15,
     "lag_s": 2.0, "quantise": 0.1}

That matters on stage. When someone asks "why do your two numbers differ", the
answer is a line in a config file you can point at, not a shrug. "The hold-tube
RTD reads 0.8 C high with a two second lag, here is the line that says so."

Everything here is pure and deterministic given a seed: no clock, no network, no
broker. That keeps it testable in selftest.py with nothing running.
"""
from __future__ import annotations

import math
import random

# Canonical unit -> native unit conversions. The factory speaks SI; vendor skids
# very often do not, and that gap is the whole point of the Condition step.
LITRE_PER_GALLON = 3.785411784


def c_to_f(celsius: float) -> float:
    return celsius * 9.0 / 5.0 + 32.0


def lmin_to_galmin(lmin: float) -> float:
    return lmin / LITRE_PER_GALLON


def kg_to_lbs(kg: float) -> float:
    return kg / 0.45359237


def bar_to_psi(bar: float) -> float:
    return bar * 14.503773773


CONVERT = {
    ("C", "degF"): c_to_f,
    ("L/min", "gal/min"): lmin_to_galmin,
    ("kg", "lbs"): kg_to_lbs,
    ("bar", "psi"): bar_to_psi,
}


def to_native(value: float, canonical_unit: str, native_unit: str) -> float:
    """Convert a canonical (SI) value into the unit the vendor instrument reports."""
    if canonical_unit == native_unit:
        return value
    fn = CONVERT.get((canonical_unit, native_unit))
    if fn is None:
        raise KeyError(f"no conversion {canonical_unit!r} -> {native_unit!r}")
    return fn(value)


class Distorter:
    """Stateful per-point distortion. One instance per native point.

    State is the first-order lag memory, so the instance must be reused across
    ticks; building a fresh Distorter every tick would silently disable the lag.
    """

    __slots__ = ("cfg", "_rng", "_lagged", "_frozen_at", "name")

    def __init__(self, name: str, cfg: dict, seed: int | None = None) -> None:
        self.name = name
        self.cfg = cfg or {}
        # Seed off the point name so every run of the demo tells the same story,
        # but two different points never share a noise sequence.
        self._rng = random.Random(seed if seed is not None else hash(name) & 0xFFFFFFFF)
        self._lagged: float | None = None
        self._frozen_at: float | None = None

    # -- the synthetic modes -------------------------------------------------
    def _threshold_below(self, truth: float) -> float:
        """1 when the process is below a limit. Models a safety interlock.

        The real one here is the flow-diversion valve: an HTST skid legally must
        divert product when the hold tube drops below the pasteurisation minimum.
        """
        return 1.0 if truth < float(self.cfg.get("threshold", 0.0)) else 0.0

    def _flow_when_hot(self, truth: float) -> float:
        """Flow that only exists while the skid is actually running."""
        if truth < float(self.cfg.get("threshold", 0.0)):
            return 0.0
        base = float(self.cfg.get("base", 0.0))
        return base + self._rng.gauss(0.0, float(self.cfg.get("noise_sigma", 0.0)))

    # -- the default analogue path ------------------------------------------
    def _analogue(self, truth: float, dt: float) -> float:
        gain = float(self.cfg.get("gain", 1.0))
        offset = float(self.cfg.get("offset", 0.0))
        target = truth * gain + offset

        lag_s = float(self.cfg.get("lag_s", 0.0))
        if lag_s > 0.0:
            if self._lagged is None:
                self._lagged = target
            else:
                # first-order response; alpha -> 1 as dt outgrows the time constant
                alpha = 1.0 - math.exp(-dt / lag_s) if dt > 0 else 1.0
                self._lagged += (target - self._lagged) * alpha
            value = self._lagged
        else:
            value = target

        sigma = float(self.cfg.get("noise_sigma", 0.0))
        if sigma > 0.0:
            value += self._rng.gauss(0.0, sigma)
        return value

    # -- public --------------------------------------------------------------
    def apply(self, truth: float | None, dt: float = 1.0) -> float | None:
        """Return what the instrument reports, or None if it cannot report.

        None means "no reading", which the caller turns into DA quality BAD. A
        vendor box that cannot see the process still answers; it answers badly.
        That is more useful to demo than a gap in the data.
        """
        if truth is None:
            return None

        # A stuck transmitter: keeps repeating its last value while the process
        # moves on. The nastiest real-world failure, because nothing looks broken.
        freeze_pct = float(self.cfg.get("freeze_pct", 0.0))
        if self._frozen_at is not None:
            if self._rng.random() * 100.0 >= freeze_pct * 3.0:
                self._frozen_at = None
            else:
                return self._frozen_at

        mode = self.cfg.get("mode")
        if mode == "threshold_below":
            return self._threshold_below(truth)
        if mode == "flow_when_hot":
            value = self._flow_when_hot(truth)
        else:
            value = self._analogue(truth, dt)

        quant = float(self.cfg.get("quantise", 0.0))
        if quant > 0.0:
            value = round(value / quant) * quant

        if freeze_pct > 0.0 and self._rng.random() * 100.0 < freeze_pct:
            self._frozen_at = value

        # A dropout: the instrument simply does not answer this scan.
        dropout_pct = float(self.cfg.get("dropout_pct", 0.0))
        if dropout_pct > 0.0 and self._rng.random() * 100.0 < dropout_pct:
            return None

        return value


def encode_native(value: float | None, native_unit: str, canonical_unit: str,
                  native_scale: float) -> int | None:
    """Canonical engineering value -> the scaled integer a legacy register holds.

    native_scale is the multiplier a client must apply to get engineering units
    back, so a scale of 0.1 means the register holds tenths. This is why raw
    vendor data is meaningless on its own: 1915 is not a temperature until
    something external tells you it is tenths of degrees Fahrenheit.
    """
    if value is None:
        return None
    if native_unit not in ("bool", canonical_unit):
        value = to_native(value, canonical_unit, native_unit)
    if not native_scale:
        native_scale = 1.0
    return int(round(value / native_scale))
