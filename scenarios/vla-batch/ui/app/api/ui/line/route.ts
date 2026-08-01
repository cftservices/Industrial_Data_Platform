import { readFile } from "node:fs/promises";
import { STEPS, statusTopic } from "@/lib/domain/uns";

/**
 * De L1-payload, stap-georienteerd.
 *
 * Voegt drie bronnen samen zodat de browser er maar een hoeft te kennen:
 *   - GET /line/live      batch, doseringen, vulling, kwaliteit
 *   - GET /tags?verbose=1 waarde, ts, quality en leeftijd per topic
 *   - factory-model.json  specbanden, drempels, vulgrenzen
 *
 * En het belangrijkste: hier wordt bepaald of een waarde VEROUDERD is. Dat kan
 * alleen hier, want het vergt de koppeling tussen topic en processtap, en die
 * kennis blijft server-side (lib/domain/uns.ts draagt `server-only`).
 *
 * Zonder dit toont een tag die minutenlang stilligt zijn laatste waarde alsof
 * die actueel is. Bij een poll van 1,5 seconde is dat de meest waarschijnlijke
 * faalmodus van de hele demo.
 */

export const dynamic = "force-dynamic";

const ENGINE = process.env.ENGINE_URL ?? "http://vla-batch-engine:8000";
const MODEL_PATH = process.env.FACTORY_MODEL ?? "/model/isa95-vla.json";
const DEFAULT_STALE_S = 90;

type Reading = {
  value: number | string | null;
  ts: string | null;
  unit: string | null;
  quality: string;
  retained: boolean;
  age_s: number | null;
};

async function engine<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${ENGINE}/api/v1${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function toNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const [live, tags, loaded] = await Promise.all([
    engine<Record<string, unknown>>("/line/live"),
    engine<Record<string, Reading>>("/tags?verbose=1"),
    readFile(MODEL_PATH, "utf-8")
      .then((t) => ({ ok: true, model: JSON.parse(t) as Record<string, unknown> }))
      .catch(() => ({ ok: false, model: {} as Record<string, unknown> })),
  ]);

  const model = loaded.model;
  // Een stille terugval op de default is precies wat we elders verbieden: het
  // scherm zou dan een specband tonen die nergens vandaan komt, of juist geen
  // band zonder te zeggen waarom. Melden dus, en de UI beslist wat hij toont.
  const modelAvailable = loaded.ok;
  const staleAfter = Number(model.stale_threshold_s ?? DEFAULT_STALE_S);
  const staleFromModel = modelAvailable && model.stale_threshold_s !== undefined;
  const recipe = ((model.recipes as Array<Record<string, unknown>>) ?? [{}])[0] ?? {};
  const viscSpec = recipe.viscosity_spec_cP as { min: number; max: number } | undefined;

  const reading = (area: string, eq: string, tag: string): Reading | null =>
    tags?.[statusTopic(area, eq, tag)] ?? null;

  /**
   * Verouderd volgens drie onafhankelijke signalen. Een waarde hoeft er maar
   * een te raken: quality die niet GOOD is, een leeftijd boven de drempel, of
   * alleen ooit een retained bericht gezien (dan is er nooit iets live geweest).
   */
  function isStale(r: Reading | null): boolean {
    if (!r) return false;
    if (r.retained) return true;
    if (r.quality && r.quality !== "GOOD" && r.quality !== "UNKNOWN") return true;
    return r.age_s !== null && r.age_s > staleAfter;
  }

  const steps = STEPS.map((s) => {
    const primary = reading(s.area, s.equipment, s.primary.tag);
    const secondary = s.secondary.map((t) => ({
      label: t.label,
      unit: t.unit,
      value: toNumber(reading(s.area, s.equipment, t.tag)?.value),
      stale: isStale(reading(s.area, s.equipment, t.tag)),
    }));

    const stale = isStale(primary) || secondary.some((x) => x.stale);
    const value = toNumber(primary?.value);

    // Alleen de kookstap heeft een tweezijdige specificatie. De rest toont een
    // waarde met context, maar zonder verzonnen band.
    const spec = s.id === "cooking" ? (viscSpec ?? null) : null;
    let tone: "neutral" | "warn" | "alarm" = "neutral";
    let distance: { label: string; value: number; unit: string } | null = null;
    if (spec && value !== null) {
      if (value < spec.min) {
        tone = "alarm";
        distance = { label: "onder ondergrens", value: spec.min - value, unit: s.primary.unit };
      } else if (value > spec.max) {
        tone = "alarm";
        distance = { label: "boven bovengrens", value: value - spec.max, unit: s.primary.unit };
      } else {
        const toLow = value - spec.min;
        const toHigh = spec.max - value;
        const near = Math.min(toLow, toHigh) < (spec.max - spec.min) * 0.2;
        tone = near ? "warn" : "neutral";
        distance =
          toLow <= toHigh
            ? { label: "naar ondergrens", value: toLow, unit: s.primary.unit }
            : { label: "naar bovengrens", value: toHigh, unit: s.primary.unit };
      }
    }

    return {
      id: s.id,
      name: s.name,
      equipment: s.equipment,
      primary: {
        label: s.primary.label,
        unit: s.primary.unit,
        value,
        ts: primary?.ts ?? null,
        age_s: primary?.age_s ?? null,
        quality: primary?.quality ?? "UNKNOWN",
      },
      secondary,
      spec,
      distance,
      tone,
      stale,
    };
  });

  return Response.json(
    {
      available: Boolean(live?.available) || Boolean(tags),
      engine_reachable: live !== null,
      bus_has_tags: Boolean(tags && Object.keys(tags).length),
      model_available: modelAvailable,
      model_path: modelAvailable ? undefined : MODEL_PATH,
      stale_threshold_s: staleAfter,
      stale_threshold_from_model: staleFromModel,
      steps,
      line: live ?? null,
      fill_limits_ml: model.fill_limits_ml ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
