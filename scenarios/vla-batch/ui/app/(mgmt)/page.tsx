import Link from "next/link";

/**
 * Tijdelijke landing. Wordt in fase 4 het plant overview (spec §11), waarvan
 * de sales-landing (§1) een view-variant is.
 */
export default function Home() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <span className="eyebrow">DairyWorks</span>
        <h1 className="text-xl font-semibold tracking-tight">Lijn Vla</h1>
      </header>
      <nav className="grid gap-3 sm:grid-cols-2">
        <Link className="tile hover:border-line-strong" href="/management">
          <span className="eyebrow">Management</span>
          <p className="mt-1 text-sm text-ink-muted">
            KPI&apos;s tegen de norm, verliezen naar oorzaak
          </p>
        </Link>
        <Link className="tile hover:border-line-strong" href="/line">
          <span className="eyebrow">Operator</span>
          <p className="mt-1 text-sm text-ink-muted">
            Lijn-overzicht, vijf processtappen
          </p>
        </Link>
      </nav>
    </main>
  );
}
