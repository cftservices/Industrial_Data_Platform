/**
 * Het contract van de batch-engine, zoals de UI het gebruikt.
 *
 * Bron: batch-engine/vla/kpi.py en app.py. Deze typen zijn met de hand
 * bijgehouden en niet gegenereerd; wijkt de engine af, dan is dat een bug in
 * een van beide en moet hij hier zichtbaar worden.
 */

export type KpiStatus = "OK" | "WARNING" | "CRITICAL" | "UNSET";

export type KpiValue = {
  kpi_id: string;
  name: string;
  unit: string;
  iso_ref: string;
  direction: "higher_is_better" | "lower_is_better";
  formula: string;
  /** ISO 22400-2 Table 1 contextvelden. */
  timing: string;
  audience: string;
  production_methodology: string;

  value: number | null;
  status: KpiStatus;
  /** Ver onder de kritieke grens. Onderscheidt 40 % van 89 % zonder een
   *  vierde kleur te introduceren. */
  beyond_critical: boolean;
  target: number | null;
  warn: number | null;
  critical: number | null;

  window: string;
  from: string;
  to: string;

  previous_value: number | null;
  delta: number | null;
  delta_pct: number | null;
  /** null als de delta nul is of ontbreekt. */
  favourable: boolean | null;

  /** Aanwezig bij UNSET: waarom er geen getal is. Nooit een verzonnen nul. */
  reason?: string;
  detail: Record<string, unknown>;
};

export type LossItem = {
  category: string;
  label: string;
  amount: number;
  currency: string;
  /** Alleen causale verliezen tellen in het kopbedrag. */
  causal_or_resultant: "causal" | "resultant";
  caused_by: string | null;
  cause: string | null;
  /** null voor resultanten: die zitten al in hun oorzaak. */
  share_pct: number | null;
  detail: Record<string, unknown>;
};

export type Losses = {
  items: LossItem[];
  /** null als er geen kostenmodel is. Nooit 0. */
  total_causal: number | null;
  currency: string | null;
  /** Welke categorie ontbreekt en waarom. */
  omitted: Array<{ category: string; reason: string }>;
};

export type KpiSummary = {
  window: string;
  from: string;
  to: string;
  timezone: string;
  shift_hours: number;
  compare: boolean;
  kpis: KpiValue[];
  losses: Losses;
  generated_at: string;
};

export type UiModel = {
  available: boolean;
  reason?: string;
  recipe?: {
    recipe_id: string | null;
    product_name: string | null;
    pack_size_L: number | null;
    cook_setpoint_C: number | null;
    hold_sec: number | null;
    cool_target_C: number | null;
    viscosity_spec_cP: { min: number; max: number } | null;
  };
  materials?: Array<{ material_id: string; name: string; uom: string; category: string }>;
  kpi_targets?: Array<Record<string, unknown>>;
  product_density_kg_L?: number | null;
  packs_per_pallet?: number | null;
  fill_limits_ml?: { T1: number; T2: number } | null;
  stale_threshold_s?: number | null;
};
