import random
from datetime import datetime, timedelta

import pytest

from vla.db import get_db, seed_recipes
from vla.batches import BatchRunner
from vla.equipment import EquipmentMonitor
from vla.period_reports import (assemble_period_report,
                                assemble_equipment_report,
                                render_period_pdf, render_equipment_pdf)

TELEM_OK = {"peak_cook_temp_C": 88.0, "hold_elapsed_sec": 300.0,
            "packs_total": 4980, "reject_count": 20}
TELEM_BAD = {"fault": "cook_undertemp", "magnitude": 0.6,
             "hold_elapsed_sec": 300.0, "packs_total": 4900, "reject_count": 100}


def test_period_and_equipment_reports():
    db = get_db(mongo_url=None)
    seed_recipes(db)
    mon = EquipmentMonitor(db, bus=None)
    runner = BatchRunner(db, bus=None, rng=random.Random(48), equipment=mon)
    for telem in (TELEM_OK, TELEM_OK, TELEM_BAD):
        b = runner.create_batch("chocolate-vla-1L", planned_L=5000)
        runner.start_batch(b["batch_id"], telemetry=telem)
    rep = assemble_period_report(db, days=7)
    assert rep["batches_total"] == 3
    assert rep["batches_by_verdict"]["REJECTED"] + \
           rep["batches_by_verdict"]["HOLD"] == 1
    assert rep["hold_reject_ratio"] == round(1 / 3, 4)
    assert rep["yield_pct"] > 0
    assert render_period_pdf(rep)[:4] == b"%PDF"

    er = assemble_equipment_report(db, "cook-unit-01", days=30)
    assert er["equipment_id"] == "cook-unit-01"
    assert er["running_hours"] >= 0.0
    assert render_equipment_pdf(er)[:4] == b"%PDF"
    with pytest.raises(ValueError, match="unknown"):
        assemble_equipment_report(db, "toaster-9000", days=30)


# ---------------------------------------------------------------------------
# Audit 02-08: het venstercontract tussen scherm en PDF.
#
# Het managementscherm liet je kiezen tussen dienst, dag, week en maand, en de
# PDF-knop stuurde onvoorwaardelijk days=7 mee, pal onder de tekst dat het
# rapport exact dezelfde parameters krijgt. Koos je "Maand", dan kreeg je een
# week. Deze tests houden vast dat het rapport nu hetzelfde venster gebruikt
# als GET /kpi/summary.
# ---------------------------------------------------------------------------

from vla import model as M
from vla.kpi import window_bounds
from vla.period_reports import _DOWNTIME_STATES


@pytest.mark.parametrize("window", ["shift", "day", "week", "month"])
def test_rapportvenster_is_gelijk_aan_het_kpi_venster(window):
    """Scherm en rapport moeten hetzelfde interval beslaan, anders tonen ze
    verschillende getallen terwijl het scherm belooft van niet."""
    from vla.db import get_db, seed_recipes

    db = get_db(mongo_url=None)
    seed_recipes(db)
    rep = assemble_period_report(db, window=window)

    start, end = window_bounds(window)
    # Ruime marge: beide roepen datetime.now() los van elkaar aan.
    assert abs((datetime.fromisoformat(rep["from"]) - start).total_seconds()) < 5
    assert abs((datetime.fromisoformat(rep["to"]) - end).total_seconds()) < 5
    assert rep["window"] == window


def test_een_maand_is_geen_zeven_dagen():
    """De concrete regressie: het rapport over een maand mag niet stiekem een
    week beslaan."""
    from vla.db import get_db, seed_recipes

    db = get_db(mongo_url=None)
    seed_recipes(db)
    maand = assemble_period_report(db, window="month")
    span = datetime.fromisoformat(maand["to"]) - datetime.fromisoformat(maand["from"])
    assert span > timedelta(days=27)


def test_onbekend_venster_wordt_geweigerd():
    """Liever een fout dan stilzwijgend terugvallen op een ander venster."""
    from vla.db import get_db, seed_recipes

    db = get_db(mongo_url=None)
    seed_recipes(db)
    with pytest.raises(ValueError):
        assemble_period_report(db, window="kwartaal")


def test_dagen_blijven_werken_voor_het_report_centre():
    """Het report centre laat de gebruiker zelf een aantal dagen invullen; die
    weg mag niet zijn dichtgeslagen."""
    from vla.db import get_db, seed_recipes

    db = get_db(mongo_url=None)
    seed_recipes(db)
    rep = assemble_period_report(db, days=3)
    span = datetime.fromisoformat(rep["to"]) - datetime.fromisoformat(rep["from"])
    assert abs(span - timedelta(days=3)) < timedelta(seconds=5)
    assert rep["window"] is None


def test_periodrapport_deelt_de_state_indeling_met_de_rest():
    """DERDE kopie van de indeling, gevonden bij de audit: dit bestand telde
    Dirty nog als stilstand terwijl kpi.py en equipment.py dat niet meer deden,
    dus het PDF meldde meer stilstandsgebeurtenissen dan het scherm."""
    assert _DOWNTIME_STATES is M.DOWNTIME_STATES
    assert "Dirty" not in _DOWNTIME_STATES
