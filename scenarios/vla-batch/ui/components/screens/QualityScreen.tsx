"use client";

import { useQuery } from "@tanstack/react-query";
import { ScreenHeader } from "@/components/nav/ScreenHeader";
import { getUi } from "@/lib/client";
import { POLL } from "@/lib/queries";

/**
 * Het kwaliteitsscherm: waar bronnen het oneens zijn, en wat er stil is gevallen.
 *
 * De tegenhanger van de Connect-kaart. Die laat zien DAT een meting betekenis
 * krijgt; dit scherm laat zien of je haar mag vertrouwen.
 *
 * Drie regels die het scherm afdwingt, alle drie uit de canon:
 *   * nooit gezien is niet hetzelfde als binnen tolerantie. Een vergelijking die
 *     nog nooit beide kanten zag is STIL, niet groen.
 *   * verouderd rendert als arceerpatroon, nooit als kleur (hmi-style-guide 4).
 *   * een ontbrekend getal is een streepje, nooit een 0.
 *
 * Die laatste twee lijken cosmetisch en zijn het niet: een stale waarde die er
 * normaal uitziet is de gevaarlijkste toestand die een procesbeeld kan tonen.
 */

type Check = {
  id: string;
  title: string;
  tolerance: number;
  unit: string;
  severity: string;
  deltaOnly: boolean;
  ofRecord: string;
  ofRecordFor: string | null;
  otherTag: string;
  otherFor: string | null;
  delta: number | null;
  ageS: number | null;
  seen: boolean;
  breached: boolean;
  alarmActive: boolean | null;
};

type Layer = {
  model_layer_enabled: boolean;
  aliases_active: number;
  aliases_retired: number;
  stale_tags: number;
  cross_checks: number;
  counters: Record<string, number>;
} | null;

type Payload = { checks: Check[]; layer: Layer };

const STALE_AFTER_S = 90;

export function QualityScreen() {
  const { data, isLoading } = useQuery<Payload>({
    queryKey: ["ui", "quality"],
    queryFn: ({ signal }) => getUi<Payload>("/quality", signal),
    refetchInterval: POLL.aggregates,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const layer = data?.layer ?? null;
  const counters = layer?.counters ?? {};

  return (
    <div className="flex flex-col gap-3">
      <ScreenHeader
        eyebrow="Data layer"
        title="Kwaliteit"
        subtitle="Waar bronnen het oneens zijn, en wat er stil is gevallen"
      />

      {isLoading && <p className="text-[0.8125rem] text-ink-muted">Laden…</p>}

      {data && !layer && (
        <p className="text-[0.8125rem] text-ink-muted">
          De conditioner draait niet. Start de stack met{" "}
          <span className="num">--profile vendor</span>. Zonder dat profile draait
          de demo zoals altijd.
        </p>
      )}

      {layer && (
        <div className="flex flex-wrap gap-3 border-t border-line bg-surface-sunken p-3">
          <Stat label="Aliassen actief" value={layer.aliases_active} />
          <Stat label="Met pensioen" value={layer.aliases_retired} />
          <Stat label="Verouderd" value={layer.stale_tags} warn={layer.stale_tags > 0} />
          <Stat label="Gepubliceerd" value={counters.published ?? null} />
          <Stat label="Onderdrukt" value={counters.suppressed ?? null} />
          <Stat label="Niet gemapt" value={counters.unmapped ?? null} warn={(counters.unmapped ?? 0) > 0} />
          <Stat label="Fouten" value={counters.errors ?? null} warn={(counters.errors ?? 0) > 0} />
          <Stat label="Cross-check-berichten" value={counters.cross_check_msgs ?? null} />
          <Stat
            label="Model-laag"
            text={layer.model_layer_enabled ? "aan" : "UIT"}
            warn={!layer.model_layer_enabled}
          />
        </div>
      )}

      {data?.checks.map((c) => {
        const stale = c.ageS !== null && c.ageS > STALE_AFTER_S;
        return (
          <section key={c.id} className="flex flex-col gap-2 border-t border-line p-3">
            <header className="flex flex-col gap-0.5">
              <span className="eyebrow">
                {c.id} · tolerantie {c.tolerance} {c.unit}
                {c.deltaOnly ? " · alleen verschil, geen alarm" : ` · ${c.severity}`}
              </span>
              <span>{c.title}</span>
            </header>

            <div className="flex flex-wrap items-baseline gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="eyebrow">Verschil</span>
                <span
                  className={
                    !c.seen || c.delta === null
                      ? "num text-ink-muted"
                      : c.breached
                        ? "num text-status-alarm"
                        : "num"
                  }
                  // Verouderd is een arceerpatroon en geen kleur. Een stale
                  // waarde die er normaal uitziet is de gevaarlijkste toestand
                  // die een procesbeeld kan tonen.
                  style={
                    stale
                      ? {
                          backgroundImage:
                            "repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 5px)",
                          backgroundClip: "padding-box",
                        }
                      : undefined
                  }
                >
                  {/* Nooit gezien is niet binnen tolerantie. Een streepje, geen 0. */}
                  {c.seen && c.delta !== null
                    ? `${c.delta > 0 ? "+" : ""}${c.delta.toFixed(2)} ${c.unit}`
                    : "–"}
                </span>
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="eyebrow">Status</span>
                <span
                  className={
                    !c.seen
                      ? "text-ink-muted"
                      : c.breached
                        ? "text-status-alarm"
                        : "text-ink"
                  }
                >
                  {!c.seen
                    ? "nog nooit beide kanten gezien"
                    : stale
                      ? "verouderd"
                      : c.deltaOnly
                        ? "wordt alleen gevolgd"
                        : c.breached
                          ? "buiten tolerantie"
                          : "binnen tolerantie"}
                </span>
              </div>

              {c.ageS !== null && (
                <div className="flex flex-col gap-0.5">
                  <span className="eyebrow">Leeftijd</span>
                  <span className="num text-ink-muted">{Math.round(c.ageS)}s</span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-0.5 text-[0.8125rem] text-ink-muted">
              <span>
                <span className="num">{c.ofRecord}</span> is leidend
                {c.ofRecordFor ? ` voor ${c.ofRecordFor}` : ""}
              </span>
              <span>
                <span className="num">{c.otherTag}</span>
                {c.otherFor ? ` is leidend voor ${c.otherFor}` : ""}
              </span>
            </div>
          </section>
        );
      })}

      {data && data.checks.length > 0 && (
        <p className="text-[0.8125rem] text-ink-muted">
          Beide waarden blijven gepubliceerd onder hun eigen equipment. De laag
          kiest niet stil en middelt niet: een gemiddelde is een getal dat geen
          enkel instrument ooit gemeten heeft.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  text,
  warn,
}: {
  label: string;
  value?: number | null;
  text?: string;
  warn?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow">{label}</span>
      <span className={warn ? "num text-status-alarm" : "num"}>
        {text ?? (value === null || value === undefined ? "–" : value)}
      </span>
    </div>
  );
}
