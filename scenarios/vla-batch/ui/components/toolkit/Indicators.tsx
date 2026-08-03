import type { ReactNode } from "react";

/**
 * De drie afwijkingsindicatoren uit hmi-style-guide.md §6.1.
 *
 * Regel 1 van de gids: nooit een kaal getal. Elke kritieke meting krijgt een
 * band, een marker en de afstand tot de grens. "87,4 °C" zegt niets;
 * "87,4 van 88,0, nog 240 van 300 s hold" zegt alles.
 */

/* ---------------------------------------------------------------- sparkline */

/**
 * Sparkline met een grijze normaalband, naar Tufte. Voor viscositeit is die
 * band letterlijk de specificatie, dus een afwijking is zichtbaar zonder dat
 * iemand de as leest.
 */
export function Sparkline({
  values,
  band,
  tone = "neutral",
  height = 30,
  label,
}: {
  values: number[];
  /** [lo, hi] in dezelfde eenheid als de waarden. */
  band?: [number, number] | null;
  tone?: "neutral" | "warn" | "alarm" | "stale";
  height?: number;
  label?: string;
}) {
  if (values.length < 2) {
    return <div className="h-[30px] text-[0.625rem] text-ink-faint">geen reeks</div>;
  }
  const lo = Math.min(...values, band?.[0] ?? Infinity);
  const hi = Math.max(...values, band?.[1] ?? -Infinity);
  const span = hi - lo || 1;
  const y = (v: number) => 26 - ((v - lo) / span) * 22 - 2;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${y(v)}`).join(" ");

  const stroke =
    tone === "alarm"
      ? "stroke-status-alarm"
      : tone === "warn"
        ? "stroke-status-warn"
        : tone === "stale"
          ? "stroke-ink-faint"
          : "stroke-ink-muted";
  const dot =
    tone === "alarm"
      ? "fill-status-alarm"
      : tone === "warn"
        ? "fill-status-warn"
        : "fill-ink";

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      role="img"
      aria-label={label ?? "trend"}
    >
      {band && (
        <rect
          x="0"
          y={y(band[1])}
          width="100"
          height={Math.max(1, y(band[0]) - y(band[1]))}
          className="fill-band-outer"
        />
      )}
      <polyline
        points={pts}
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
        className={stroke}
        // 2 px is geen smaak: dunner haalt het eigen 3:1-contrast niet
        // (WCAG 1.4.11, elke lijn in een grafiek).
        vectorEffect="non-scaling-stroke"
        strokeDasharray={tone === "stale" ? "3 3" : undefined}
      />
      {tone !== "stale" && (
        <circle cx="99" cy={y(values[values.length - 1])} r="2" className={dot} />
      )}
    </svg>
  );
}

/* ------------------------------------------------------------ afwijkingsbalk */

/**
 * Analoge weergave van een meetwaarde ten opzichte van de normale band, met de
 * afstand tot de grens als apart getal. Dit is het middel dat het
 * HPHMI-materiaal aanbeveelt boven een kaal getal.
 */
export function DeviationBand({
  value,
  spec,
  setpoint,
  min,
  max,
  tone = "neutral",
}: {
  value: number | null;
  spec?: { min: number; max: number } | null;
  setpoint?: number | null;
  min?: number;
  max?: number;
  tone?: "neutral" | "warn" | "alarm";
}) {
  /**
   * Geen spec en geen expliciete schaal betekende tot nu toe 0 tot 100. Bij een
   * tankniveau van 5000 L stond de marker daardoor vastgepind aan de rechterkant
   * en las de as "0 ... 100" naast een getal van 5000: de balk beweerde iets
   * anders dan het cijfer ernaast. Een verzonnen schaal is erger dan geen
   * schaal, dus zonder bron tekenen we hem niet.
   */
  const heeftSchaal = spec != null || (min != null && max != null);
  if (!heeftSchaal) {
    return (
      <div className="flex h-3.5 items-center">
        <span className="text-[0.625rem] text-ink-faint">geen schaal bekend</span>
      </div>
    );
  }

  const lo = min ?? (spec ? spec.min - (spec.max - spec.min) * 0.5 : 0);
  const hi = max ?? (spec ? spec.max + (spec.max - spec.min) * 0.25 : 100);
  const span = hi - lo || 1;
  const pct = (n: number) => Math.max(0, Math.min(100, ((n - lo) / span) * 100));

  const marker =
    tone === "alarm" ? "bg-status-alarm" : tone === "warn" ? "bg-status-warn" : "bg-ink";

  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-3.5 border border-line bg-surface-sunken">
        {spec && (
          <span
            className="absolute inset-y-0 bg-band-outer"
            style={{ left: `${pct(spec.min)}%`, width: `${pct(spec.max) - pct(spec.min)}%` }}
          />
        )}
        {setpoint !== null && setpoint !== undefined && (
          <span
            className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-ink-faint"
            style={{ left: `${pct(setpoint)}%` }}
            aria-hidden="true"
          />
        )}
        {value !== null && (
          <span
            className={`absolute top-1/2 h-[18px] w-[3px] -translate-x-[1.5px] -translate-y-1/2 ${marker}`}
            style={{ left: `${pct(value)}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-[0.625rem] text-ink-faint num">
        <span>{Math.round(lo)}</span>
        {spec && (
          <>
            <span>{spec.min}</span>
            <span>{spec.max}</span>
          </>
        )}
        <span>{Math.round(hi)}</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- stale */

/**
 * Verouderde waarde: een arceerpatroon over de inhoud, geen kleur.
 *
 * Elke hue was al bezet, grijs zelfs dubbel (idle en informatief alarm). Het
 * patroon is dus de drager, en dat is meteen conform de regel dat kleur nooit
 * het enige middel mag zijn.
 */
export function StaleVeil({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-status-stale) 26%, transparent) 0 3px, transparent 3px 7px)",
        }}
      />
    </div>
  );
}
