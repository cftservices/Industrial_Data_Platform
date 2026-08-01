"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { KpiTile } from "@/components/toolkit/KpiTile";
import { LossBlock } from "@/components/toolkit/LossBlock";
import { StatusPill } from "@/components/toolkit/StatusPill";
import { useKpiSummary } from "@/lib/queries";
import { shortTime, windowLabel } from "@/lib/format";

/**
 * Scherm 12, management overview (spec §12).
 *
 * De opening van de demo richting de koper: bedrag, oorzaak, handeling, en pas
 * daarna de draaiende fabriek als onthulling.
 *
 * Het venster staat in de URL (?window=week), zodat een bevinding deelbaar en
 * bookmarkbaar is en de terugknop werkt. Dat is Shneiderman's "history" en
 * "extract", de twee taken die iedereen vergeet naast overview-zoom-details.
 */

const WINDOWS = [
  { id: "shift", label: "Dienst" },
  { id: "day", label: "Dag" },
  { id: "week", label: "Week" },
  { id: "month", label: "Maand" },
] as const;

export function ManagementOverview() {
  const params = useSearchParams();
  const router = useRouter();
  const window = params.get("window") ?? "week";

  const { data, isPending, isError, error, refetch, dataUpdatedAt } = useKpiSummary(window, true);

  function setWindow(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("window", id);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 p-3 pb-16 sm:gap-5 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line-strong pb-4">
        <div className="flex flex-col gap-0.5">
          <span className="eyebrow">Managementoverzicht &middot; scherm 12</span>
          <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">DairyWorks, lijn Vla</h1>
          <span className="text-[0.8125rem] text-ink-muted">
            {data ? windowLabel(data.window, data.from) : " "}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow" id="lbl-window">
              Venster
            </span>
            <div
              role="group"
              aria-labelledby="lbl-window"
              className="inline-flex overflow-hidden rounded-[var(--radius-tile)] border border-line-strong bg-surface"
            >
              {WINDOWS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={window === w.id}
                  onClick={() => setWindow(w.id)}
                  className={`border-r border-line px-2.5 py-1 text-[0.8125rem] last:border-r-0 ${
                    window === w.id
                      ? "bg-ink font-semibold text-canvas"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="eyebrow">Gegevens</span>
            <span className="flex items-center gap-2 text-[0.8125rem] text-ink-muted">
              {isError ? (
                <StatusPill status="alarm">Engine offline</StatusPill>
              ) : (
                <StatusPill status="ok">Live</StatusPill>
              )}
              <span className="num">
                {dataUpdatedAt ? `bijgewerkt ${shortTime(new Date(dataUpdatedAt).toISOString())}` : ""}
              </span>
            </span>
          </div>
        </div>
      </header>

      {/* Per-blok foutafhandeling: de KPI-rij en het verliesblok falen los van
          elkaar. Een storing in het ene mag het andere niet leegmaken. */}
      {isError ? (
        <section className="tile flex flex-col items-start gap-3">
          <StatusPill status="alarm">KPI&apos;s niet beschikbaar</StatusPill>
          <p className="text-[0.8125rem] text-ink-muted">
            {(error as { message?: string })?.message ?? "onbekende fout"}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-[var(--radius-tile)] border border-line-strong px-3 py-1 text-[0.8125rem] font-semibold hover:border-ink-muted"
          >
            Opnieuw proberen
          </button>
        </section>
      ) : isPending ? (
        <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,215px),1fr))]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="tile h-[188px] animate-pulse bg-surface-sunken" />
          ))}
        </section>
      ) : (
        <>
          <section aria-label="Kernprestatie-indicatoren">
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(215px,1fr))]">
              {data.kpis.map((kpi) => (
                <KpiTile key={kpi.kpi_id} kpi={kpi} />
              ))}
            </div>
          </section>

          <div className="grid items-start gap-5 lg:[grid-template-columns:minmax(0,1.55fr)_minmax(0,1fr)]">
            <LossBlock losses={data.losses} window={windowLabel(data.window, data.from)} />

            <section className="tile flex flex-col gap-3">
              <div>
                <span className="eyebrow">Venstercontract</span>
                <h2 className="text-base font-semibold tracking-[-0.01em]">Scherm en rapport</h2>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8125rem] text-ink-muted">
                <dt className="font-semibold">Van</dt>
                <dd className="num">{data.from.slice(0, 16).replace("T", " ")}</dd>
                <dt className="font-semibold">Tot</dt>
                <dd className="num">{data.to.slice(0, 16).replace("T", " ")}</dd>
                <dt className="font-semibold">Tijdzone</dt>
                <dd>{data.timezone}</dd>
                <dt className="font-semibold">Dienst</dt>
                <dd className="num">{data.shift_hours} uur</dd>
              </dl>
              <p className="text-[0.8125rem] text-ink-muted">
                Het PDF krijgt exact dezelfde parameters mee, zodat scherm en rapport gegarandeerd
                hetzelfde getal tonen.
              </p>
              <a
                href={`/api/v1/report/period?days=7&format=pdf`}
                target="_blank"
                rel="noreferrer"
                className="self-start rounded-[var(--radius-tile)] border border-line-strong px-3 py-1.5 text-[0.8125rem] font-semibold hover:border-ink-muted"
              >
                Periode-rapport (PDF)
              </a>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
