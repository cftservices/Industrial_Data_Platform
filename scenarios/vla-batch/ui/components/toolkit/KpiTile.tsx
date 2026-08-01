"use client";

import { useState } from "react";
import { BulletGraph } from "./BulletGraph";
import { StatusPill, statusFromKpi } from "./StatusPill";
import { EMPTY, value as fmtValue } from "@/lib/format";
import type { KpiValue } from "@/lib/types";

/**
 * Eén KPI-tegel.
 *
 * Deze component REKENT NIET. Elke waarde, norm, status en delta komt
 * kant-en-klaar uit `GET /kpi/summary`. Dat is geen stijlvoorkeur maar het
 * contract: scherm en PDF lezen dezelfde endpoint, zodat ze niet uiteen kunnen
 * lopen. Een afwijkende formule hier is een bug.
 *
 * Alleen tegels die aandacht vragen krijgen kleur. Een OK-tegel blijft neutraal
 * met een klein vinkje; kleur is een signaal en geen decoratie.
 */

function Delta({ kpi }: { kpi: KpiValue }) {
  if (kpi.delta === null) {
    return <span className="text-ink-faint">geen vergelijking</span>;
  }
  const up = kpi.delta > 0;
  const arrow = kpi.delta === 0 ? "=" : up ? "▲" : "▼";
  // De pijl alleen is niet genoeg: bij lower_is_better is stijgen slecht en
  // zou een kaal driehoekje het omgekeerde suggereren.
  const tone =
    kpi.favourable === null
      ? "text-ink-muted"
      : kpi.favourable
        ? "text-favourable"
        : "text-unfavourable";
  const unit = kpi.unit === "%" ? " pp" : kpi.unit ? ` ${kpi.unit}` : "";
  return (
    <span className={`inline-flex items-center gap-1 font-semibold num ${tone}`}>
      {arrow} {fmtValue(Math.abs(kpi.delta), kpi.unit)}
      {unit}
    </span>
  );
}

export function KpiTile({ kpi }: { kpi: KpiValue }) {
  const [open, setOpen] = useState(false);
  const status = statusFromKpi(kpi.status);
  const tone = status === "alarm" ? "alarm" : status === "warn" ? "warn" : "neutral";

  const edge =
    status === "alarm"
      ? "border-l-[3px] border-l-status-alarm"
      : status === "warn"
        ? "border-l-[3px] border-l-status-warn"
        : "";

  return (
    <article className={`tile flex flex-col gap-2.5 ${edge}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.8125rem] font-semibold">{kpi.name}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mono text-ink-faint hover:text-ink-muted"
          title="Definitie en herkomst"
        >
          {kpi.iso_ref || "info"}
        </button>
      </div>

      <div className="flex items-baseline gap-1.5 text-[1.75rem] leading-none font-semibold tracking-[-0.02em]">
        {kpi.value === null ? (
          <span className="text-ink-faint">{EMPTY}</span>
        ) : (
          <>
            <span className="num">{fmtValue(kpi.value, kpi.unit)}</span>
            {kpi.unit && (
              <span className="text-[0.8125rem] font-medium tracking-normal text-ink-muted">
                {kpi.unit}
              </span>
            )}
          </>
        )}
      </div>

      <BulletGraph
        value={kpi.value}
        target={kpi.target}
        warn={kpi.warn}
        critical={kpi.critical}
        direction={kpi.direction}
        tone={tone}
      />

      <div className="flex items-center justify-between gap-2 text-[0.8125rem] text-ink-muted">
        <StatusPill status={status} />
        <Delta kpi={kpi} />
      </div>

      {/* UNSET toont altijd de reden. Een tegel zonder getal moet uitleggen
          waarom, anders leest het als een storing. */}
      {kpi.reason && <p className="text-[0.6875rem] text-ink-faint">{kpi.reason}</p>}

      {open && (
        <dl className="grid grid-cols-1 gap-x-3 gap-y-1 border-t border-line pt-2 text-[0.6875rem] text-ink-muted sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold">Formule</dt>
          <dd className="mono">{kpi.formula}</dd>
          <dt className="font-semibold">Timing</dt>
          <dd>{kpi.timing}</dd>
          <dt className="font-semibold">Doelgroep</dt>
          <dd>{kpi.audience}</dd>
          <dt className="font-semibold">Methodologie</dt>
          <dd>{kpi.production_methodology}</dd>
          <dt className="font-semibold">Venster</dt>
          <dd className="num">
            {kpi.from.slice(0, 16).replace("T", " ")} tot {kpi.to.slice(0, 16).replace("T", " ")}
          </dd>
        </dl>
      )}
    </article>
  );
}
