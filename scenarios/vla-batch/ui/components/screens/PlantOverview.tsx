"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlarmBar } from "@/components/toolkit/AlarmBar";
import { DeviationBand } from "@/components/toolkit/Indicators";
import { KpiTile } from "@/components/toolkit/KpiTile";
import { StatusPill, statusFromKpi, type Status } from "@/components/toolkit/StatusPill";
import { getUi, post } from "@/lib/client";
import { EMPTY, num, value as fmt } from "@/lib/format";
import { POLL, useAlarms, useEquipmentHealth, useKpiSummary, useOrders } from "@/lib/queries";
import type { Alarm } from "@/lib/types";

/**
 * Scherm 11, plant overview, EN scherm 1, de sales-landing.
 *
 * Een implementatie, twee presentaties. `?view=sales` schakelt de framing om:
 * dezelfde blokken, andere kop en zonder de bedieningsdetails. In v0.5 waren
 * dit twee schermen die dezelfde vier blokken toonden met andere chrome, en
 * sinds de demo voor de koper op scherm 12 opent, verviel de reden voor een
 * aparte landing.
 *
 * Beantwoordt de supervisorsvraag: ligt de dienst op plan.
 */

type Step = {
  id: string;
  name: string;
  primary: { label: string; unit: string; value: number | null };
  spec: { min: number; max: number } | null;
  tone: "neutral" | "warn" | "alarm";
  stale: boolean;
};

type LinePayload = {
  engine_reachable: boolean;
  steps: Step[];
  line: {
    batch?: { batch_id: string; state: string; verdict: string | null };
    filling?: { packs_total: number; packs_target: number | null; packs_progress_pct: number | null };
  } | null;
};

type Order = {
  order_id: string;
  status: string;
  target_qty_L: number;
  progress?: { produced_L?: number; progress_pct?: number; batches_count?: number };
};

type Equipment = { equipment_id: string; state: string; batches_since_cip?: number };

function eqStatus(state: string): Status {
  switch (state) {
    case "Running":
      return "run";
    case "Dirty":
      return "warn";
    // Down en Error zijn NOOIT grijs: een defect procesdeel mag er niet
    // uitzien als een stilstaand procesdeel. Dat was de fout in v0.5.
    case "Down":
    case "Error":
      return "alarm";
    case "Allocated":
      return "idle";
    default:
      return "idle";
  }
}

