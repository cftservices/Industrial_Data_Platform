import { readFile } from "node:fs/promises";

/**
 * De Connect-payload: wat er per bronsysteem binnenkomt en waar het uitkomt.
 *
 * Voegt drie bronnen samen zodat de browser er maar een hoeft te kennen:
 *   - source-systems.json   welke eilanden er zijn, protocol, endpoint, punten
 *   - aliases.json          naar welk canoniek topic elk ruw punt gaat
 *   - vla-conditioner       tellers, stale-aantal en of de Model-laag aan staat
 *
 * Waarom hier en niet in de browser: de modelbestanden staan op een read-only
 * mount die alleen server-side bereikbaar is, en de conditioner hangt op
 * idp-network zonder eigen auth. Dezelfde reden als de andere BFF-routes.
 *
 * Draait de conditioner niet (het vendor-profile staat uit), dan is dat GEEN
 * fout: `layer: null` en het scherm zegt dat de laag niet draait. De demo hoort
 * zonder vendor-profile gewoon te werken.
 */

export const dynamic = "force-dynamic";

const SOURCES_PATH = process.env.SOURCE_SYSTEMS ?? "/model/source-systems.json";
const ALIASES_PATH = process.env.ALIASES ?? "/model/aliases.json";
const CONDITIONER = process.env.CONDITIONER_URL ?? "http://vla-conditioner:8080";
const TIMEOUT_MS = 4_000;

type Point = {
  native: string;
  description?: string;
  native_unit?: string;
  native_scale?: number;
  canonical_tag_id: string;
};

type System = {
  id: string;
  equipment_id: string;
  area: string;
  archetype: string;
  vendor: string;
  protocol: string;
  endpoint: string;
  ingest: string;
  raw_prefix: string;
  native_timestamp?: string;
  native_quality?: string;
  enabled?: boolean;
  points: Point[];
};

type Alias = {
  legacy_tag: string;
  canonical_topic: string;
  canonical_tag_id: string;
  canonical_unit: string;
  retired_at: string | null;
};

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function layerStatus() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CONDITIONER}/api/v1/status`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const [sources, aliasDoc, layer] = await Promise.all([
    readJson<{ raw_root: string; source_systems: System[] }>(SOURCES_PATH),
    readJson<{ aliases: Alias[] }>(ALIASES_PATH),
    layerStatus(),
  ]);

  if (!sources) {
    return Response.json(
      { error: "source-systems.json niet leesbaar", systems: [], layer: null },
      { status: 200 },
    );
  }

  const rawRoot = sources.raw_root;
  const byLegacy = new Map<string, Alias>(
    (aliasDoc?.aliases ?? []).map((a) => [a.legacy_tag, a]),
  );

  const systems = sources.source_systems
    .filter((s) => s.enabled !== false)
    .map((s) => ({
      id: s.id,
      equipment: s.equipment_id,
      area: s.area,
      archetype: s.archetype,
      vendor: s.vendor,
      protocol: s.protocol,
      endpoint: s.endpoint,
      ingest: s.ingest,
      // Twee kolommen naast elkaar: links wat de leverancier het noemt, rechts
      // wat het betekent. Dat contrast IS het scherm; niet samenvoegen.
      points: s.points.map((p) => {
        const rawTopic = `${rawRoot}/${s.raw_prefix}/${p.native}`;
        const alias = byLegacy.get(rawTopic) ?? null;
        return {
          native: p.native,
          description: p.description ?? null,
          nativeUnit: p.native_unit || null,
          nativeScale: p.native_scale ?? 1,
          rawTopic,
          canonicalTopic: alias?.canonical_topic ?? null,
          canonicalUnit: alias?.canonical_unit ?? null,
          retired: Boolean(alias?.retired_at),
        };
      }),
      // Waarom een tag nooit vanzelf betekenis krijgt: de bron levert geen
      // meettijd of geen kwaliteit, en dat moet zichtbaar zijn per systeem.
      nativeTimestamp: s.native_timestamp ?? "none",
      nativeQuality: s.native_quality ?? "none",
    }));

  return Response.json({
    rawRoot,
    systems,
    totals: {
      systems: systems.length,
      points: systems.reduce((n, s) => n + s.points.length, 0),
      protocols: [...new Set(systems.map((s) => s.protocol))].length,
      unmapped: systems.reduce(
        (n, s) => n + s.points.filter((p) => !p.canonicalTopic).length,
        0,
      ),
    },
    layer,
  });
}
