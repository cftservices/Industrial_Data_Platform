"use client";

import Link from "next/link";
import { StatusPill, type Status } from "./StatusPill";
import { shortTime } from "@/lib/format";

/**
 * De vaste alarmstrook.
 *
 * Nadrukkelijk GEEN modal. De meest concrete operatorklacht die het onderzoek
 * vond, uit de mond van een Siemens-engineer, is dat alarmvensters zo opdringen
 * dat er niets anders meer op het scherm te zien is. Bij meer dan vijftig
 * gelijktijdige alarmen met veel tekst raken operators direct overbelast.
 *
 * Exact drie prioriteiten, elk met eigen kleur, vorm en cijfer. Vier severities
 * op drie kleuren lieten hoog en midden samenvallen, waardoor de circa 15
 * procent midden niet van de circa 5 procent hoog te onderscheiden was.
 */

export type Alarm = {
  alarm_id: string;
  message: string;
  equipment_id: string | null;
  alarm_type: string | null;
  batch_id: string | null;
  ts: string;
  priority: "high" | "medium" | "low";
  state: "open" | "acknowledged" | "shelved";
  shelved_reason?: string | null;
  shelved_until?: string | null;
};

export type AlarmLoad = {
  available: boolean;
  per_hour?: number;
  per_10min?: number;
  counts?: { high: number; medium: number; low: number };
  targets?: { per_hour: { acceptable: number; max: number } };
};

export const PRIORITY_STATUS: Record<Alarm["priority"], Status> = {
  high: "alarm",
  medium: "warn",
  low: "idle",
};

const PRIORITY_LABEL: Record<Alarm["priority"], string> = {
  high: "Hoog",
  medium: "Midden",
  low: "Laag",
};

function rateStatus(load: AlarmLoad): Status {
  if (!load.available || load.per_hour === undefined || !load.targets) return "unset";
  const { acceptable, max } = load.targets.per_hour;
  if (load.per_hour <= acceptable) return "ok";
  return load.per_hour <= max ? "warn" : "alarm";
}

export function AlarmBar({
  alarms,
  load,
  onAck,
}: {
  alarms: Alarm[];
  load?: AlarmLoad;
  onAck?: (id: string) => void;
}) {
  const open = alarms.filter((a) => a.state === "open");
  const counts = {
    high: open.filter((a) => a.priority === "high").length,
    medium: open.filter((a) => a.priority === "medium").length,
    low: open.filter((a) => a.priority === "low").length,
  };
  const top = open.find((a) => a.priority === "high") ?? open[0];

  return (
    <div
      role="region"
      aria-label="Alarmen"
      className={`sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1.5 border border-line-strong bg-surface px-2 py-2 sm:gap-x-5 sm:px-3 ${
        counts.high > 0 ? "border-l-[3px] border-l-status-alarm" : ""
      }`}
    >
      <div className="flex items-center gap-3.5">
        {(["high", "medium", "low"] as const).map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <StatusPill status={PRIORITY_STATUS[p]}>{PRIORITY_LABEL[p]}</StatusPill>
            <span className="text-[1.0625rem] leading-none font-bold num">{counts[p]}</span>
          </span>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 basis-full items-center gap-2 border-line pl-0 sm:basis-[22rem] sm:border-l sm:pl-4">
        {top ? (
          <>
            <StatusPill status={PRIORITY_STATUS[top.priority]}>
              {top.priority === "high" ? "1" : top.priority === "medium" ? "2" : "3"}
            </StatusPill>
            <span className="min-w-0 truncate text-[0.8125rem]">{top.message}</span>
            <span className="mono shrink-0 text-ink-faint">
              {top.equipment_id ?? "lijn"} &middot; {shortTime(top.ts)}
            </span>
            {onAck && (
              <button
                type="button"
                onClick={() => onAck(top.alarm_id)}
                className="shrink-0 rounded-[var(--radius-tile)] border border-line-strong px-2 py-1 text-[0.6875rem] font-semibold tracking-[0.04em] uppercase text-ink-muted hover:border-ink-muted hover:text-ink"
              >
                Bevestig
              </button>
            )}
          </>
        ) : (
          <span className="text-[0.8125rem] text-ink-muted">Geen openstaande alarmen</span>
        )}
      </div>

      {load?.available && (
        <span className="flex items-center gap-2 text-[0.8125rem] text-ink-muted">
          <span className="font-bold text-ink num">{load.per_hour}</span>
          alarm/uur
          <StatusPill status={rateStatus(load)}>
            {load.targets ? `richtwaarde ${load.targets.per_hour.acceptable}` : "geen norm"}
          </StatusPill>
          <Link href="/alarms" className="font-semibold text-accent underline underline-offset-2">
            alle
          </Link>
        </span>
      )}
    </div>
  );
}
