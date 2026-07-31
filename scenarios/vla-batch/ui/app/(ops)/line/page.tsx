/**
 * Tijdelijke pagina. Wordt in fase 3 het L1-fabrieksoverzicht (spec §13):
 * functionele strook van vijf processtappen, geen P&ID.
 */
export default function LinePage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <span className="eyebrow">Level 1, operator</span>
        <h1 className="text-lg font-semibold tracking-tight">Lijn Vla</h1>
      </header>
      <p className="text-sm text-ink-muted">Wordt gebouwd in fase 3.</p>
    </main>
  );
}
