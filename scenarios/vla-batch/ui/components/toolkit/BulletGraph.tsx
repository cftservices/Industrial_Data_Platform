/**
 * Bullet graph naar Stephen Few's Bullet Graph Design Specification.
 *
 * Vier regels uit die specificatie die hier letterlijk zijn overgenomen:
 *   - maximaal vijf en bij voorkeur DRIE kwalitatieve banden. Meer dan vijf
 *     "would require a level of perceptual reasoning that is not efficient
 *     enough for a dashboard";
 *   - de banden zijn intensiteiten van EEN hue, niet losse kleuren. Few's eigen
 *     reden: aparte hues "might not be distinguishable by those who are
 *     colorblind";
 *   - de featured measure staat op circa EEN DERDE van de dikte van zijn
 *     container;
 *   - de norm is een comparative marker, geen kleurvlak.
 *
 * De bullet graph is ontworpen als VERVANGER van meters en gauges. Daarom staat
 * er nergens in dit project nog een gauge, ook niet op de sales-landing.
 */

type Props = {
  /** De gemeten waarde. null toont een lege track met een streepje-schaal. */
  value: number | null;
  /** De norm (comparative measure). */
  target: number | null;
  /** Bandgrenzen. Bij higher_is_better zijn dit ondergrenzen. */
  warn: number | null;
  critical: number | null;
  direction: "higher_is_better" | "lower_is_better";
  /** Schaal. Zonder min/max wordt hij afgeleid uit de waarden. */
  min?: number;
  max?: number;
  /** Kleurt de measure-balk mee met de status; OK blijft neutraal. */
  tone?: "neutral" | "warn" | "alarm";
  label?: { lo?: string; hi?: string };
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function BulletGraph({
  value,
  target,
  warn,
  critical,
  direction,
  min,
  max,
  tone = "neutral",
  label,
}: Props) {
  const pts = [value, target, warn, critical].filter((n): n is number => n !== null);
  const lo = min ?? (pts.length ? Math.min(0, ...pts) : 0);
  const hi = max ?? (pts.length ? Math.max(...pts) * 1.15 : 1);
  const span = hi - lo || 1;
  const pct = (n: number) => clamp(((n - lo) / span) * 100);

  const measureTone =
    tone === "alarm" ? "bg-status-alarm" : tone === "warn" ? "bg-status-warn" : "bg-ink";

  /**
   * Drie banden als intensiteiten van een hue. Bij higher_is_better loopt de
   * donkerste band van de bodem tot `critical` (het slechtste gebied), bij
   * lower_is_better precies andersom.
   */
  const bands =
    critical === null || warn === null
      ? []
      : direction === "higher_is_better"
        ? [
            { from: 0, to: pct(critical), cls: "bg-band-inner" },
            { from: pct(critical), to: pct(warn), cls: "bg-band-mid" },
            { from: pct(warn), to: 100, cls: "bg-band-outer" },
          ]
        : [
            { from: 0, to: pct(warn), cls: "bg-band-outer" },
            { from: pct(warn), to: pct(critical), cls: "bg-band-mid" },
            { from: pct(critical), to: 100, cls: "bg-band-inner" },
          ];

  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-[18px] border border-line bg-surface-sunken">
        {bands.map((b, i) => (
          <span
            key={i}
            className={`absolute inset-y-0 ${b.cls}`}
            style={{ left: `${b.from}%`, width: `${Math.max(0, b.to - b.from)}%` }}
          />
        ))}

        {value !== null && (
          // featured measure: een derde van de trackdikte, verticaal gecentreerd
          <span
            className={`absolute top-1/2 left-0 h-[6px] -translate-y-1/2 ${measureTone}`}
            style={{ width: `${pct(value)}%` }}
          />
        )}

        {target !== null && (
          <span
            className="absolute top-[1px] bottom-[1px] w-[2px] -translate-x-[1px] bg-ink"
            style={{ left: `${pct(target)}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      <div className="flex justify-between text-[0.625rem] text-ink-faint num">
        <span>{label?.lo ?? Math.round(lo)}</span>
        {target !== null && <span>norm {target}</span>}
        <span>{label?.hi ?? Math.round(hi)}</span>
      </div>
    </div>
  );
}
