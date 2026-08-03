"use client";

import Link from "next/link";
import { EMPTY, num } from "@/lib/format";

/**
 * Het procesbeeld: de installatie zelf, met live waarden erin.
 *
 * ISA-101 kent vier displayniveaus. Level 1 is het plantoverzicht, Level 3 het
 * detail per regelkring. Level 2 is het PROCESOVERZICHT: het schematische beeld
 * van de unit waar de operator de meeste tijd naar kijkt. Dat niveau ontbrak
 * hier volledig: /line toont functionele stapkaarten en /scada was alleen een
 * knoppenpaneel.
 *
 * De onderzoeksronde koos bewust tegen een P&ID als PRIMAIR operatorscherm, en
 * die keuze blijft: /line is en blijft de functionele strook. Maar "geen P&ID
 * als hoofdscherm" is iets anders dan "geen schematisch beeld". Een operator
 * die een storing zoekt, wil zien waar in de lijn het product staat, en dat
 * kan een kaartenstrook niet tonen.
 *
 * Vormentaal: dun, grijs, gevuld met niets. Kleur komt alleen op een afwijking,
 * en dan nooit alleen: elke gekleurde vorm draagt ook een woord. Dat is
 * dezelfde regel als in de rest van de toolkit.
 */

export type MimicUnit = {
  id: string;
  equipment: string;
  name: string;
  /** Kernwaarde die IN de vorm komt te staan, met de naam van de meting. */
  label: string;
  value: number | null;
  unit: string;
  /** Vulniveau 0 tot 1, voor de tanks. null = geen niveaumeting. */
  fill: number | null;
  state: string;
  tone: "neutral" | "warn" | "alarm";
  stale: boolean;
  /** Regelt of de leiding NAAR deze unit stroomt. */
  active: boolean;
  extra?: Array<{ label: string; value: number | null; unit: string }>;
};

const STATE_LABEL: Record<string, string> = {
  Running: "draait",
  Dirty: "vervuild",
  Idle: "stil",
  Allocated: "gereserveerd",
  Down: "storing",
  Error: "fout",
};

/** Dezelfde indeling als op de andere schermen: Down en Error zijn NOOIT grijs. */
function stateClasses(state: string, tone: string, stale: boolean) {
  if (stale) return { stroke: "stroke-status-stale", fill: "fill-status-stale" };
  if (state === "Down" || state === "Error" || tone === "alarm")
    return { stroke: "stroke-status-alarm", fill: "fill-status-alarm" };
  if (state === "Dirty" || tone === "warn")
    return { stroke: "stroke-status-warn", fill: "fill-status-warn" };
  if (state === "Running") return { stroke: "stroke-status-run", fill: "fill-status-run" };
  return { stroke: "stroke-ink-muted", fill: "fill-ink-muted" };
}

/* ------------------------------------------------------------------ vormen */

function Pipe({ x, y, w, active }: { x: number; y: number; w: number; active: boolean }) {
  return (
    <g>
      <line
        x1={x}
        y1={y}
        x2={x + w}
        y2={y}
        className="stroke-line-strong"
        strokeWidth={active ? 6 : 3}
        strokeLinecap="round"
      />
      {active && (
        <line
          x1={x}
          y1={y}
          x2={x + w}
          y2={y}
          className="pipe-flow stroke-status-run"
          strokeWidth={3}
          strokeLinecap="butt"
        />
      )}
      {/* Pijlpunt: de richting moet ook zonder animatie te zien zijn. */}
      <path
        d={`M ${x + w - 7} ${y - 4} L ${x + w} ${y} L ${x + w - 7} ${y + 4} Z`}
        className={active ? "fill-status-run" : "fill-line-strong"}
      />
    </g>
  );
}

