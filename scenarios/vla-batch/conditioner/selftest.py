"""selftest.py: prove Condition and Model with no broker and no network.

The interesting assertion is the last one: it takes the EXACT integer the DA
island puts on the wire for a known process temperature, runs it through the
real alias and rule tables, and checks the UNS message comes back as the
temperature we started with. That is a round trip through both steps, so a
mistake in the scale, the unit, the alias or the topic fails it.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "vendor-sim"))

from condition import (ConditionError, GOOD, BAD, UNCERTAIN, condition,  # noqa: E402
                       is_stale, map_quality, parse_payload, resolve_timestamp,
                       to_canonical)

FAIL = 0


def check(name, ok, detail=""):
    global FAIL
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    if detail:
        print(f"       {detail}")
    if not ok:
        FAIL += 1


aliases = json.loads((ROOT / "factory-model" / "aliases.json").read_text(encoding="utf-8"))
cond = json.loads((ROOT / "factory-model" / "conditioning.json").read_text(encoding="utf-8"))
ALIAS = {a["legacy_tag"]: a for a in aliases["aliases"]}
RULES = cond["rules"]
DEFAULTS = cond["defaults"]
NOW = datetime(2026, 8, 3, 12, 0, 0, tzinfo=timezone.utc)

# 1. unit conversion, the exact inverse of what the islands apply
check("1. degF -> C", abs(to_canonical(190.4, "degF", "C") - 88.0) < 1e-9,
      f"190.4 degF = {to_canonical(190.4, 'degF', 'C'):.2f} C")
check("2. lbs -> kg and gal -> L",
      abs(to_canonical(562.18, "lbs", "kg") - 255.0) < 0.01
      and abs(to_canonical(100.0, "gal", "L") - 378.54) < 0.01,
      f"562.18 lbs = {to_canonical(562.18, 'lbs', 'kg'):.2f} kg "
      f"(the certified scale's view of a 250 kg starch dose), "
      f"100 gal = {to_canonical(100.0, 'gal', 'L'):.2f} L")

# 3. payload zoo: every connector emits a different shape
check("3. the raw payload zoo all parses",
      parse_payload(b'{"value":1904,"timestamp":"2026-08-03T12:00:00Z","status":0}')["value"] == 1904
      and parse_payload(b'{"v":42,"rx_ts":"x"}')["value"] == 42
      and parse_payload(b"17.5")["value"] == 17.5,
      "MonsterMQ OPC-UA shape, our gateway shape, and a bare scalar")

# 4. DA quality lives in another topic, so absence must NOT read as GOOD
da_rule = {"quality_source": "da-quality-word"}
check("4. missing DA quality is UNCERTAIN, never assumed GOOD",
      map_quality(da_rule, {}, None, DEFAULTS) == UNCERTAIN
      and map_quality(da_rule, {}, 192, DEFAULTS) == GOOD
      and map_quality(da_rule, {}, 0, DEFAULTS) == BAD
      and map_quality(da_rule, {}, 64, DEFAULTS) == UNCERTAIN)

# 5. OPC-UA StatusCode severity bits
ua_rule = {"quality_source": "opcua-statuscode"}
check("5. OPC-UA StatusCode maps by severity",
      map_quality(ua_rule, {"status": 0}, None, DEFAULTS) == GOOD
      and map_quality(ua_rule, {"status": 0x80AC0000}, None, DEFAULTS) == BAD
      and map_quality(ua_rule, {"status": 0x40900000}, None, DEFAULTS) == UNCERTAIN)

# 6. no source timestamp must be LABELLED, not silently passed off as one
ts, src = resolve_timestamp({"timestamp_source": "none"}, {}, NOW, DEFAULTS)
ts2, src2 = resolve_timestamp({"timestamp_source": "source-timestamp"},
                              {"timestamp": "2026-08-03T11:59:57+00:00"}, NOW, DEFAULTS)
ts3, src3 = resolve_timestamp({"timestamp_source": "source-timestamp"},
                              {"timestamp": "2026-08-03 13:59:57"}, NOW, DEFAULTS)
check("6. timestamps are normalised AND labelled",
      src == "receive" and src2 == "source" and src3 == "source-assumed-tz"
      and ts3.startswith("2026-08-03T11:59:57"),
      f"no-ts -> {src} | zoned -> {src2} | naive local -> {src3} ({ts3})")

# 7. deadband suppresses noise but never a quality change
rule = {"native_unit": "", "canonical_unit": "", "scale": 1.0, "deadband": 0.5,
        "quality_source": "none", "timestamp_source": "none"}
alias = {"canonical_unit": "C"}
same = condition({"value": 20.1}, alias, rule, DEFAULTS, received=NOW, last_published=20.0)
moved = condition({"value": 21.0}, alias, rule, DEFAULTS, received=NOW, last_published=20.0)
check("7. deadband suppresses a 0.1 wobble, passes a 1.0 step",
      same is None and moved is not None,
      "the agitator_rpm incident is why: one tag made 5.34M of 5.35M historian rows")

# 8. a non-numeric value is refused rather than guessed
try:
    condition({"value": "n/a"}, alias, rule, DEFAULTS, received=NOW)
    refused = False
except ConditionError:
    refused = True
check("8. a non-numeric reading is refused, never coerced to 0", refused)

# 9. stale is a first-class state
check("9. silence is stale, not zero",
      is_stale(None, NOW, {"expected_interval_s": 1}, 90.0)
      and is_stale(NOW.replace(minute=50, hour=11), NOW, {"expected_interval_s": 1}, 90.0)
      and not is_stale(NOW, NOW, {"expected_interval_s": 1}, 90.0))

# 10. THE ROUND TRIP: the integer the DA island really publishes, back to a fact
raw_topic = "raw/vla/pasteuriser-01/Ch1.Dev2.TT_3003_PV"
a = ALIAS[raw_topic]
r = RULES[a["condition_rule"]]
out = condition({"value": 1904, "status": 0}, a, r, DEFAULTS,
                received=NOW, companion_quality=192)
check("10. round trip: 1904 on the wire becomes 88.0 C on the UNS",
      abs(out["value"] - 88.0) < 0.05 and out["unit"] == "C"
      and out["quality"] == GOOD and out["ts_source"] == "receive"
      and a["canonical_topic"] == "DairyWorks/Vla/Cook/pasteuriser-01/Status/hold_temp_C",
      f"{raw_topic}\n         -> {a['canonical_topic']}\n"
      f"         -> {json.dumps({k: out[k] for k in ('value','unit','quality','ts_source')})}")

# 11. every alias resolves to a rule, and every canonical topic obeys the locked form
bad = [a2["legacy_tag"] for a2 in aliases["aliases"] if a2["condition_rule"] not in RULES]
shape = [a2["canonical_topic"] for a2 in aliases["aliases"]
         if not a2["canonical_topic"].startswith("DairyWorks/Vla/")
         or "/Status/" not in a2["canonical_topic"]]
check("11. every alias has a rule and obeys the locked UNS topic form",
      not bad and not shape,
      f"{len(aliases['aliases'])} aliases, {len(RULES)} rules, "
      f"topic form DairyWorks/Vla/{{Area}}/{{Equipment}}/Status/{{tag}}")

# 12. identities are stable and unique per canonical tag
uuids = {a2["canonical_tag_id"]: a2["canonical_signal_uuid"] for a2 in aliases["aliases"]}
check("12. one stable identity per canonical tag",
      len(set(uuids.values())) == len(uuids),
      f"{len(uuids)} distinct signals, uuid5-derived so a vendor rename keeps the series")


# ---------------------------------------------------------------------------
# 13-15. Cross-checks: publish the disagreement instead of hiding it
# ---------------------------------------------------------------------------
from crosscheck import CrossChecks, topic_for  # noqa: E402

sources = json.loads((ROOT / "factory-model" / "source-systems.json").read_text(encoding="utf-8"))
XC = sources["cross_checks"]

cc = CrossChecks(XC)
first = cc.observe("pasteuriser-01:hold_temp_C", 77.1, NOW)
check("13. nothing is emitted until BOTH sides have been seen",
      first == [],
      "a divergence against a value never received is a guess, not a divergence")

msgs = dict(cc.observe("cook-unit-01:temp_C", 76.3, NOW))
delta = msgs[topic_for("XC-COOK-TEMP_delta")]
alarm = msgs[topic_for("XC-COOK-TEMP_alarm")]
check("14. the cook-temp conflict is published as a signal, both sides intact",
      abs(delta["value"] - 0.8) < 0.01 and delta["of_record"] == "pasteuriser-01:hold_temp_C"
      and alarm["value"] == 0
      and delta["a_value"] == 77.1 and delta["b_value"] == 76.3,
      f"delta {delta['value']:+.2f} C within the {XC[0]['tolerance']} C tolerance; "
      f"of record for {delta['of_record_for']}")

# the starch dose: certified scale against the flow estimate the engine books today
msgs2 = dict(cc.observe("dosing-station-01:net_weight_kg", 255.0, NOW))
msgs2.update(dict(cc.observe("process-tank-01:dose_starch_actual_kg", 250.0, NOW)))
a2 = msgs2[topic_for("XC-STARCH-DOSE_alarm")]
check("15. the starch conflict breaches tolerance and says which side is of record",
      a2["value"] == 1 and "of record" in a2["message"].lower(),
      a2["message"])

# a pair of quantities that are related but not identical must NOT alarm
msgs3 = dict(cc.observe("intake-skid-01:volume_total_L", 5075.0, NOW))
msgs3.update(dict(cc.observe("receiving-tank-01:level_L", 4900.0, NOW)))
check("16. delta_only pairs report a delta but never a false alarm",
      topic_for("XC-INTAKE-VOLUME_delta") in msgs3
      and topic_for("XC-INTAKE-VOLUME_alarm") not in msgs3,
      "a totaliser and a level are not the same quantity, so only drift is interesting")

# every cross-check must obey the locked UNS topic form
bad_xc = [t for t in list(msgs) + list(msgs2) + list(msgs3)
          if not t.startswith("DairyWorks/Vla/DataQuality/cross-check-01/Status/")]
check("17. cross-check output obeys the locked UNS topic form, no canon exception",
      not bad_xc,
      "DairyWorks/Vla/DataQuality/cross-check-01/Status/{id}_delta|_alarm")

print("=" * 62)
print("RESULT:", "ALL PASS" if FAIL == 0 else f"{FAIL} FAILED")
sys.exit(1 if FAIL else 0)
