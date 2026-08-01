import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/toolkit/StatusPill";

/**
 * Scherm 6, het batchrapport (EBR).
 *
 * Server-gerenderd: dit is een bewijsstuk, geen live scherm. Het moet ook
 * monochroom leesbaar zijn, dus elke status draagt naast kleur een vorm en een
 * woord.
 *
 * De twee ondertekeningsvelden komen uit de audit: de Codex HACCP-tekst van
 * 2003 eist ondertekening door zowel de uitvoerder als een reviewer. Die versie
 * is in 2020 vervangen en of de dubbele ondertekening daar nog woordelijk in
 * staat is niet geverifieerd, dus dit staat er als goede praktijk en niet als
 * bewijsbaar formele eis.
 */

export const dynamic = "force-dynamic";

const ENGINE = process.env.ENGINE_URL ?? "http://vla-batch-engine:8000";

type Report = Record<string, unknown> & {
  batch_id?: string;
  verdict?: string;
  report_type?: string;
  generated_at?: string;
};

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
  const status =
    verdict === "APPROVED" ? "ok" : verdict === "HOLD" ? "warn" : verdict === "REJECTED" ? "alarm" : "unset";

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 p-6 pb-16 print:p-0">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line-strong pb-4">
        <div>
          <span className="eyebrow">{String(report.report_type ?? "Batchrapport")}</span>
          <h1 className="mono text-[1.375rem] font-semibold">{batchId}</h1>
        </div>
        <div className="flex items-center gap-3 print:hidden">
          <StatusPill status={status as never}>{verdict}</StatusPill>
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
      </header>

      <section className="tile">
        <span className="eyebrow">Rapportinhoud</span>
        <pre className="mt-2 overflow-x-auto text-[0.75rem] leading-relaxed mono">
          {JSON.stringify(report, null, 2)}
        </pre>
      </section>

      <section className="tile flex flex-col gap-4">
        <div>
          <span className="eyebrow">Vrijgave</span>
          <h2 className="text-base font-semibold">Ondertekening</h2>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            Twee gescheiden velden: de uitvoerder en een reviewer. Goede praktijk uit de Codex
            HACCP-tekst van 2003; de huidige versie is niet op deze eis geverifieerd.
          </p>
        </div>
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
      </section>
    </main>
  );
}
