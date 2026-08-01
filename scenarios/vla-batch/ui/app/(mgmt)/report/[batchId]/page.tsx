import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill, type Status } from "@/components/toolkit/StatusPill";
import { EMPTY, num, shortDateTime } from "@/lib/format";

/**
 * Scherm 6, het batchrapport (EBR).
 *
 * Server-gerenderd: dit is een bewijsstuk, geen live scherm. Het moet ook
 * monochroom leesbaar zijn, dus elke status draagt naast kleur een vorm en een
 * woord.
 *
 * Tot de audit van 02-08 stond hier `JSON.stringify(report, null, 2)` in een
 * <pre>. De spec noemt dit scherm het bewijsstuk van de demo, en het toonde een
 * ontwikkelaarsdump: een QA-medewerker kon er niet in vinden of de dosering
 * binnen tolerantie viel, en een auditor niet of het verdict ondertekend was.
 * De engine leverde die gegevens wel degelijk, netjes gestructureerd; alleen
 * werd er niets mee gedaan.
 *
 * De ruwe JSON blijft beschikbaar, maar ingeklapt en onderaan. Voor een
 * technische lezer is hij nuttig; voor de lezer waar dit document voor bedoeld
 * is, is hij ruis.
 *
 * De twee ondertekeningsvelden komen uit de audit: de Codex HACCP-tekst van
 * 2003 eist ondertekening door zowel de uitvoerder als een reviewer. Die versie
 * is in 2020 vervangen en of de dubbele ondertekening daar nog woordelijk in
 * staat is niet geverifieerd, dus dit staat er als goede praktijk en niet als
 * bewijsbaar formele eis.
 */

export const dynamic = "force-dynamic";

const ENGINE = process.env.ENGINE_URL ?? "http://vla-batch-engine:8000";

type Dose = {
  material_id?: string;
  lot_no?: string | null;
  qty_target?: number | null;
  qty_actual?: number | null;
  in_tolerance?: boolean | null;
  tol_min?: number | null;
  tol_max?: number | null;
};

type Sample = {
  sample_id?: string;
  sample_type?: string;
  phase?: string;
  status?: string;
  result?: string;
  value?: number | null;
  unit?: string | null;
  ts?: string;
};

type AlarmRow = {
  alarm_id?: string;
  message?: string;
  equipment_id?: string | null;
  alarm_type?: string | null;
  ts?: string;
};

type Hu = {
  hu_id?: string;
  packs_count?: number | null;
  location?: string | null;
  status?: string | null;
  ts?: string;
};

type Report = Record<string, unknown> & {
  report_type?: string;
  site?: string;
  line?: string;
  header?: Record<string, unknown>;
  doses?: Dose[];
  cook?: Record<string, number | null>;
  quality?: { end_viscosity_cP?: number | null; spec_min_cP?: number | null; spec_max_cP?: number | null };
  packs?: { packs_total?: number; reject_count?: number };
  samples?: Sample[];
  alarms?: AlarmRow[];
  handling_units?: Hu[];
  production?: Array<{ packs?: number; source?: string; operator_id?: string | null; ts?: string }>;
  events?: Array<{ event_type?: string; ts?: string }>;
  verdict?: string;
  verdict_ack?: { operator_id?: string | null; ts?: string } | null;
  critical_alarm_during_batch?: boolean;
  order?: { order_id?: string; target_qty_L?: number; due_date?: string | null; status?: string } | null;
};

function verdictStatus(v: string): Status {
  return v === "APPROVED" ? "ok" : v === "HOLD" ? "warn" : v === "REJECTED" ? "alarm" : "unset";
}

