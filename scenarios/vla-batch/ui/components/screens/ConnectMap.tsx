"use client";

import { useQuery } from "@tanstack/react-query";
import { ScreenHeader } from "@/components/nav/ScreenHeader";
import { getUi } from "@/lib/client";
import { POLL } from "@/lib/queries";

/**
 * De Connect-kaart: links de rommel, rechts de betekenis.
 *
 * Dit scherm bestaat om een stelling te bewijzen die je anders alleen kunt
 * vertellen. Elke rij toont wat een leverancierssysteem een meting NOEMT en
 * waar diezelfde meting na Condition en Model UITKOMT. `Ch1.Dev2.TT_3003_PV`
 * met waarde 1904 naast `Cook/pasteuriser-01/Status/hold_temp_C` in graden
 * Celsius, en dan is het gesprek voorbij.
 *
 * Twee kolommen, nooit samengevoegd. Zodra je de ruwe naam weglaat is het een
 * gewoon taglijstje en verdwijnt precies het punt.
 *
 * Draait het vendor-profile niet, dan is er niets ruws en zegt het scherm dat.
 * Dat is geen storing: de milkdemo hoort zonder dat profile gewoon te werken.
 */

type Point = {
  native: string;
  description: string | null;
  nativeUnit: string | null;
  nativeScale: number;
  rawTopic: string;
  canonicalTopic: string | null;
  canonicalUnit: string | null;
  retired: boolean;
};

type System = {
  id: string;
  equipment: string;
  area: string;
  archetype: string;
  vendor: string;
  protocol: string;
  endpoint: string;
  ingest: string;
  nativeTimestamp: string;
  nativeQuality: string;
  points: Point[];
};

type Layer = {
  model_layer_enabled: boolean;
  aliases_active: number;
  stale_tags: number;
  cross_checks: number;
  counters: Record<string, number>;
} | null;

type ConnectPayload = {
  rawRoot: string;
  systems: System[];
  totals: { systems: number; points: number; protocols: number; unmapped: number };
  layer: Layer;
  error?: string;
};

/** Wat een bron NIET levert, en dus wat de Condition-stap moet repareren. */
function gaps(s: System): string[] {
  const out: string[] = [];
  if (s.nativeTimestamp === "none") out.push("geen meettijd");
  if (s.nativeTimestamp === "local-no-timezone") out.push("lokale tijd, geen zone");
  if (s.nativeQuality === "none") out.push("geen kwaliteit");
  if (s.nativeQuality === "da-quality-word") out.push("kwaliteit in een ander topic");
  return out;
}

export function ConnectMap() {
  const { data, isLoading } = useQuery<ConnectPayload>({
    queryKey: ["ui", "connect"],
    queryFn: ({ signal }) => getUi<ConnectPayload>("/connect", signal),
    refetchInterval: POLL.aggregates,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const layer = data?.layer ?? null;

  return (
    <div className="flex flex-col gap-3">
      <ScreenHeader
        eyebrow="Data layer"
        title="Connect"
        subtitle="Wat de leverancier het noemt, en wat het betekent"
      />

      {isLoading && <p className="text-[0.8125rem] text-ink-muted">Laden…</p>}

      {data && data.systems.length === 0 && (
        <p className="text-[0.8125rem] text-ink-muted">
          Geen leverancierseilanden actief. Start de stack met{" "}
          <span className="num">--profile vendor</span> om ze te zien. Zonder dat
          profile draait de demo zoals altijd.
        </p>
      )}

      {data && data.systems.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3 border-t border-line bg-surface-sunken p-3">
            <Stat label="Bronsystemen" value={data.totals.systems} />
            <Stat label="Ruwe punten" value={data.totals.points} />
            <Stat label="Protocollen" value={data.totals.protocols} />
            <Stat
              label="Nog niet gemodelleerd"
              value={data.totals.unmapped}
              muted={data.totals.unmapped === 0}
            />
            <Stat
              label="Model-laag"
              text={
                layer
                  ? layer.model_layer_enabled
                    ? "aan"
                    : "UIT"
                  : "draait niet"
              }
            />
            {layer && <Stat label="Verouderd" value={layer.stale_tags} />}
          </div>

          {layer && !layer.model_layer_enabled && (
            <p className="text-[0.8125rem] text-status-alarm">
              De Model-laag staat uit. Ruwe data komt binnen, de UNS krijgt niets,
              en de schermen die eruit lezen lopen leeg. Zet hem aan om alles
              terug te laten komen.
            </p>
          )}

          {data.systems.map((s) => (
            <section key={s.id} className="flex flex-col gap-2 border-t border-line p-3">
              <header className="flex flex-col gap-0.5">
                <span className="eyebrow">
                  {s.protocol} · {s.area} · {s.vendor}
                </span>
                <span className="num">{s.equipment}</span>
                <span className="text-[0.8125rem] text-ink-muted">
                  {s.archetype} · {s.endpoint}
                </span>
                {gaps(s).length > 0 && (
                  <span className="text-[0.8125rem] text-ink-muted">
                    Levert zelf: {gaps(s).join(", ")}
                  </span>
                )}
              </header>

              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="text-ink-muted">
                    <th className="py-1 text-left font-normal">Zoals de leverancier het noemt</th>
                    <th className="py-1 text-left font-normal">Wat het betekent</th>
                  </tr>
                </thead>
                <tbody>
                  {s.points.map((p) => (
                    <tr key={p.rawTopic} className="border-t border-line">
                      <td className="py-1 pr-3 align-top">
                        <span className="num">{p.native}</span>
                        <span className="block text-ink-muted">
                          {p.nativeUnit ? `${p.nativeUnit}` : "geen eenheid"}
                          {p.nativeScale !== 1 ? ` × ${p.nativeScale}` : ""}
                          {p.description ? ` · ${p.description}` : ""}
                        </span>
                      </td>
                      <td className="py-1 align-top">
                        {p.canonicalTopic ? (
                          <>
                            <span className="num">
                              {p.canonicalTopic.replace("DairyWorks/Vla/", "")}
                            </span>
                            <span className="block text-ink-muted">
                              {p.canonicalUnit || "dimensieloos"}
                              {p.retired ? " · alias met pensioen" : ""}
                            </span>
                          </>
                        ) : (
                          // Ongemodelleerd is geen fout, het is de normale staat
                          // van een fabriek die de Model-stap nog niet deed.
                          <span className="text-ink-muted">nog niet gemodelleerd</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  text,
  muted,
}: {
  label: string;
  value?: number;
  text?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow">{label}</span>
      <span className={muted ? "num text-ink-muted" : "num"}>
        {text ?? value ?? "–"}
      </span>
    </div>
  );
}
