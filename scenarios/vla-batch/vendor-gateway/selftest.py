"""selftest.py: prove the SQL island mapping with sqlite, no SQL Server needed.

The gateway's job is a pure transformation from a database row to a raw MQTT
message, so it can be proven without TDS, without a broker and without network.
What cannot be proven here is the TDS hop itself; that needs the container.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from gateway import row_to_messages  # noqa: E402

FAIL = 0
NOW = datetime(2026, 8, 3, 12, 0, 0, tzinfo=timezone.utc)


def check(name, ok, detail=""):
    global FAIL
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    if detail:
        print(f"       {detail}")
    if not ok:
        FAIL += 1


import yaml  # noqa: E402
cfg = yaml.safe_load((ROOT / "vendor-gateway" / "sources.yaml").read_text(encoding="utf-8"))
BY_ID = {s["id"]: dict(s, _raw_root=cfg["raw_root"]) for s in cfg["sources"]}

# a stand-in database, same column names as the real seed
db = sqlite3.connect(":memory:")
db.row_factory = sqlite3.Row
db.execute("CREATE TABLE WO_HDR (WO_ID TEXT, EQ_TAG TEXT, STATUS TEXT)")
db.executemany("INSERT INTO WO_HDR VALUES (?,?,?)",
               [("WO-1001", "CK-UNIT-1", "OPEN"), ("WO-1002", "CK-UNIT-1", "OPEN"),
                ("WO-1003", "HOM-1101", "OPEN"), ("WO-1004", "CHL-1", "CLOSED")])

rows = [dict(r) for r in db.execute(
    "SELECT EQ_TAG, COUNT(*) AS OPEN_WO FROM WO_HDR WHERE STATUS <> 'CLOSED' GROUP BY EQ_TAG")]
msgs = [m for r in rows for m in row_to_messages(BY_ID["SRC-CMMS-01"], r, NOW)]
topics = dict(msgs)

check("1. a work-order count becomes a raw topic under the VENDOR's asset name",
      "raw/vla/cmms-01/CK-UNIT-1" in topics
      and topics["raw/vla/cmms-01/CK-UNIT-1"]["v"] == 2,
      "raw carries CK-UNIT-1, not cook-unit-01: turning one into the other is the Model step")

check("2. a closed work order is not counted",
      "raw/vla/cmms-01/CHL-1" not in topics,
      f"{len(topics)} assets with open work")

# LIMS: two key columns compose the native name
lims_row = {"SAMPLE_ID": "S-1", "EQ_TAG": "RCVT-1", "PARAM": "FAT",
            "VALUE": 3.47, "UOM": "%", "TAKEN_AT": "2026-08-03T11:59:00"}
lims = dict(row_to_messages(BY_ID["SRC-LIMS-01"], lims_row, NOW))
check("3. composite key columns build the native name",
      "raw/vla/lims-01/RCVT-1.FAT" in lims
      and lims["raw/vla/lims-01/RCVT-1.FAT"]["v"] == 3.47)

# EMS: the naive local timestamp is passed through RAW, not silently fixed
ems_row = {"TAG": "EM-101.kWh", "VALUE": 41.5, "TS_LOCAL": "2026-08-03 13:59:57"}
ems = dict(row_to_messages(BY_ID["SRC-EMS-01"], ems_row, NOW))
payload = ems["raw/vla/ems-01/EM-101.kWh"]
check("4. a naive local timestamp is passed through raw, never fixed in the gateway",
      payload["src_ts"] == "2026-08-03 13:59:57" and payload["rx_ts"].endswith("+00:00"),
      "deciding WHICH timezone belongs in reviewable config, not buried in gateway code")

check("5. a NULL value produces no message rather than a zero",
      row_to_messages(BY_ID["SRC-EMS-01"], {"TAG": "X", "VALUE": None}, NOW) == [],
      "missing is a dash, never a 0")

# every configured point must be reachable by the key the query produces
alias_doc = json.loads((ROOT / "factory-model" / "aliases.json").read_text(encoding="utf-8"))
alias_topics = {a["legacy_tag"] for a in alias_doc["aliases"]}
missing = []
for s in cfg["sources"]:
    for p in s["points"]:
        t = f"{cfg['raw_root']}/{s['raw_prefix']}/{p['native']}"
        if t not in alias_topics:
            missing.append(t)
check("6. every gateway point has a matching alias row",
      not missing,
      f"{sum(len(s['points']) for s in cfg['sources'])} SQL points"
      + ("" if not missing else " | missing: " + ", ".join(missing)))

print("=" * 62)
print("RESULT:", "ALL PASS" if FAIL == 0 else f"{FAIL} FAILED")
sys.exit(1 if FAIL else 0)
