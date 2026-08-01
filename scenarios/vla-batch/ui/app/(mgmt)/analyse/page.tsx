/**
 * Scherm 5, ad-hoc analyse.
 *
 * Grafana in een ZICHTBAAR EIGEN KADER, niet als naadloos ingebed paneel. Een
 * ingebed panel leest altijd als Grafana: eigen fonts, eigen tooltip, eigen
 * legenda, en white-labeling is een Enterprise-feature. Doen alsof het native
 * is haal je nooit, dus presenteren we het als wat het is: een analysepaneel in
 * de tool die het team al kent.
 *
 * Dat is meteen het verkoopargument: geen lock-in, uw team houdt ad-hoc analyse
 * waar het die gewend is. Elk scherm waar een getal een beslissing draagt,
 * tekent zelf.
 *
 * Het iframe laadt same-origin op /grafana/, achter dezelfde auth-middleware.
 * Zie de deploystap: anonymous access zou de historian publiek queryable maken.
 */
const GRAFANA_PATH = process.env.NEXT_PUBLIC_GRAFANA_PATH ?? "/grafana/d/vla-line?kiosk";

export const metadata = { title: "Analyse, DairyWorks Vla" };

export default function AnalysePage() {
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 p-6 pb-16">
      <header className="border-b border-line-strong pb-4">
        <span className="eyebrow">Ad-hoc analyse &middot; scherm 5</span>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">Tijdreeksen</h1>
        <p className="mt-1 max-w-2xl text-[0.8125rem] text-ink-muted">
          Exploratie in Grafana, met de tijdpicker en de variabelen die uw team al kent. De
          beslissingsschermen tekenen zelf, zodat een getal maar op een plek wordt berekend.
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow">Analysepaneel (Grafana)</span>
          <a
            href={GRAFANA_PATH}
            target="_blank"
            rel="noreferrer"
            className="border border-line-strong px-3 py-1 text-[0.8125rem] font-semibold hover:border-ink-muted"
          >
            Openen in Grafana
          </a>
        </div>
        <div className="border-2 border-dashed border-line-strong bg-surface-sunken p-1">
          <iframe
            src={GRAFANA_PATH}
            title="Grafana analysepaneel"
            className="h-[70vh] w-full border-0 bg-surface"
          />
        </div>
      </section>
    </main>
  );
}