/** Rechthoekige vorm met vulniveau. De tanks en de kookketel delen dit. */
function Vessel({
  x,
  y,
  w,
  h,
  unit,
  rounded = 8,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  unit: MimicUnit;
  rounded?: number;
}) {
  const cls = stateClasses(unit.state, unit.tone, unit.stale);
  const level = unit.fill === null ? null : Math.max(0, Math.min(1, unit.fill));
  const fillH = level === null ? 0 : h * level;

  return (
    <g>
      {/* romp */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={rounded}
        className="fill-surface stroke-line-strong"
        strokeWidth={1.5}
      />
      {/* product */}
      {level !== null && fillH > 1 && (
        <>
          <rect
            x={x + 1.5}
            y={y + h - fillH}
            width={w - 3}
            height={fillH}
            rx={rounded / 2}
            className="fill-band-inner"
          />
          <line
            x1={x + 1.5}
            y1={y + h - fillH}
            x2={x + w - 1.5}
            y2={y + h - fillH}
            className={cls.stroke}
            strokeWidth={2}
          />
        </>
      )}
      {/* statusrand links: dezelfde 3px-rand als de tegels elders */}
      <rect x={x} y={y} width={3} height={h} rx={1.5} className={cls.fill} />
    </g>
  );
}

function Agitator({ x, y, active }: { x: number; y: number; active: boolean }) {
  return (
    <g className={active ? "stroke-ink" : "stroke-ink-faint"} strokeWidth={1.5}>
      <line x1={x} y1={y - 22} x2={x} y2={y + 10} />
      <line x1={x - 9} y1={y + 10} x2={x + 9} y2={y + 10} />
      <line x1={x - 6} y1={y + 2} x2={x + 6} y2={y + 2} />
    </g>
  );
}

/** Verwarmingsspiraal in de kookketel. Toont dat er warmte IN gaat. */
function Coil({ x, y, w, hot }: { x: number; y: number; w: number; hot: boolean }) {
  const steps = 4;
  const d = Array.from({ length: steps }, (_, i) => {
    const yy = y + i * 9;
    return `M ${x} ${yy} q ${w / 2} 8 ${w} 0`;
  }).join(" ");
  return (
    <path
      d={d}
      className={`fill-none ${hot ? "stroke-status-warn" : "stroke-line-strong"}`}
      strokeWidth={1.5}
    />
  );
}

/** Warmtewisselaar: de klassieke zigzag. */
function Exchanger({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const n = 6;
  const step = w / n;
  const d = Array.from({ length: n + 1 }, (_, i) =>
    `${i === 0 ? "M" : "L"} ${x + i * step} ${y + (i % 2 === 0 ? 0 : h)}`,
  ).join(" ");
  return <path d={d} className="fill-none stroke-line-strong" strokeWidth={2} />;
}

/** Pakken die van de vuller komen. Aantal is indicatief, niet geteld. */
function PackStream({ x, y, active }: { x: number; y: number; active: boolean }) {
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={x + i * 13}
          y={y}
          width={9}
          height={13}
          rx={1}
          className={active ? "fill-band-inner stroke-line-strong" : "fill-none stroke-line"}
          strokeWidth={1}
        />
      ))}
    </g>
  );
}

function Pallet({ x, y, count }: { x: number; y: number; count: number }) {
  const lagen = Math.min(4, Math.max(0, count));
  return (
    <g>
      <rect x={x} y={y + 34} width={44} height={7} rx={1} className="fill-none stroke-line-strong" strokeWidth={1.5} />
      {Array.from({ length: lagen }, (_, i) => (
        <rect
          key={i}
          x={x + 3}
          y={y + 26 - i * 9}
          width={38}
          height={8}
          rx={1}
          className="fill-band-mid stroke-line-strong"
          strokeWidth={1}
        />
      ))}
    </g>
  );
}

/* ------------------------------------------------------------------- label */

function Caption({
  x,
  y,
  unit,
  href,
}: {
  x: number;
  y: number;
  unit: MimicUnit;
  href: string;
}) {
  const cls = stateClasses(unit.state, unit.tone, unit.stale);
  return (
    <g>
      <text x={x} y={y} className="fill-ink text-[11px] font-semibold">
        {unit.name}
      </text>
      <text x={x} y={y + 13} className="fill-ink-faint text-[9px] font-mono">
        {unit.equipment}
      </text>
      {/* Vorm EN woord. Kleur alleen zou 1.4.1 breken. */}
      <g transform={`translate(${x}, ${y + 22})`} data-unit-state={unit.equipment}>
        <rect width={7} height={7} rx={1.5} className={cls.fill} />
        <text x={11} y={7} className="fill-ink-muted text-[9px]">
          {unit.stale ? "verouderd" : (STATE_LABEL[unit.state] ?? unit.state)}
        </text>
      </g>
      <a href={href} aria-label={`Details van ${unit.equipment}`}>
        <rect x={x - 6} y={y - 12} width={110} height={46} className="fill-none" />
      </a>
    </g>
  );
}

function Reading({ x, y, unit }: { x: number; y: number; unit: MimicUnit }) {
  const cls = stateClasses(unit.state, unit.tone, unit.stale);
  const tekst = unit.tone === "alarm" || unit.tone === "warn" ? cls.fill : "fill-ink";
  return (
    <g>
      {/* Zonder de naam van de meting is een getal in een vorm een raadsel:
          5000 in een tank kan liter, kilo of pakken zijn. */}
      <text x={x} y={y - 13} textAnchor="middle" className="fill-ink-faint text-[8px]">
        {unit.label}
      </text>
      <text x={x} y={y} textAnchor="middle" className={`${tekst} text-[16px] font-semibold num`}>
        {unit.value === null ? EMPTY : num(unit.value, unit.value >= 100 ? 0 : 1)}
      </text>
      <text x={x} y={y + 11} textAnchor="middle" className="fill-ink-faint text-[8px]">
        {unit.unit}
      </text>
    </g>
  );
}

/* -------------------------------------------------------------------- beeld */

