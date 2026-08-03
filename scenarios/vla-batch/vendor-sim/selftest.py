"""selftest.py: prove the vendor islands without a broker, a factory or a network.

Offline-first is non-negotiable in this scenario, so everything here is pure
computation. The important test is CONFLICT: it drives the REAL physics module
rather than asserting numbers I picked, because a demo conflict that only exists
in a slide is worse than no conflict at all.

    python vendor-sim/selftest.py     # exit 0 = all good
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "factory"))

from lib.distortion import Distorter, c_to_f, encode_native, to_native  # noqa: E402

FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global FAIL
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    if detail:
        print(f"       {detail}")
    if not ok:
        FAIL += 1


# ---------------------------------------------------------------------------
# 1. unit conversion
# ---------------------------------------------------------------------------
check("1. C -> degF conversion",
      abs(c_to_f(88.0) - 190.4) < 1e-6 and abs(c_to_f(0.0) - 32.0) < 1e-9,
      f"88.0 C = {c_to_f(88.0):.2f} degF")

check("2. L/min -> gal/min conversion",
      abs(to_native(350.0, "L/min", "gal/min") - 92.46) < 0.01,
      f"350 L/min = {to_native(350.0, 'L/min', 'gal/min'):.2f} gal/min")

# ---------------------------------------------------------------------------
# 3. scaled-integer encoding: the reason raw vendor data is meaningless alone
# ---------------------------------------------------------------------------
raw = encode_native(88.0, native_unit="degF", canonical_unit="C", native_scale=0.1)
check("3. 88.0 C encodes to the legacy register value",
      raw == 1904,
      f"register holds {raw} (tenths of degF); nothing in the payload says so")

# ---------------------------------------------------------------------------
# 4. distortion is deterministic and stateful
# ---------------------------------------------------------------------------
cfg = {"source": "Cook/cook-unit-01/temp_C", "offset": 0.8, "lag_s": 2.0, "noise_sigma": 0.0}
a = Distorter("t", cfg)
b = Distorter("t", cfg)
seq_a = [a.apply(80.0, 1.0) for _ in range(5)]
seq_b = [b.apply(80.0, 1.0) for _ in range(5)]
check("4. distortion is reproducible across runs", seq_a == seq_b,
      f"first three: {[round(v, 3) for v in seq_a[:3]]}")

lagged = Distorter("lag", {"offset": 0.0, "lag_s": 5.0, "noise_sigma": 0.0})
first = lagged.apply(0.0, 1.0)
step = [lagged.apply(100.0, 1.0) for _ in range(3)]
check("5. lag actually lags (a step is not tracked instantly)",
      first == 0.0 and step[0] < 25.0 and step[0] < step[1] < step[2],
      f"step response {[round(v, 1) for v in step]} toward 100")

# ---------------------------------------------------------------------------
# 6. no truth means no reading, not a fabricated one
# ---------------------------------------------------------------------------
check("6. missing process state yields None, never a made-up value",
      Distorter("x", cfg).apply(None, 1.0) is None)

# ---------------------------------------------------------------------------
# 7. source-systems.json is structurally sound
# ---------------------------------------------------------------------------
doc = json.loads((ROOT / "factory-model" / "source-systems.json").read_text(encoding="utf-8"))
systems = doc["source_systems"]
model = json.loads((ROOT / "factory-model" / "isa95-vla.json").read_text(encoding="utf-8"))

problems: list[str] = []
seen_native: set[tuple[str, str]] = set()
for s in systems:
    for p in s["points"]:
        key = (s["id"], p["native"])
        if key in seen_native:
            problems.append(f"duplicate native point {p['native']} in {s['id']}")
        seen_native.add(key)
        tag_id = p["canonical_tag_id"]
        if ":" not in tag_id:
            problems.append(f"{tag_id} is not equipment:tag")
        elif tag_id.split(":", 1)[0] != s["equipment_id"]:
            # A lab or maintenance system REPORTS a measurement about another
            # asset; it does not own it. lims-01's fat reading has to land on
            # receiving-tank-01 or it never pairs with fat_setpoint_pct, which is
            # the bug the pair rule exists to prevent. Such points must say so.
            if p.get("measures_equipment") != tag_id.split(":", 1)[0]:
                problems.append(
                    f"{tag_id} is not on {s['equipment_id']} and declares no "
                    f"measures_equipment")
        if "condition_rule" not in p:
            problems.append(f"{tag_id} has no condition_rule")
check("7. source-systems.json is internally consistent",
      not problems,
      f"{len(systems)} system(s), {len(seen_native)} native points"
      + ("" if not problems else " | " + "; ".join(problems)))

# ---------------------------------------------------------------------------
# 7b. EVERY point must be encodable. This is the check that would have caught
#     the missing L -> gal conversion at build time instead of at runtime, where
#     it took a whole island down on its first scan.
# ---------------------------------------------------------------------------
sys.path.insert(0, str(HERE / "lib"))
from lib.point import Point  # noqa: E402

encode_errors: list[str] = []
for s in systems:
    for p in s["points"]:
        if s.get("ingest") == "gateway-sql":
            continue  # polled from a database, not derived from process state
        point = Point(p)
        try:
            value, _ = point.value({point.source_path: 50.0} if point.source_path else {}, 1.0)
            point.native_int(value)
            point.native_float(value)
        except Exception as ex:
            encode_errors.append(f"{s['equipment_id']}/{p['native']}: {ex}")
check("7b. every native point can be derived and encoded",
      not encode_errors,
      f"{sum(len(s['points']) for s in systems)} points across {len(systems)} systems"
      + ("" if not encode_errors else " | " + "; ".join(encode_errors)))

check("8. raw root stays out of the UNS",
      doc["raw_root"] == "raw/vla" and not doc["raw_root"].startswith("DairyWorks"),
      f"raw_root={doc['raw_root']} (DairyWorks/# is archived, so raw must not live there)")

# ---------------------------------------------------------------------------
# 9. THE CONFLICT, driven by the real physics rather than by assertion
# ---------------------------------------------------------------------------
try:
    from physics import VlaProcess  # noqa: E402

    proc = VlaProcess()
    proc.inject_fault("cook_undertemp", 0.65)
    proc.start_batch("chocolate-vla-1L")
    peak = 0.0
    for _ in range(20000):
        proc.tick(0.2)
        cook = proc.read().get(("Cook", "cook-unit-01"), {})
        peak = max(peak, float(cook.get("temp_C") or 0.0))
        if proc.state == "COMPLETE":
            break
    visc = float(proc.read()[("Cook", "cook-unit-01")]["viscosity_cP"])

    # what the vendor hold-tube RTD reports for that same peak temperature
    past = next(s for s in systems if s["equipment_id"] == "pasteuriser-01")
    hold = next(p for p in past["points"] if p["canonical_tag_id"].endswith("hold_temp_C"))
    d = Distorter("hold", dict(hold["distortion"], noise_sigma=0.0, lag_s=0.0))
    vendor_hold_C = d.apply(peak, 1.0)

    LEGAL_MIN_C = 72.0
    SPEC_MIN_CP = 150.0
    line_says_hold = visc < SPEC_MIN_CP
    vendor_says_safe = vendor_hold_C >= LEGAL_MIN_C

    check("9. the two systems reach OPPOSITE conclusions about the same batch",
          line_says_hold and vendor_says_safe,
          f"line PLC: peak {peak:.1f} C -> {visc:.0f} cP -> out of spec (<{SPEC_MIN_CP:.0f}) | "
          f"vendor skid: hold tube {vendor_hold_C:.1f} C -> above the {LEGAL_MIN_C:.0f} C "
          f"legal minimum -> safety record clean")
except Exception as ex:  # physics import is optional in a bare checkout
    check("9. conflict scenario (physics unavailable)", False, f"{type(ex).__name__}: {ex}")

print("=" * 60)
print("RESULT:", "ALL PASS" if FAIL == 0 else f"{FAIL} FAILED")
sys.exit(1 if FAIL else 0)
