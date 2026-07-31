import Link from "next/link";
import { money } from "@/lib/format";
import type { Losses, LossItem } from "@/lib/types";

/**
 * Het verliesblok.
 *
 * De kern is het onderscheid causaal tegen resulterend. Downtime, HOLD en
 * plan-tekort zijn GEVOLGEN van vervuiling, geen zelfstandige verliezen. Ze bij
 * elkaar optellen laat de plant manager drie keer naar hetzelfde probleem
 * kijken. Manufacturing Cost Deployment (Yamashina en Kubo, 2002) stelt het
 * expliciet: de kosten van een resulterend verlies moeten worden begrepen als
 * kosten van hun causale verlies.
 *
 * Dus: alleen causale verliezen in de kop. Resultanten staan geindenteerd met
 * een volgt-uit-pijl en krijgen geen eigen aandeel-percentage.
 *
 * Het blok wordt NOOIT gedeeltelijk getoond. Een onvolledige rangschikking
 * leidt tot het verkeerde besluit, dus bij een fout gaat het geheel naar retry.
 */

/** Waar een verliescategorie naartoe doorklikt. */
const DRILL: Record<string, { href: string; label: string }> = {
  material_overdose: { href: "/reports?type=weigh", label: "naar afweegrapport" },
  scrap: { href: "/batches?verdict=REJECTED", label: "naar batches" },
  downtime: { href: "/equipment", label: "naar oorzaak" },
  rework: { href: "/batches?verdict=HOLD", label: "naar batches" },
};

function Row({ item, rank }: { item: LossItem; rank: number }) {
  const drill = DRILL[item.category];
  return (
    <div className="grid grid-cols-[1.4rem_minmax(0,1fr)_auto] items-center gap-2.5 py-[var(--density-row)]">
      <span className="text-[0.8125rem] font-semibold text-ink-faint num">{rank}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-semibold">{item.label}</span>
        <span className="text-[0.8125rem] text-ink-muted">
          {item.cause}
          {drill && (
            <>
              {" · "}
              <Link
                href={drill.href}
                className="font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
              >
                {drill.label}
              </Link>
            </>
          )}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5">
        <span className="font-semibold num">{money(item.amount, item.currency)}</span>
        {item.share_pct !== null && (
          <span className="text-[0.8125rem] text-ink-faint num">{item.share_pct} %</span>
        )}
      </span>
      <span className="col-start-2 col-end-4 mt-0.5 h-1 bg-surface-sunken">
        <i className="block h-full bg-ink-muted" style={{ width: `${item.share_pct ?? 0}%` }} />
      </span>
    </div>
  );
}

function Resultant({ item }: { item: LossItem }) {
  return (
    <div className="grid grid-cols-[1.4rem_1.25rem_minmax(0,1fr)_auto] items-center gap-2.5 py-0.5">
      <span />
      <span className="text-center text-[0.8125rem] text-ink-faint" aria-hidden="true">
        &#8627;
      </span>
      <span className="text-[0.8125rem] text-ink-muted">
        volgt uit: {item.label} {item.cause ? `(${item.cause})` : ""}
      </span>
      <span className="text-[0.8125rem] font-medium text-ink-muted num">
        {money(item.amount, item.currency)}
      </span>
    </div>
  );
}

export function LossBlock({ losses, window }: { losses: Losses; window: string }) {
  const causal = losses.items.filter((i) => i.causal_or_resultant === "causal");
  const resultant = losses.items.filter((i) => i.causal_or_resultant === "resultant");
  const noCostModel = losses.total_causal === null;

  return (
    <section className="tile flex flex-col gap-0 p-0" aria-labelledby="h-loss">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3.5">
        <div>
          <h2 id="h-loss" className="text-base font-semibold tracking-[-0.01em]">
            Waar zit het verlies
          </h2>
          <span className="eyebrow">Causale verliezen, {window}</span>
        </div>
        <span className="text-[2.25rem] leading-none font-semibold tracking-[-0.025em] num">
          {noCostModel ? <span className="text-ink-faint">-</span> : money(losses.total_causal, losses.currency ?? "EUR")}
        </span>
      </div>

      <div className="px-4 pt-3.5 pb-4">
        {noCostModel ? (
          <p className="text-[0.8125rem] text-ink-muted">
            Nog geen kostenmodel gekalibreerd, dus er is geen bedrag te tonen. Een verlies van
            &euro;&nbsp;0 zou lezen als &quot;geen verlies&quot;, en dat is iets anders dan
            &quot;niet gemeten&quot;.
          </p>
        ) : causal.length === 0 ? (
          <p className="text-[0.8125rem] text-ink-muted">
            Geen afgesloten batches in dit venster. Het verliesblok is verborgen, want een
            onvolledige rangschikking leidt tot het verkeerde besluit.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {causal.map((item, i) => (
              <li key={item.category} className="border-b border-line pb-1.5 last:border-b-0">
                <Row item={item} rank={i + 1} />
                {resultant
                  .filter((r) => r.caused_by === item.category)
                  .map((r) => (
                    <Resultant key={r.category} item={r} />
                  ))}
              </li>
            ))}
          </ul>
        )}

        {losses.omitted.length > 0 && !noCostModel && (
          <ul className="mt-2 list-none border-t border-dashed border-line-strong pt-2 text-[0.8125rem] text-ink-faint">
            {losses.omitted.map((o) => (
              <li key={o.category} className="flex justify-between gap-2 py-0.5">
                <span>{o.category}</span>
                <span>niet gekalibreerd</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {resultant.length > 0 && (
        <p className="border-t border-line bg-surface-sunken px-4 py-2.5 text-[0.8125rem] text-ink-muted">
          {resultant.length} resulterend{resultant.length === 1 ? " verlies is" : "e verliezen zijn"}{" "}
          <strong>niet</strong> bij het totaal opgeteld: ze volgen uit hun oorzaak.
        </p>
      )}
    </section>
  );
}
