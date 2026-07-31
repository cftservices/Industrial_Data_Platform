/**
 * Foutnormalisatie voor de twee weigeringsvormen van de batch-engine.
 *
 * De API geeft `detail` soms als string en soms als object. Twee bronnen
 * produceren een object:
 *
 *   CipRequired    -> 400, met reason "cip_required", equipment_id,
 *                     batches_since_cip, limit, last_cip_at, en een `action`
 *                     die de UI als knop moet renderen.
 *   ScanRejected   -> 404 (reason "unknown") of 409 (al het overige), met
 *                     message + reason.
 *
 * Reageer daarom op VORM, niet op statuscode. Een 409 kan een scan-weigering
 * zijn of een gewone conflictfout met een kale string.
 */

export type RefusalAction = {
  label: string;
  method: string;
  /** Let op: dit pad bevat AL het /api/v1-prefix. Zie stripApiPrefix. */
  path: string;
};

export type Refusal = {
  /** Wat de gebruiker te zien krijgt. Nooit een kale statuscode. */
  message: string;
  status: number;
  /** Machineleesbare reden, bv. "cip_required" of "not_approved". */
  reason: string | null;
  /** Aanwezig bij CipRequired: rendert als knop met automatische retry. */
  action: RefusalAction | null;
  /** Alle overige velden uit het detail-object, voor scherm-specifieke tekst. */
  facts: Record<string, unknown>;
};

const API_PREFIX = "/api/v1";

/**
 * De server geeft `action.path` inclusief het /api/v1-prefix. De client-helper
 * zet dat prefix er zelf weer voor. Zonder deze strip post je naar
 * /api/v1/api/v1/equipment/cook-unit-01/cip en krijg je een 404 die eruitziet
 * als een backendfout.
 */
export function stripApiPrefix(path: string): string {
  return path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length) : path;
}

export function isRefusal(e: unknown): e is Refusal {
  return typeof e === "object" && e !== null && "message" in e && "status" in e;
}

/** Bouwt een Refusal uit een niet-ok respons. Gooit nooit zelf. */
export async function toRefusal(res: Response, method: string, path: string): Promise<Refusal> {
  const fallback = `de engine weigerde ${method} ${path} (HTTP ${res.status}, geen reden opgegeven)`;
  let message = fallback;
  let reason: string | null = null;
  let action: RefusalAction | null = null;
  const facts: Record<string, unknown> = {};

  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail === "object") {
      message = typeof detail.message === "string" ? detail.message : fallback;
      reason = typeof detail.reason === "string" ? detail.reason : null;
      if (detail.action && typeof detail.action.path === "string") {
        action = {
          label: detail.action.label ?? "Fix this",
          method: detail.action.method ?? "POST",
          path: detail.action.path,
        };
      }
      for (const [k, v] of Object.entries(detail)) {
        if (!["message", "reason", "action"].includes(k)) facts[k] = v;
      }
    }
  } catch {
    /* geen leesbare body: de fallback benoemt alsnog WAT geweigerd werd */
  }

  return { message, status: res.status, reason, action, facts };
}
