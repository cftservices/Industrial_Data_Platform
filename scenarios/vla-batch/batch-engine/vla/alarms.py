"""Alarmlaag: lezen, parkeren en de belasting meten.

Tot nu toe bestond er alleen `POST /alarms/{id}/ack`. Alarmen zaten wel in
`dw_alarms`, maar er was geen leesroute, geen shelve en geen enkele maat voor
de belasting. Scherm 14 en de vaste alarmstrook zijn daar niet zonder te
bouwen.

De richtwaarden komen uit ISA-18.2 en IEC 62682, via twee onafhankelijke
vakartikelen omdat de normtekst betaald is. **Het zijn aanbevolen richtwaarden,
geen verplichte grenzen**, en zo horen ze ook geformuleerd te worden, ook in
verkoopmateriaal.

Twee attributies die we NIET maken, omdat de verificatieronde ze onderuit
haalde: de flood-definitie ">10 in 10 minuten" hoort bij EEMUA 191 en niet bij
ISA-18.2, en de chattering-drempel van drie activaties per minuut is
praktijkmetriek. ISA-18.2 geeft voor chattering simpelweg nul als target.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

# Geannuncieerde alarmen per operatorconsole. Links "zeer waarschijnlijk
# acceptabel", rechts "maximaal hanteerbaar". Te meten over minimaal 30 dagen.
RATE_TARGETS = {
    "per_10min": {"acceptable": 1, "max": 2},
    "per_hour": {"acceptable": 6, "max": 12},
    "per_day": {"acceptable": 150, "max": 300},
}

# Aanbevolen prioriteitsverdeling, circa. Niet meer dan drie of vier niveaus.
PRIORITY_MIX = {"high": 5, "medium": 15, "low": 80}

# Wel als ISA-18.2-target bevestigd in de verificatieronde.
STALE_HOURS = 24
STALE_PER_DAY_TARGET = 5
FLOOD_TIME_SHARE_TARGET = 0.01

# De engine schrijft severity als vrije tekst; dit is de vertaling naar de drie
# prioriteiten die de UI kent. Vier severities op drie kleuren lieten High en
# Medium samenvallen, waardoor de circa 15 procent midden niet van de circa
# 5 procent hoog te onderscheiden was.
_PRIORITY = {
    "CRITICAL": "high",
    "HIGH": "high",
    "MEDIUM": "medium",
    "WARNING": "medium",
    "LOW": "low",
    "INFO": "low",
}


def priority_of(alarm: dict) -> str:
    return _PRIORITY.get(str(alarm.get("severity", "")).upper(), "low")


def _parse(ts) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def state_of(alarm: dict, now: Optional[datetime] = None) -> str:
    """open | acknowledged | shelved. Een verlopen parkering telt weer als open:
    parkeren is tijdelijk en moet vanzelf terugvallen, anders verdwijnt een
    alarm stilletjes voorgoed."""
    now = now or _now()
    until = _parse(alarm.get("shelved_until"))
    if until and until > now:
        return "shelved"
    if alarm.get("acknowledged"):
        return "acknowledged"
    return "open"


def list_alarms(db, since: Optional[str] = None, priority: Optional[str] = None,
                state: Optional[str] = None, limit: int = 200) -> list[dict]:
    now = _now()
    cutoff = _parse(since)
    out = []
    for a in db.dw_alarms.find({}):
        ts = _parse(a.get("ts"))
        if cutoff and (ts is None or ts < cutoff):
            continue
        row = {**a, "priority": priority_of(a), "state": state_of(a, now)}
        if priority and row["priority"] != priority:
            continue
        if state and row["state"] != state:
            continue
        out.append(row)
    out.sort(key=lambda r: r.get("ts") or "", reverse=True)
    return out[:limit]


def shelve(db, alarm_id: str, reason: str, until: str, operator_id: Optional[str]) -> dict:
    """Parkeer een alarm. Reden en einddatum zijn VERPLICHT: een parkering
    zonder beide is een alarm dat stil verdwijnt, en dat is precies wat
    alarmmanagement moet voorkomen."""
    row = db.dw_alarms.find_one({"alarm_id": alarm_id})
    if row is None:
        raise ValueError(f"unknown alarm {alarm_id}")
    if not reason or not str(reason).strip():
        raise ValueError("shelve requires a reason")
    until_dt = _parse(until)
    if until_dt is None:
        raise ValueError("shelve requires a valid ISO 'until' timestamp")
    if until_dt <= _now():
        raise ValueError("shelve 'until' must lie in the future")

    db.dw_alarms.update_one(
        {"alarm_id": alarm_id},
        {"$set": {"shelved_reason": str(reason).strip(),
                  "shelved_until": until,
                  "shelved_by": operator_id,
                  "shelved_at": _now().isoformat()}},
    )
    updated = db.dw_alarms.find_one({"alarm_id": alarm_id})
    return {**updated, "priority": priority_of(updated), "state": state_of(updated)}


def alarm_load(db, start: datetime, end: datetime, now: Optional[datetime] = None) -> dict:
    """De belasting over [start, end), tegen de richtwaarden.

    Dit hoort op L1 als live KPI. Produceert de simulatie in normaal bedrijf
    meer dan circa 1 alarm per 10 minuten, dan faalt de eigen showcase op de
    norm die hij verkoopt.
    """
    now = now or _now()
    horizon = min(end, now)
    hours = max((horizon - start).total_seconds() / 3600.0, 0.0)

    rows = []
    for a in db.dw_alarms.find({}):
        ts = _parse(a.get("ts"))
        if ts is not None and start <= ts < horizon:
            rows.append((ts, a))

    if hours <= 0:
        return {"available": False, "reason": "venster heeft geen lengte"}

    total = len(rows)
    per_hour = round(total / hours, 2)
    counts = {"high": 0, "medium": 0, "low": 0}
    for _, a in rows:
        counts[priority_of(a)] += 1
    mix = {k: (round(v / total * 100, 1) if total else None) for k, v in counts.items()}

    # Flood: aandeel van de tijd met meer dan tien alarmen in een venster van
    # tien minuten. Toegeschreven aan EEMUA 191, niet aan ISA-18.2.
    buckets: dict[int, int] = {}
    for ts, _ in rows:
        idx = int((ts - start).total_seconds() // 600)
        buckets[idx] = buckets.get(idx, 0) + 1
    windows = max(1, int(hours * 6))
    flood_windows = sum(1 for c in buckets.values() if c > 10)

    stale_cut = now - timedelta(hours=STALE_HOURS)
    stale = [a for _, a in rows
             if state_of(a, now) == "open" and (_parse(a.get("ts")) or now) < stale_cut]

    # Grootste veroorzakers: een eigenschap van de eigen data, nooit gepresenteerd
    # als geciteerd industriecijfer.
    by_source: dict[str, int] = {}
    for _, a in rows:
        key = f"{a.get('equipment_id') or 'onbekend'}/{a.get('alarm_type') or 'onbekend'}"
        by_source[key] = by_source.get(key, 0) + 1
    top = sorted(by_source.items(), key=lambda kv: -kv[1])[:5]

    return {
        "available": True,
        "from": start.isoformat(),
        "to": horizon.isoformat(),
        "total": total,
        "per_hour": per_hour,
        "per_10min": round(total / (hours * 6), 2) if hours else None,
        "per_day": round(total / hours * 24, 1) if hours else None,
        "targets": RATE_TARGETS,
        "mix_pct": mix,
        "mix_targets_pct": PRIORITY_MIX,
        "counts": counts,
        "flood_time_share": round(flood_windows / windows, 4),
        "flood_target": FLOOD_TIME_SHARE_TARGET,
        "stale_over_24h": len(stale),
        "stale_target_per_day": STALE_PER_DAY_TARGET,
        "top_sources": [
            {"source": k, "count": v, "share_pct": round(v / total * 100, 1) if total else None}
            for k, v in top
        ],
    }
