"""Tests voor de backend-gaten van fase 2: alarmen, verbose tags en line/live."""

import random
from datetime import datetime, timedelta, timezone

import pytest

from vla import alarms as A, kpi, line as L
from vla.batches import BatchRunner
from vla.db import get_db, seed_recipes
from vla.equipment import CipRequired, EquipmentMonitor

TELEM_BAD = {"fault": "cook_undertemp", "magnitude": 0.6,
             "hold_elapsed_sec": 300.0, "packs_total": 4900, "reject_count": 100}
TELEM_OK = {"peak_cook_temp_C": 88.0, "hold_elapsed_sec": 300.0,
            "packs_total": 4980, "reject_count": 20}


def _db(n_ok=2, n_bad=1):
    db = get_db(mongo_url=None)
    seed_recipes(db)
    mon = EquipmentMonitor(db, bus=None)
    runner = BatchRunner(db, bus=None, rng=random.Random(48), equipment=mon)
    for telem in [TELEM_OK] * n_ok + [TELEM_BAD] * n_bad:
        try:
            b = runner.create_batch("chocolate-vla-1L", planned_L=5000)
        except CipRequired:
            mon.perform_cip("cook-unit-01", operator_id="t")
            b = runner.create_batch("chocolate-vla-1L", planned_L=5000)
        runner.start_batch(b["batch_id"], telemetry=telem)
    return db


# ----------------------------------------------------------------- alarmen

def test_alarms_are_readable_and_carry_priority_and_state():
    db = _db()
    rows = A.list_alarms(db)
    assert rows, "een onderkookte batch hoort een alarm op te leveren"
    for r in rows:
        assert r["priority"] in ("high", "medium", "low")
        assert r["state"] in ("open", "acknowledged", "shelved")


def test_shelve_requires_a_reason_and_a_future_end():
    db = _db()
    aid = A.list_alarms(db)[0]["alarm_id"]
    future = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()

    with pytest.raises(ValueError, match="reason"):
        A.shelve(db, aid, "", future, "op")
    with pytest.raises(ValueError, match="future"):
        A.shelve(db, aid, "werkorder WO-118", past, "op")
    with pytest.raises(ValueError, match="unknown"):
        A.shelve(db, "A-NOPE", "x", future, "op")

    row = A.shelve(db, aid, "werkorder WO-118", future, "op")
    assert row["state"] == "shelved"
    assert row["shelved_reason"] == "werkorder WO-118"


def test_expired_shelve_falls_back_to_open():
    """Parkeren is tijdelijk. Zonder terugval verdwijnt een alarm voorgoed."""
    db = _db()
    a = A.list_alarms(db)[0]
    db.dw_alarms.update_one(
        {"alarm_id": a["alarm_id"]},
        {"$set": {"shelved_until": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
                  "shelved_reason": "verlopen"}},
    )
    fresh = db.dw_alarms.find_one({"alarm_id": a["alarm_id"]})
    assert A.state_of(fresh) == "open"


def test_alarm_load_reports_against_the_targets():
    db = _db()
    start, end = kpi.window_bounds("day")
    load = A.alarm_load(db, start, end)
    assert load["available"] is True
    assert load["per_hour"] >= 0
    # De richtwaarden horen in de respons, zodat het scherm ze niet zelf kent.
    assert load["targets"]["per_hour"] == {"acceptable": 6, "max": 12}
    assert load["mix_targets_pct"] == {"high": 5, "medium": 15, "low": 80}
    assert sum(load["counts"].values()) == load["total"]
    assert isinstance(load["top_sources"], list)


def test_alarm_load_is_in_the_kpi_summary():
    db = _db()
    out = kpi.summary(db, window="day", compare=False)
    assert "alarm_load" in out
    assert out["alarm_load"]["available"] is True


# -------------------------------------------------------------- line/live

def test_line_live_needs_no_client_side_arithmetic():
    """Alles wat de oude client zelf afleidde komt hier kant-en-klaar uit."""
    db = _db()
    out = L.live(db, {"recipes": [{"pack_size_L": 1.0}], "packs_per_pallet": 1200})
    assert out["available"] is True
    f = out["filling"]
    for field in ("packs_total", "packs_target", "packs_progress_pct",
                  "packs_rate_per_min", "pallets"):
        assert field in f, f"line/live mist {field}"
    assert out["dose_totals"]["target_kg"] > 0
    # Server-anker voor de fasetimer: de UI mag hiervandaan tikken.
    assert "phase_started_at" in out["batch"]


def test_line_live_falls_back_to_the_most_recent_batch():
    """De regressie die eerder al een keer is gefixt: targets alleen laden bij
    een actieve batch lijkt logisch en is fout, want de lijn staat het grootste
    deel van de tijd op COMPLETE."""
    db = _db(n_ok=2, n_bad=0)
    assert all(b.get("state") == "COMPLETE" for b in db.dw_batches.find({}))
    out = L.live(db, {"recipes": [{"pack_size_L": 1.0}]})
    assert out["available"] is True
    assert out["doses"], "doseer-targets moeten er ook zonder actieve batch zijn"
    assert out["dose_totals"]["target_kg"] > 0


def test_line_live_without_pallet_config_gives_none_not_a_guess():
    db = _db()
    out = L.live(db, {"recipes": [{"pack_size_L": 1.0}]})
    assert out["filling"]["pallets"] is None


def test_line_live_without_batches_says_so():
    db = get_db(mongo_url=None)
    seed_recipes(db)
    out = L.live(db, {})
    assert out["available"] is False
    assert out["reason"]