export function Mimic({
  units,
  pallets,
  batchId,
  phase,
}: {
  units: MimicUnit[];
  pallets: number;
  batchId: string | null;
  phase: string | null;
}) {
  const by = (id: string) => units.find((u) => u.id === id);
  const ontvangst = by("receiving");
  const mengen = by("mixing");
  const koken = by("cooking");
  const koelen = by("cooling");
  const vullen = by("filling");

  const alles = [ontvangst, mengen, koken, koelen, vullen].filter(Boolean) as MimicUnit[];
  if (alles.length === 0) return null;

  // Vaste breedte, in een eigen scroller. De pagina zelf schuift nooit
  // horizontaal; brede inhoud doet dat in zijn eigen container.
  return (
    <div className="table-scroll">
      <svg
        viewBox="0 0 1120 250"
        role="img"
        aria-label={`Procesbeeld van de vla-lijn${batchId ? `, batch ${batchId}` : ""}`}
        className="h-auto w-full min-w-[62rem]"
        // Uitgesloten van de pixel-snapshots: dit beeld verandert met elke
        // fasewissel, dus het zou de toegankelijkheidstests laten flapperen.
        // De kleurredundantie wordt hier NIET losgelaten maar sterker getoetst,
        // met een DOM-assertie in e2e/procesbeeld.spec.ts: elke gekleurde vorm
        // moet een woord naast zich hebben.
        data-volatile
        data-mimic
      >
        {/* leidingen eerst, zodat de vormen erbovenop staan */}
        <Pipe x={148} y={112} w={62} active={Boolean(mengen?.active)} />
        <Pipe x={348} y={112} w={62} active={Boolean(koken?.active)} />
        <Pipe x={548} y={112} w={62} active={Boolean(koelen?.active)} />
        <Pipe x={748} y={112} w={62} active={Boolean(vullen?.active)} />
        <Pipe x={948} y={112} w={40} active={Boolean(vullen?.active)} />

        {/* 1. ontvangsttank */}
        {ontvangst && (
          <>
            <Vessel x={40} y={62} w={100} h={100} unit={ontvangst} />
            <Reading x={90} y={112} unit={ontvangst} />
            <Caption x={40} y={188} unit={ontvangst} href="/equipment" />
          </>
        )}

        {/* 2. procestank met roerder */}
        {mengen && (
          <>
            <Vessel x={240} y={62} w={100} h={100} unit={mengen} />
            <Agitator x={290} y={92} active={mengen.state === "Running"} />
            <Reading x={290} y={140} unit={mengen} />
            <Caption x={240} y={188} unit={mengen} href="/equipment" />
          </>
        )}

        {/* 3. kookketel, de kwaliteitsstap */}
        {koken && (
          <>
            <Vessel x={440} y={62} w={100} h={100} unit={koken} />
            <Coil x={452} y={128} w={76} hot={koken.state === "Running"} />
            <Reading x={490} y={108} unit={koken} />
            <Caption x={440} y={188} unit={koken} href="/equipment" />
          </>
        )}

        {/* 4. koeler */}
        {koelen && (
          <>
            <rect
              x={640}
              y={72}
              width={100}
              height={80}
              rx={4}
              className="fill-surface stroke-line-strong"
              strokeWidth={1.5}
            />
            <rect
              x={640}
              y={72}
              width={3}
              height={80}
              rx={1.5}
              className={stateClasses(koelen.state, koelen.tone, koelen.stale).fill}
            />
            <Exchanger x={654} y={124} w={72} h={14} />
            <Reading x={690} y={106} unit={koelen} />
            <Caption x={640} y={188} unit={koelen} href="/equipment" />
          </>
        )}

        {/* 5. vuller */}
        {vullen && (
          <>
            <rect
              x={840}
              y={72}
              width={100}
              height={80}
              rx={4}
              className="fill-surface stroke-line-strong"
              strokeWidth={1.5}
            />
            <rect
              x={840}
              y={72}
              width={3}
              height={80}
              rx={1.5}
              className={stateClasses(vullen.state, vullen.tone, vullen.stale).fill}
            />
            <PackStream x={863} y={128} active={vullen.state === "Running"} />
            <Reading x={890} y={104} unit={vullen} />
            <Caption x={840} y={188} unit={vullen} href="/equipment" />
          </>
        )}

        {/* 6. pallets */}
        <Pallet x={1000} y={78} count={pallets} />
        <text x={1022} y={140} textAnchor="middle" className="fill-ink text-[13px] font-semibold num">
          {num(pallets, 0)}
        </text>
        <text x={1022} y={151} textAnchor="middle" className="fill-ink-faint text-[8px]">
          pallets
        </text>

        {/* fase-aanduiding boven het geheel */}
        {phase && (
          <text x={560} y={28} textAnchor="middle" className="fill-ink-faint text-[9px] tracking-[0.14em] uppercase">
            {batchId ? `${batchId} · ${phase}` : phase}
          </text>
        )}
      </svg>
    </div>
  );
}

/** Het procesbeeld gebruikt <a> in SVG; deze helper houdt Link-gedrag erbuiten. */
export function MimicLegend() {
  return (
    <p className="text-[0.6875rem] text-ink-faint">
      Klik een procesdeel voor CIP, draaiuren en OEE. Een stromende leiding is dikker EN bewogen,
      zodat het verschil ook zonder animatie zichtbaar blijft. Zie{" "}
      <Link href="/line" className="underline underline-offset-2">
        Lijn L1
      </Link>{" "}
      voor de functionele strook met specbanden.
    </p>
  );
}
