"use client";

import { EMPTY, num } from "@/lib/format";

/**
 * Ronde meter.
 *
 * Even eerlijk zijn over de spanning hier. De HMI-literatuur is tegen ronde
 * meters als PRIMAIRE indicator: ze kosten veel ruimte voor een enkel getal, en
 * de bullet graph elders in deze toolkit is er de aanbevolen vervanger van.
 * Daarom staat deze component NIET op het managementoverzicht of op L1.
 *
 * Op een procesbeeld is hij wel op zijn plaats, en om een reden die er echt toe
 * doet: naast een afbeelding van de installatie leest een operator een naald
 * sneller dan een balk, omdat de stand van de naald een RUIMTELIJKE positie is
 * die je vanuit je ooghoek oppikt. Precies wat een controlekamerscherm moet
 * kunnen.
 *
 * Twee harde regels blijven staan:
 *   - de specband is een intensiteit van een hue, geen tweede kleur;
 *   - kleur draagt nooit alleen. Het getal staat er, en buiten de band komt er
 *     een WOORD bij. WCAG 1.4.1 is niveau A, geen smaak.
 */

const START = -210;
const SWEEP = 240;

function point(cx: number, cy: number, r: number, t: number) {
  const rad = ((START + t * SWEEP) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x0, y0] = point(cx, cy, r, from);
  const [x1, y1] = point(cx, cy, r, to);
  const large = (to - from) * SWEEP > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

const clamp = (t: number) => Math.min(1, Math.max(0, t));

export function Gauge({
  label,
  value,
  unit,
  min,
  max,
  spec,
  setpoint,
  tone = "neutral",
  stale = false,
  size = 128,
}: {
  label: string;
  value: number | null;
  unit: string;
  min: number;
  /** null = geen te verantwoorden bovengrens; dan tekent de meter zichzelf niet. */
  max: number | null;
  /** Tweezijdige specificatie; wordt als band op de schaal getekend. */
  spec?: { min: number; max: number } | null;
  /** Ingestelde waarde, als losse streep. Nooit hetzelfde als de meting. */
  setpoint?: number | null;
  tone?: "neutral" | "warn" | "alarm";
  stale?: boolean;
  size?: number;
}) {
  // Geen verantwoorde bovengrens betekent geen meter. Dezelfde regel als in
  // DeviationBand: een verzonnen schaal is erger dan geen schaal. Hiervoor viel
  // deze component terug op basis_L ?? 5000 en spec.max * 1.25 ?? 400, en dan
  // stond er een naald op een bereik dat nergens vandaan kwam.
  if (max === null) {
    return (
      <figure className="m-0 flex flex-col items-center gap-0.5" style={{ width: size }}>
        <div
          className="flex items-center justify-center border border-dashed border-line-strong text-center text-[0.625rem] text-ink-faint"
          style={{ width: size, height: size * 0.82 }}
        >
          geen schaal bekend
        </div>
        <figcaption className="text-[0.6875rem] font-semibold">{label}</figcaption>
      </figure>
    );
  }

  const cx = 60;
  const cy = 58;
  const r = 42;
  const span = max - min || 1;
  const t = value === null ? null : clamp((value - min) / span);

  const buiten =
    spec && value !== null && (value < spec.min || value > spec.max)
      ? value < spec.min
        ? "onder spec"
        : "boven spec"
      : null;

  const stroke =
    stale
      ? "stroke-status-stale"
      : tone === "alarm"
        ? "stroke-status-alarm"
        : tone === "warn"
          ? "stroke-status-warn"
          : "stroke-ink";

  return (
    <figure className="m-0 flex flex-col items-center gap-0.5">
      <svg
        width={size}
        height={size * 0.82}
        viewBox="0 0 120 98"
        role="img"
        aria-label={`${label}: ${value === null ? "geen waarde" : `${num(value, 1)} ${unit}`}${
          buiten ? `, ${buiten}` : ""
        }`}
        className="overflow-visible"
      >
        {/* schaal */}
        <path
          d={arc(cx, cy, r, 0, 1)}
          className="fill-none stroke-line"
          strokeWidth={9}
          strokeLinecap="butt"
        />

        {/* specband: een intensiteit, geen tweede kleur */}
        {spec && (
          <path
            d={arc(cx, cy, r, clamp((spec.min - min) / span), clamp((spec.max - min) / span))}
            className="fill-none stroke-band-mid"
            strokeWidth={9}
            strokeLinecap="butt"
          />
        )}

        {/* de meting */}
        {t !== null && (
          <path
            d={arc(cx, cy, r, 0, Math.max(t, 0.004))}
            className={`fill-none ${stroke}`}
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}

        {/* setpoint als losse streep, nooit verward met de meting */}
        {setpoint !== null && setpoint !== undefined && (
          <line
            {...(() => {
              const s = clamp((setpoint - min) / span);
              const [x0, y0] = point(cx, cy, r - 8, s);
              const [x1, y1] = point(cx, cy, r + 8, s);
              return { x1: x0, y1: y0, x2: x1, y2: y1 };
            })()}
            className="stroke-ink-muted"
            strokeWidth={1.5}
          />
        )}

        {/* naald */}
        {t !== null && (
          <>
            <line
              {...(() => {
                const [x1, y1] = point(cx, cy, r - 4, t);
                return { x1: cx, y1: cy, x2: x1, y2: y1 };
              })()}
              className={stroke}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r={3} className="fill-ink" />
          </>
        )}

        {/* het getal zelf. Zonder dit draagt de stand van de naald het alleen. */}
        <text
          x={cx}
          y={cy + 26}
          textAnchor="middle"
          className="fill-ink text-[15px] font-semibold num"
        >
          {value === null ? EMPTY : num(value, value >= 100 ? 0 : 1)}
        </text>
        <text
          x={cx}
          y={cy + 37}
          textAnchor="middle"
          className="fill-ink-faint text-[8px]"
        >
          {unit}
        </text>

        {/* schaaluiteinden, zodat de stand van de naald een betekenis heeft */}
        <text {...spread(point(cx, cy, r + 13, 0))} textAnchor="middle" className="fill-ink-faint text-[7px] num">
          {num(min, 0)}
        </text>
        <text {...spread(point(cx, cy, r + 13, 1))} textAnchor="middle" className="fill-ink-faint text-[7px] num">
          {num(max, 0)}
        </text>
      </svg>

      <figcaption className="flex flex-col items-center gap-0.5 text-center">
        <span className="text-[0.6875rem] font-semibold">{label}</span>
        {/* Het woord naast de kleur. Dit is de 1.4.1-eis, niet decoratie. */}
        {buiten && (
          <span className="text-[0.6875rem] font-semibold text-status-alarm">{buiten}</span>
        )}
        {stale && !buiten && (
          <span className="text-[0.6875rem] font-semibold text-status-stale">verouderd</span>
        )}
      </figcaption>
    </figure>
  );
}

function spread([x, y]: readonly [number, number]) {
  return { x, y: y + 2 };
}
