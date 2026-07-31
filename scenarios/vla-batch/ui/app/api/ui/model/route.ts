import { readFile } from "node:fs/promises";

/**
 * Whitelisted projectie van factory-model/isa95-vla.json.
 *
 * Waarom niet het hele model: daar staan OPC-UA-endpoints, namespace-URI's en
 * de volledige tagtabel in. De browser hoeft de drempels te kennen, niet de
 * koppelingskennis. Deze route geeft daarom een expliciete selectie door en
 * geen `...model`.
 *
 * Waarom hier en niet in de engine: de engine leest het model al
 * (kpi.load_factory_model) maar exposeert het niet, en het toevoegen van een
 * route daar zou een backendwijziging zijn voor iets dat puur presentatie is.
 * De UI-container krijgt dezelfde read-only bind-mount.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MODEL_PATH = process.env.FACTORY_MODEL ?? "/model/isa95-vla.json";

type Recipe = {
  recipe_id?: string;
  product_name?: string;
  pack_size_L?: number;
  cook_setpoint_C?: number;
  hold_sec?: number;
  cool_target_C?: number;
  viscosity_spec_cP?: { min: number; max: number };
};

let cache: { at: number; body: unknown } | null = null;
const CACHE_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return Response.json(cache.body, { headers: { "cache-control": "no-store" } });
  }

  let model: Record<string, unknown>;
  try {
    model = JSON.parse(await readFile(MODEL_PATH, "utf-8"));
  } catch {
    // Gedefinieerd gedrag, geen crash: zonder model toont de UI overal een
    // streepje met "geen specificatie bekend" in plaats van een verzonnen band.
    return Response.json(
      { available: false, reason: `factory-model niet leesbaar op ${MODEL_PATH}` },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  const recipes = (model.recipes as Recipe[] | undefined) ?? [];
  const recipe = recipes[0] ?? {};

  const body = {
    available: true,
    product: model.product ?? null,
    scenario: model.scenario ?? null,
    recipe: {
      recipe_id: recipe.recipe_id ?? null,
      product_name: recipe.product_name ?? null,
      pack_size_L: recipe.pack_size_L ?? null,
      cook_setpoint_C: recipe.cook_setpoint_C ?? null,
      hold_sec: recipe.hold_sec ?? null,
      cool_target_C: recipe.cool_target_C ?? null,
      // Tweezijdig. Een enkelzijdige grens maakt Cp en Cpk onmogelijk.
      viscosity_spec_cP: recipe.viscosity_spec_cP ?? null,
    },
    materials: (model.materials as Array<Record<string, unknown>> | undefined)?.map((m) => ({
      material_id: m.material_id,
      name: m.name,
      uom: m.uom,
      category: m.category,
    })) ?? [],
    kpi_targets: model.kpi_targets ?? [],
    equipment_states: model.equipment_states ?? [],
    batch_states: model.batch_states ?? [],
    product_density_kg_L: model.product_density_kg_L ?? null,
    packs_per_pallet: model.packs_per_pallet ?? null,
    fill_limits_ml: model.fill_limits_ml ?? null,
    stale_threshold_s: model.stale_threshold_s ?? null,
    phase_nominal_sec: model.phase_nominal_sec ?? null,
    // Bewust NIET doorgegeven: opcua_endpoint, opcua_namespace_uri,
    // namespace_convention, enterprise-hierarchie, cost_model. Het kostenmodel
    // hoort niet in de browser: de bedragen komen kant-en-klaar uit kpi/summary.
  };

  cache = { at: Date.now(), body };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
