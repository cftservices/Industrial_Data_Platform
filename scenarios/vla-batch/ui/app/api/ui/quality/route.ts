import { readFile } from "node:fs/promises";

/**
 * De kwaliteitspayload: waar bronnen het oneens zijn, en wat er stil is gevallen.
 *
 * Drie bronnen samengevoegd zodat de browser er maar een hoeft te kennen:
 *   - source-systems.json  de cross-check-definities: tolerantie, wie leidend is
 *   - batch-engine /tags   de laatste waarde per DataQuality-topic
 *   - vla-conditioner      tellers, stale-aantal, of de Model-laag aan staat
 *
 * De divergentiewaarden komen via de batch-engine en niet rechtstreeks van de
 * broker, omdat die al een verse cache van DairyWorks/Vla/# bijhoudt inclusief
 * leeftijd per topic. Een tweede MQTT-client in de UI zou dezelfde data nog een
 * keer ophalen en een tweede bron van waarheid over versheid introduceren.
 */

export const dynamic = "force-dynamic";

const ENGINE = process.env.ENGINE_URL ?? "http://vla-batch-engine:8000";
const CONDITIONER = process.env.CONDITIONER_URL ?? "http://vla-conditioner:8080";
const SOURCES_PATH = process.env.SOURCE_SYSTEMS ?? "/model/source-systems.json";
const TIMEOUT_MS = 6_000;

const DQ_PREFIX = "DairyWorks/Vla/DataQuality/cross-check-01/Status/";

type Reading = {
  value: number | string | null;
  ts: string | null;
  unit: string | null;
  quality: string;
  age_s: number | null;
};

type CrossCheck = {
  id: string;
  title: string;
  a: { tag_id: string; of_record_for?: string };
  b: { tag_id: string; of_record_for?: string };
  tolerance: number;
  unit?: string;
  severity?: string;
  compare?: string;
};

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  let defs: CrossCheck[] = [];
  try {
    const doc = JSON.parse(await readFile(SOURCES_PATH, "utf8"));
    defs = doc.cross_checks ?? [];
  } catch {
    defs = [];
  }

  const [tags, layer] = await Promise.all([
    getJson<Record<string, Reading>>(`${ENGINE}/api/v1/tags?verbose=1`),
    getJson<Record<string, unknown>>(`${CONDITIONER}/api/v1/status`),
  ]);

  const checks = defs.map((d) => {
    const delta = tags?.[`${DQ_PREFIX}${d.id}_delta`] ?? null;
    const alarm = tags?.[`${DQ_PREFIX}${d.id}_alarm`] ?? null;
    const value = typeof delta?.value === "number" ? delta.value : null;
    return {
      id: d.id,
      title: d.title,
      tolerance: d.tolerance,
      unit: d.unit ?? "",
      severity: d.severity ?? "medium",
      // delta_only vergelijkt grootheden die verwant maar niet identiek zijn.
      // Daar hoort geen alarm bij: een vals alarm is de fout die dit systeem
      // elders bekritiseert, dus het scherm mag er ook geen suggereren.
      deltaOnly: d.compare === "delta_only",
      ofRecord: d.a.tag_id,
      ofRecordFor: d.a.of_record_for ?? null,
      otherTag: d.b.tag_id,
      otherFor: d.b.of_record_for ?? null,
      delta: value,
      ageS: delta?.age_s ?? null,
      // Nooit gezien is iets anders dan binnen tolerantie. Een vergelijking die
      // nog nooit beide kanten zag is stil, niet groen.
      seen: delta !== null,
      breached:
        d.compare === "delta_only" || value === null
          ? false
          : Math.abs(value) > d.tolerance,
      alarmActive: typeof alarm?.value === "number" ? alarm.value === 1 : null,
    };
  });

  return Response.json({ checks, layer });
}