/** Een blok met een kop. Elke sectie van het rapport ziet er hetzelfde uit. */
function Block({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tile flex break-inside-avoid flex-col gap-3">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Feiten({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.8125rem]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="num">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-[0.6875rem] font-semibold tracking-[0.06em] uppercase text-ink-faint">
      {children}
    </th>
  );
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  let report: Report | null = null;
  try {
    const r = await fetch(`${ENGINE}/api/v1/report/${encodeURIComponent(batchId)}?format=json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    report = r.ok ? await r.json() : null;
  } catch {
    report = null;
  }
  if (!report) notFound();

  const verdict = String(report.verdict ?? "PENDING");
  const status = verdictStatus(verdict);
  const h = report.header ?? {};
  const q = report.quality ?? {};
  const cook = report.cook ?? {};
  const spec =
    q.spec_min_cP != null && q.spec_max_cP != null
      ? { min: q.spec_min_cP, max: q.spec_max_cP }
      : null;
  const visc = q.end_viscosity_cP ?? null;
  const inSpec = spec && visc !== null ? visc >= spec.min && visc <= spec.max : null;

  const doses = report.doses ?? [];
  const samples = report.samples ?? [];
  const alarms = report.alarms ?? [];
  const hus = report.handling_units ?? [];
  const events = report.events ?? [];
  const ack = report.verdict_ack ?? null;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-4 pb-16 sm:p-6 print:p-0">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line-strong pb-4">
        <div>
          <span className="eyebrow">{String(report.report_type ?? "Batchrapport")}</span>
          <h1 className="mono text-[1.375rem] font-semibold">{batchId}</h1>
          <span className="text-[0.8125rem] text-ink-muted">
            {String(report.site ?? "")} {report.line ? `· lijn ${report.line}` : ""}
            {h.product_name ? ` · ${String(h.product_name)}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={status}>{verdict}</StatusPill>
          <div className="flex items-center gap-3 print:hidden">
            <a
              href={`/api/v1/report/${encodeURIComponent(batchId)}?format=pdf`}
              target="_blank"
              rel="noreferrer"
              className="border border-line-strong px-3 py-1.5 text-[0.8125rem] font-semibold hover:border-ink-muted"
            >
              PDF
            </a>
            <Link href="/batches" className="text-[0.8125rem] text-ink-muted hover:text-ink">
              Terug
            </Link>
          </div>
        </div>
      </header>

      {/* Het oordeel bovenaan, want dat is waar de lezer voor komt. */}
      <Block eyebrow="Vrijgavebeslissing" title="Verdict">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusPill status={status}>{verdict}</StatusPill>
          <span className="text-[0.8125rem] text-ink-muted">
            {ack ? (
              <>
                Ondertekend door{" "}
                <span className="mono">{ack.operator_id ?? "onbekend"}</span> op{" "}
                <span className="num">{shortDateTime(ack.ts)}</span>.
              </>
            ) : (
              "Nog niet ondertekend."
            )}
          </span>
          {report.critical_alarm_during_batch && (
            <StatusPill status="alarm">Kritiek alarm tijdens deze batch</StatusPill>
          )}
        </div>
      </Block>

      <Block eyebrow="Identificatie" title="Batch en order">
        <div className="grid gap-4 sm:grid-cols-2">
          <Feiten
            rows={[
              ["Recept", <span className="mono">{String(h.recipe_id ?? EMPTY)}</span>],
              ["Toestand", String(h.state ?? EMPTY)],
              ["Gepland", h.planned_L != null ? `${num(Number(h.planned_L), 0)} L` : EMPTY],
              ["Aangemaakt", shortDateTime(h.created_at as string)],
              ["Gestart", shortDateTime(h.started_at as string)],
              ["Afgerond", shortDateTime(h.completed_at as string)],
            ]}
          />
          {report.order ? (
            <Feiten
              rows={[
                ["Order", <span className="mono">{report.order.order_id ?? EMPTY}</span>],
                [
                  "Ordervolume",
                  report.order.target_qty_L != null
                    ? `${num(report.order.target_qty_L, 0)} L`
                    : EMPTY,
                ],
                ["Leverdatum", shortDateTime(report.order.due_date ?? undefined)],
                ["Orderstatus", report.order.status ?? EMPTY],
              ]}
            />
          ) : (
            <p className="text-[0.8125rem] text-ink-muted">
              Deze batch hoort niet bij een order en telt daarom niet mee voor OTIF of
              planrealisatie.
            </p>
          )}
        </div>
      </Block>

      <Block eyebrow="Grondstoffen" title="Doseringen">
        {doses.length === 0 ? (
          <p className="text-[0.8125rem] text-ink-muted">Geen doseringen vastgelegd.</p>
        ) : (
          <div className="table-scroll">
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr className="border-b border-line">
                  <Th>Materiaal</Th>
                  <Th>Lot</Th>
                  <Th>Doel</Th>
                  <Th>Werkelijk</Th>
                  <Th>Tolerantie</Th>
                  <Th>Oordeel</Th>
                </tr>
              </thead>
              <tbody>
                {doses.map((d, i) => (
                  <tr key={`${d.material_id}-${i}`} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 mono">{d.material_id ?? EMPTY}</td>
                    <td className="px-3 py-1.5 mono text-ink-muted">{d.lot_no ?? EMPTY}</td>
                    <td className="px-3 py-1.5 num">
                      {d.qty_target != null ? `${num(d.qty_target, 1)} kg` : EMPTY}
                    </td>
                    <td className="px-3 py-1.5 num font-semibold">
                      {d.qty_actual != null ? `${num(d.qty_actual, 1)} kg` : EMPTY}
                    </td>
                    <td className="px-3 py-1.5 num text-ink-muted">
                      {d.tol_min != null && d.tol_max != null
                        ? `${num(d.tol_min, 1)} t/m ${num(d.tol_max, 1)}`
                        : EMPTY}
                    </td>
                    <td className="px-3 py-1.5">
                      {/* Binnen of buiten band is het enige dat een auditor hier
                          zoekt; als kale getallen was dat zelf uitrekenen. */}
                      {d.in_tolerance === null || d.in_tolerance === undefined ? (
                        <StatusPill status="unset">Niet beoordeeld</StatusPill>
                      ) : d.in_tolerance ? (
                        <StatusPill status="ok">Binnen band</StatusPill>
                      ) : (
                        <StatusPill status="alarm">Buiten band</StatusPill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Block eyebrow="Kritieke stap" title="Koken en hold">
          <Feiten
            rows={[
              [
                "Piektemperatuur",
                cook.peak_cook_temp_C != null ? `${num(cook.peak_cook_temp_C, 1)} °C` : EMPTY,
              ],
              [
                "Setpoint",
                cook.cook_setpoint_C != null ? `${num(cook.cook_setpoint_C, 0)} °C` : EMPTY,
              ],
              ["Hold vereist", cook.hold_sec != null ? `${num(cook.hold_sec, 0)} s` : EMPTY],
              [
                "Hold gehaald",
                cook.hold_elapsed_sec != null ? `${num(cook.hold_elapsed_sec, 0)} s` : EMPTY,
              ],
            ]}
          />
        </Block>

        <Block eyebrow="Kwaliteitsstap" title="Eindviscositeit">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl leading-none font-semibold num">
              {visc === null ? EMPTY : num(visc, 0)}
            </span>
            <span className="text-[0.8125rem] text-ink-muted">cP</span>
            {inSpec !== null && (
              <StatusPill status={inSpec ? "ok" : "alarm"}>
                {inSpec ? "Binnen spec" : "Buiten spec"}
              </StatusPill>
            )}
          </div>
          <p className="text-[0.8125rem] text-ink-muted num">
            {spec ? `specificatie ${spec.min} t/m ${spec.max} cP` : "geen specificatie vastgelegd"}
          </p>
          <Feiten
            rows={[
              ["Pakken", num(report.packs?.packs_total ?? 0, 0)],
              ["Afgekeurd", num(report.packs?.reject_count ?? 0, 0)],
            ]}
          />
        </Block>
      </div>

      <Block eyebrow="Controles" title="Monsters">
        {samples.length === 0 ? (
          <p className="text-[0.8125rem] text-ink-muted">Geen monsters genomen voor deze batch.</p>
        ) : (
          <div className="table-scroll">
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr className="border-b border-line">
                  <Th>Monster</Th>
                  <Th>Type</Th>
                  <Th>Fase</Th>
                  <Th>Waarde</Th>
                  <Th>Uitslag</Th>
                  <Th>Tijd</Th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s, i) => (
                  <tr key={s.sample_id ?? i} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 mono">{s.sample_id ?? EMPTY}</td>
                    <td className="px-3 py-1.5">{s.sample_type ?? EMPTY}</td>
                    <td className="px-3 py-1.5 text-ink-muted">{s.phase ?? EMPTY}</td>
                    <td className="px-3 py-1.5 num">
                      {s.value == null ? EMPTY : `${num(s.value, 1)} ${s.unit ?? ""}`.trim()}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusPill status={s.result === "fail" ? "alarm" : "ok"}>
                        {s.result ?? s.status ?? EMPTY}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-1.5 num text-ink-muted">{shortDateTime(s.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Block eyebrow="Afwijkingen" title="Alarmen tijdens deze batch">
          {alarms.length === 0 ? (
            <p className="text-[0.8125rem] text-ink-muted">
              Geen alarmen tijdens deze batch. Dat is een vaststelling, geen ontbrekende meting.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[0.8125rem]">
              {alarms.map((a, i) => (
                <li key={a.alarm_id ?? i} className="flex flex-col border-b border-line pb-1.5 last:border-b-0">
                  <span>{a.message ?? EMPTY}</span>
                  <span className="mono text-[0.6875rem] text-ink-faint">
                    {a.equipment_id ?? "lijn"}
                    {a.alarm_type ? `/${a.alarm_type}` : ""} · {shortDateTime(a.ts)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block eyebrow="Expeditie" title="Handling units">
          {hus.length === 0 ? (
            <p className="text-[0.8125rem] text-ink-muted">Nog niet verpakt.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[0.8125rem]">
              {hus.map((u, i) => (
                <li key={u.hu_id ?? i} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="mono">{u.hu_id ?? EMPTY}</span>
                  <span className="num">{num(u.packs_count ?? 0, 0)} pakken</span>
                  <span className="text-ink-muted">
                    {u.status ?? EMPTY}
                    {u.location ? ` · ${u.location}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      {events.length > 0 && (
        <Block eyebrow="Chronologie" title="Gebeurtenissen">
          <ol className="m-0 flex list-none flex-col p-0 text-[0.8125rem]">
            {events.map((e, i) => (
              <li
                key={`${e.event_type}-${i}`}
                className="flex items-baseline justify-between gap-3 border-b border-line py-1 last:border-b-0"
              >
                <span>{e.event_type ?? EMPTY}</span>
                <span className="num text-ink-muted">{shortDateTime(e.ts)}</span>
              </li>
            ))}
          </ol>
        </Block>
      )}

      <Block eyebrow="Vrijgave" title="Ondertekening">
        <p className="text-[0.8125rem] text-ink-muted">
          Twee gescheiden velden: de uitvoerder en een reviewer. Goede praktijk uit de Codex
          HACCP-tekst van 2003; de huidige versie is niet op deze eis geverifieerd.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {["Uitgevoerd door", "Beoordeeld door"].map((label) => (
            <div key={label} className="flex flex-col gap-6">
              <span className="text-[0.6875rem] font-semibold tracking-[0.06em] uppercase text-ink-faint">
                {label}
              </span>
              <span className="border-b border-ink-muted" />
              <span className="text-[0.6875rem] text-ink-faint">naam, datum, handtekening</span>
            </div>
          ))}
        </div>
      </Block>

      {/* Ruwe gegevens blijven beschikbaar, maar ingeklapt: nuttig voor een
          technische lezer, ruis voor de QA-medewerker voor wie dit bedoeld is. */}
      <details className="tile print:hidden">
        <summary className="cursor-pointer text-[0.8125rem] font-semibold">
          Ruwe gegevens (JSON)
        </summary>
        <pre className="mt-2 overflow-x-auto text-[0.75rem] leading-relaxed mono">
          {JSON.stringify(report, null, 2)}
        </pre>
      </details>
    </main>
  );
}