export function PlantOverview() {
  const params = useSearchParams();
  const sales = params.get("view") === "sales";

  const line = useQuery<LinePayload>({
    queryKey: ["ui", "line"],
    queryFn: ({ signal }) => getUi<LinePayload>("/line", signal),
    refetchInterval: POLL.live,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const kpi = useKpiSummary("day", true);
  const orders = useOrders<Order[]>();
  const equipment = useEquipmentHealth<Equipment[]>();
  const alarms = useAlarms();

  async function ack(id: string) {
    await post(`/alarms/${id}/ack`, { operator_id: "op-01" });
    await alarms.refetch();
  }

  const batch = line.data?.line?.batch;
  const cook = line.data?.steps?.find((s) => s.id === "cooking");
  // De kwaliteitsstap is de hero van de sales-landing. Bewust een eigen
  // afwijkingsbalk en geen ingebed Grafana-paneel: hier wordt "embedded"
  // zichtbaar, en de bullet graph is juist ontworpen als gauge-vervanger.
  const openOrders = (orders.data ?? []).filter((o) => o.status !== "DONE");

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 p-3 pb-16 sm:gap-5 sm:p-6">
      {!sales && (
        <AlarmBar alarms={(alarms.data ?? []) as Alarm[]} load={kpi.data?.alarm_load} onAck={ack} />
      )}

      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line-strong pb-4">
        <div>
          <span className="eyebrow">
            {sales ? "DairyWorks, live demo" : "Plant overview, dienst"}
          </span>
          <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">
            {sales ? "Een beveiligde URL, een draaiende fabriek" : "DairyWorks, lijn Vla"}
          </h1>
          <span className="text-[0.8125rem] text-ink-muted">
            {batch ? (
              <>
                Batch{" "}
                <Link
                  href={`/batches?batch=${batch.batch_id}`}
                  className="mono font-semibold text-accent underline underline-offset-2 hover:text-ink"
                >
                  {batch.batch_id}
                </Link>{" "}
                &middot; {batch.state}
              </>
            ) : (
              <>
                Geen actieve batch,{" "}
                <Link
                  href="/scada"
                  className="font-semibold text-accent underline underline-offset-2 hover:text-ink"
                >
                  start er een
                </Link>
              </>
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-[0.8125rem]">
          {[
            { href: sales ? "/" : "/?view=sales", label: sales ? "Plant overview" : "Sales-weergave" },
            { href: "/management", label: "Management" },
            { href: "/line", label: "Lijn L1" },
            { href: "/orders", label: "Orders" },
            { href: "/shopfloor", label: "Werkvloer" },
          ].map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="border border-line-strong px-3 py-1.5 font-semibold whitespace-nowrap hover:border-ink-muted"
            >
              {a.label}
            </Link>
          ))}
        </div>
      </header>

      <section aria-label="Kwaliteitsstap" className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="tile flex flex-col gap-3">
          <div>
            <span className="eyebrow">De kwaliteitsstap</span>
            <h2 className="text-base font-semibold">Viscositeit</h2>
          </div>
          {cook ? (
            <>
              <span
                className={`text-[2.25rem] leading-none font-semibold tracking-[-0.025em] num ${
                  cook.tone === "alarm"
                    ? "text-status-alarm"
                    : cook.tone === "warn"
                      ? "text-status-warn"
                      : ""
                }`}
              >
                {cook.primary.value === null ? EMPTY : fmt(cook.primary.value, "cP")}
                <span className="ml-1 text-[0.8125rem] font-medium text-ink-muted">cP</span>
              </span>
              <DeviationBand value={cook.primary.value} spec={cook.spec} tone={cook.tone} />
              <p className="text-[0.8125rem] text-ink-muted">
                Te laag koken geeft te lage viscositeit, buiten spec, en dan gaat de batch op HOLD.
                Ruwe data leidt tot een echte beslissing.
              </p>
            </>
          ) : (
            <p className="text-[0.8125rem] text-ink-muted">Geen procesdata beschikbaar.</p>
          )}
        </div>

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,215px),1fr))]">
          {(kpi.data?.kpis ?? [])
            .filter((k) =>
              ["quality_ratio", "scrap_ratio", "plan_attainment_pct", "throughput_rate"].includes(
                k.kpi_id,
              ),
            )
            .map((k) => (
              <KpiTile key={k.kpi_id} kpi={k} />
            ))}
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="tile flex flex-col gap-3">
          <div>
            <span className="eyebrow">Gepland tegen geproduceerd</span>
            <h2 className="text-base font-semibold">Orders</h2>
          </div>
          {openOrders.length === 0 ? (
            <p className="text-[0.8125rem] text-ink-muted">
              Geen openstaande orders.{" "}
              <Link
                href="/orders"
                className="font-semibold text-accent underline underline-offset-2"
              >
                Maak er een aan
              </Link>
              .
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {openOrders.map((o) => (
                <li
                  key={o.order_id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-line py-[var(--density-row)] last:border-b-0 sm:grid-cols-[7rem_1fr_5rem]"
                >
                  <span className="mono">
                    <Link
                      href={`/orders?order=${o.order_id}`}
                      className="font-semibold text-accent underline underline-offset-2 hover:text-ink"
                    >
                      {o.order_id}
                    </Link>
                  </span>
                  <span className="h-1.5 bg-surface-sunken">
                    <i
                      className="block h-full bg-ink-muted"
                      style={{ width: `${Math.min(100, o.progress?.progress_pct ?? 0)}%` }}
                    />
                  </span>
                  <span className="text-right text-[0.8125rem] font-semibold num">
                    {num(o.progress?.produced_L ?? 0, 0)} / {num(o.target_qty_L, 0)} L
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="tile flex flex-col gap-3">
          <div>
            <span className="eyebrow">Procesdelen</span>
            <h2 className="text-base font-semibold">Equipment</h2>
          </div>
          {(equipment.data ?? []).length === 0 && (
            <p className="text-[0.8125rem] text-ink-muted">
              Nog geen procesdelen bekend. Draait de engine?
            </p>
          )}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {(equipment.data ?? []).map((e) => (
              <li key={e.equipment_id} className="flex items-center justify-between gap-3">
                <span className="mono">
                  <Link
                    href={`/equipment`}
                    title={`${e.equipment_id}: CIP, draaiuren, OEE`}
                    className="font-semibold text-accent underline underline-offset-2 hover:text-ink"
                  >
                    {e.equipment_id}
                  </Link>
                </span>
                <span className="flex items-center gap-3">
                  {e.batches_since_cip !== undefined && (
                    <span className="text-[0.6875rem] text-ink-faint num">
                      {e.batches_since_cip} sinds CIP
                    </span>
                  )}
                  <StatusPill status={eqStatus(e.state)}>{e.state}</StatusPill>
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/equipment"
            className="self-start text-[0.8125rem] font-semibold text-accent underline underline-offset-2"
          >
            Naar equipment health
          </Link>
        </section>
      </div>

      {kpi.data && (
        <section className="tile flex flex-wrap items-center gap-4">
          <span className="eyebrow">Vandaag tegen gisteren</span>
          {kpi.data.kpis
            .filter((k) => k.status !== "UNSET")
            .slice(0, 5)
            .map((k) => (
              <span key={k.kpi_id} className="flex items-center gap-2 text-[0.8125rem]">
                <StatusPill status={statusFromKpi(k.status)}>{k.name}</StatusPill>
                <span className="font-semibold num">
                  {fmt(k.value, k.unit)} {k.unit}
                </span>
              </span>
            ))}
        </section>
      )}
    </main>
  );
}
