"""condition.py: turn a raw vendor reading into a fact. Pure, no I/O.

This is step 2 and step 3 of the seven, and it is where the demo earns its
argument. A raw topic carries something like

    raw/vla/pasteuriser-01/Ch1.Dev2.TT_3003_PV   {"value": 1904, "timestamp": ..., "status": 0}

and 1904 is not a temperature. It is not even a number with a unit. To make it
mean something you need five separate facts that live nowhere in the payload:

    * it is tenths, not units                       (scale)
    * of degrees Fahrenheit, not Celsius            (native_unit)
    * its quality is in a DIFFERENT topic           (the .Q companion)
    * that quality is a DA word, not a StatusCode   (quality_source)
    * there is no measurement time, only arrival    (timestamp_source)

Every one of those comes from conditioning.json, and the identity it maps onto
comes from aliases.json. Config, not code: a conversion you cannot see in a git
diff is a conversion you cannot audit, and in food production audit is the whole
point.

Everything here is a pure function of (payload, rule, state) so selftest.py can
prove it with no broker, no Mongo and no network.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

LITRE_PER_GALLON = 3.785411784

# Vendor unit -> canonical (SI) unit. The exact inverse of what the sims apply,
# which is the point: the vendor did nothing wrong, it just answers in its own
# units, and somebody has to agree what the plant's units are.
CONVERT = {
    ("degF", "C"): lambda v: (v - 32.0) * 5.0 / 9.0,
    ("gal", "L"): lambda v: v * LITRE_PER_GALLON,
    ("gal/min", "L/min"): lambda v: v * LITRE_PER_GALLON,
    ("lbs", "kg"): lambda v: v * 0.45359237,
    ("psi", "bar"): lambda v: v / 14.503773773,
}

GOOD, BAD, UNCERTAIN = "GOOD", "BAD", "UNCERTAIN"

# OPC-UA StatusCode severity lives in the top two bits.
UA_BAD = 0x80000000
UA_UNCERTAIN = 0x40000000


class ConditionError(Exception):
    """Raised when a reading cannot be conditioned. Never guess."""


def parse_payload(raw: bytes | str) -> dict:
    """Accept the shapes the different connectors actually emit.

    MonsterMQ's OPC-UA client publishes {value, timestamp, status}. Our own
    gateway publishes {v, rx_ts, src_ts, src}. A bare scalar is also possible.
    Normalising this zoo is itself part of the Condition step: there is no
    single raw payload contract, and pretending there is would hide the problem.
    """
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    raw = raw.strip()
    if not raw:
        raise ConditionError("empty payload")
    if raw[0] not in "{[":
        try:
            return {"value": float(raw)}
        except ValueError:
            return {"value": raw}
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as ex:
        raise ConditionError(f"payload is not JSON: {ex}") from ex
    if not isinstance(doc, dict):
        return {"value": doc}
    if "value" not in doc and "v" in doc:
        doc["value"] = doc["v"]
    return doc


def to_canonical(value: float, native_unit: str, canonical_unit: str) -> float:
    if not native_unit or native_unit == canonical_unit or native_unit == "bool":
        return value
    fn = CONVERT.get((native_unit, canonical_unit))
    if fn is None:
        raise ConditionError(f"no conversion {native_unit!r} -> {canonical_unit!r}")
    return fn(value)


def map_quality(rule: dict, payload: dict, companion_quality: int | None,
                defaults: dict) -> str:
    """Collapse each vendor's idea of quality onto GOOD / BAD / UNCERTAIN.

    Note what this costs the DA island: its quality lives in a SEPARATE topic,
    so a consumer that just reads the value topic has no idea whether to trust
    it. That is not a hypothetical failure mode, it is the default one.
    """
    source = rule.get("quality_source", "none")
    if source == "da-quality-word":
        if companion_quality is None:
            # The value arrived and its quality has not. Refuse to assume GOOD.
            return UNCERTAIN
        table = defaults["quality_map"]["da-quality-word"]
        return table.get(str(int(companion_quality)), UNCERTAIN)
    if source == "opcua-statuscode":
        status = payload.get("status")
        if status is None:
            return UNCERTAIN
        status = int(status)
        if status & UA_BAD:
            return BAD
        if status & UA_UNCERTAIN:
            return UNCERTAIN
        return GOOD
    return GOOD


def resolve_timestamp(rule: dict, payload: dict, received: datetime,
                      defaults: dict) -> tuple[str, str]:
    """Return (iso8601 UTC, how we got it).

    A source with no measurement time gets the ARRIVAL time and is labelled
    ts_source="receive". That label matters: a consumer computing a rate, or a
    regulator reading a batch record, is entitled to know the timestamp is when
    the number showed up rather than when the process did the thing.

    A local timestamp with no zone is the single most common real-world defect,
    so the zone to assume is declared, never guessed.
    """
    source = rule.get("timestamp_source", "none")
    if source == "none":
        return received.astimezone(timezone.utc).isoformat(), "receive"

    raw_ts = payload.get("timestamp") or payload.get("src_ts") or payload.get("ts")
    if raw_ts is None:
        return received.astimezone(timezone.utc).isoformat(), "receive"

    if isinstance(raw_ts, (int, float)):
        # epoch, in seconds or milliseconds. Above ~1e11 it cannot be seconds.
        seconds = raw_ts / 1000.0 if raw_ts > 1e11 else float(raw_ts)
        return (datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat(),
                "source")

    text = str(raw_ts).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return received.astimezone(timezone.utc).isoformat(), "receive"
    if dt.tzinfo is None:
        offset = defaults.get("assume_tz_offset_minutes", 120)
        dt = dt.replace(tzinfo=timezone(timedelta(minutes=offset)))
        return dt.astimezone(timezone.utc).isoformat(), "source-assumed-tz"
    return dt.astimezone(timezone.utc).isoformat(), "source"


def condition(payload: dict, alias: dict, rule: dict, defaults: dict, *,
              received: datetime,
              companion_quality: int | None = None,
              last_published: float | None = None) -> dict | None:
    """Raw reading -> UNS message, or None when the deadband suppresses it.

    The returned payload is the LOCKED UNS contract {value, unit, ts, quality}
    plus provenance fields. The contract keys keep every existing consumer
    working unchanged; the extra keys are additive, and vla/bus.py only reads
    the four contract keys, so adding them is risk-free.
    """
    value = payload.get("value")
    if value is None:
        raise ConditionError("payload carries no value")
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ConditionError(f"value {value!r} is not numeric") from None

    value *= float(rule.get("scale", 1.0) or 1.0)
    value = to_canonical(value, rule.get("native_unit", ""),
                         rule.get("canonical_unit", ""))

    quality = map_quality(rule, payload, companion_quality, defaults)
    ts, ts_source = resolve_timestamp(rule, payload, received, defaults)

    # Deadband. The agitator_rpm incident is the argument: one tag produced 5.34
    # of the historian's 5.35 million rows because every scan republished an
    # unchanged number. Suppress only GOOD readings; a quality change must always
    # get through, or a consumer never learns the instrument went bad.
    deadband = float(rule.get("deadband", defaults.get("deadband", 0.0)) or 0.0)
    if (deadband > 0.0 and last_published is not None and quality == GOOD
            and abs(value - last_published) < deadband):
        return None

    return {
        "value": value,
        "unit": alias.get("canonical_unit", ""),
        "ts": ts,
        "quality": quality,
        # provenance: which island said this, what it called it, and whether the
        # time is a measurement or an arrival. Without these a modelled tag is
        # untraceable, and an untraceable number in a batch record is a finding.
        "source_system": alias.get("source_system"),
        "native_name": alias.get("native_name"),
        "signal_uuid": alias.get("canonical_signal_uuid"),
        "ts_source": ts_source,
    }


def is_stale(last_seen: datetime | None, now: datetime, rule: dict,
             stale_threshold_s: float) -> bool:
    """A tag nobody has heard from is not a tag reading zero.

    hmi-style-guide: stale renders as a hatch pattern, never a colour, and a
    missing number is a dash, never a 0.
    """
    if last_seen is None:
        return True
    limit = max(float(rule.get("expected_interval_s", 60)) * 3.0,
                float(stale_threshold_s))
    return (now - last_seen).total_seconds() > limit
