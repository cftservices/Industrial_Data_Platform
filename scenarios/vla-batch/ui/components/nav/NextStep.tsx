"use client";

import Link from "next/link";

/**
 * De volgende-stapvoet.
 *
 * De demo is een keten: order aanmaken, batch, werkvloer, afsluiten, verdict,
 * expeditie. Die keten was alleen te doorlopen door zes URL's te typen. Deze
 * voet maakt hem klikbaar zonder de zijbalk, en zegt er meteen bij WAAROM dat
 * de volgende stap is.
 *
 * Bewust geen wizard: de stappen blijven los bereikbaar. Dit is een suggestie
 * bovenop de navigatie, geen vervanging ervan.
 */

export function NextStep({
  steps,
}: {
  steps: Array<{ href: string; label: string; why: string; done?: boolean }>;
}) {
  if (steps.length === 0) return null;
  return (
    <section aria-label="Volgende stap" className="tile flex flex-col gap-2">
      <span className="eyebrow">Volgende stap</span>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 sm:flex-row sm:flex-wrap">
        {steps.map((s) => (
          <li key={s.href + s.label} className="flex min-w-0 flex-col gap-0.5 sm:max-w-[18rem]">
            <Link
              href={s.href}
              className={`text-[0.8125rem] font-semibold underline underline-offset-2 ${
                s.done ? "text-ink-faint" : "text-accent hover:text-ink"
              }`}
            >
              {s.done ? "✓ " : "→ "}
              {s.label}
            </Link>
            <span className="text-[0.6875rem] text-ink-faint">{s.why}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
