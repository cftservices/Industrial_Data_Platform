import type { ReactNode } from "react";

/**
 * De statustabel uit hmi-style-guide.md §4.
 *
 * Elke toestand is kleur PLUS vorm PLUS tekst. WCAG SC 1.4.1 is niveau A en
 * verbiedt kleur als enige drager (failure F81), en het batchrapport wordt
 * monochroom geprint. Acceptatietest: zet het scherm in grijswaarden, dan moet
 * de vorm het onderscheid alleen al dragen.
 *
 * Twee dingen die hier bewust anders zijn dan in v0.5:
 *   - `done` is gedempt en niet donkergroen. Twee tinten van hetzelfde hue als
 *     enige verschil tussen "draait" en "klaar" is geen onderscheid.
 *   - `unset` deelt de kleur van `idle` en verschilt door een HOLLE balk. De
 *     lichtere grijstint haalde 1.4.11 niet (2,16 tegen wit).
 */

export type Status =
  | "ok"
  | "run"
  | "warn"
  | "alarm"
  | "idle"
  | "done"
  | "unset"
  | "stale"
  | "shelved";

const TONE: Record<Status, string> = {
  ok: "text-status-run",
  run: "text-status-run",
  warn: "text-status-warn",
  alarm: "text-status-alarm",
  idle: "text-status-idle",
  done: "text-status-done",
  unset: "text-status-unset",
  stale: "text-status-stale",
  shelved: "text-status-idle",
};

const LABEL: Record<Status, string> = {
  ok: "Op norm",
  run: "Draait",
  warn: "Waarschuwing",
  alarm: "Kritiek",
  idle: "Stil",
  done: "Afgerond",
  unset: "Geen norm",
  stale: "Verouderd",
  shelved: "Geparkeerd",
};

/** De vormen. Elk statustype heeft er een eigen, en die is de echte drager. */
export function Glyph({ status, className = "" }: { status: Status; className?: string }) {
  const c = `${TONE[status]} ${className}`;
  const box = "inline-block h-2.5 w-2.5 shrink-0";

  switch (status) {
    case "ok":
    case "done":
      // cirkel met vinkje
      return (
        <svg viewBox="0 0 10 10" className={`${box} ${c}`} aria-hidden="true" fill="none">
          <circle cx="5" cy="5" r="4.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 5.2 4.4 6.6 7 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "run":
      return <span className={`${box} rounded-full bg-current ${c}`} aria-hidden="true" />;
    case "warn":
      // driehoek
      return (
        <svg viewBox="0 0 10 10" className={`${box} ${c}`} aria-hidden="true">
          <path d="M5 0.6 9.6 9.2H0.4z" fill="currentColor" />
        </svg>
      );
    case "alarm":
      // gevulde ruit
      return (
        <svg viewBox="0 0 10 10" className={`${box} ${c}`} aria-hidden="true">
          <path d="M5 0.4 9.6 5 5 9.6 0.4 5z" fill="currentColor" />
        </svg>
      );
    case "idle":
      // gevulde balk
      return <span className={`inline-block h-[3px] w-2.5 shrink-0 bg-current ${c}`} aria-hidden="true" />;
    case "unset":
      // HOLLE balk: het onderscheid met idle zit in de vorm, niet in de kleur
      return (
        <span
          className={`inline-block h-[5px] w-2.5 shrink-0 border border-current ${c}`}
          aria-hidden="true"
        />
      );
    case "shelved":
      // open vierkant
      return (
        <span className={`inline-block h-2.5 w-2.5 shrink-0 border-2 border-current ${c}`} aria-hidden="true" />
      );
    case "stale":
      // arceerpatroon: elke hue was al bezet, dus het patroon is de drager
      return (
        <svg viewBox="0 0 10 10" className={`${box} ${c}`} aria-hidden="true">
          <defs>
            <pattern id="hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="3" stroke="currentColor" strokeWidth="1.6" />
            </pattern>
          </defs>
          <rect x="0.5" y="0.5" width="9" height="9" fill="url(#hatch)" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
  }
}

export function StatusPill({
  status,
  children,
  className = "",
}: {
  status: Status;
  /** Overschrijft het standaardlabel. De tekst mag nooit helemaal weg. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] whitespace-nowrap ${TONE[status]} ${className}`}
    >
      <Glyph status={status} />
      {children ?? LABEL[status]}
    </span>
  );
}

/** Mapt de KPI-status uit de engine op de visuele statustaal. */
export function statusFromKpi(s: string): Status {
  switch (s) {
    case "OK":
      return "ok";
    case "WARNING":
      return "warn";
    case "CRITICAL":
      return "alarm";
    default:
      return "unset";
  }
}
