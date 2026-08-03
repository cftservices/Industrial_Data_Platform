"use client";

import { useState } from "react";
import { StatusPill } from "./StatusPill";
import { runRefusalAction } from "@/lib/client";
import { shortDateTime } from "@/lib/format";
import type { Refusal } from "@/lib/refusal";

/**
 * Rendert een gestructureerde weigering van de engine.
 *
 * Drie dingen die hier een-op-een uit de oude SPA over moeten en die bij een
 * herbouw altijd sneuvelen:
 *
 *   1. Draagt de weigering een `action`, dan verschijnt die als knop. Het pad
 *      uit de server bevat AL het /api/v1-prefix; `runRefusalAction` haalt dat
 *      eraf. Vergeet je dat, dan post je naar /api/v1/api/v1/... en krijg je
 *      een 404 die eruitziet als een backendfout.
 *   2. Bij `cip_required` komt er een extra feitenregel met het procesdeel en
 *      het moment van de laatste CIP, met "nooit" als die er niet is.
 *   3. Na een geslaagde actie wordt de oorspronkelijke handeling ALLEEN opnieuw
 *      geprobeerd als de aanroeper daarom vraagt. In de oude SPA gold dat voor
 *      het aanmaken van een batch bij een order, en bewust niet voor het
 *      sluiten of aanmaken van een order.
 */
export function RefusalPanel({
  refusal,
  operatorId,
  onCleared,
  onRetry,
}: {
  refusal: Refusal;
  operatorId: string | null;
  /** Altijd aangeroepen na een geslaagde actie. */
  onCleared: () => void | Promise<void>;
  /** Alleen meegeven waar automatisch opnieuw proberen gewenst is. */
  onRetry?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facts =
    refusal.reason === "cip_required"
      ? `Laatste CIP op ${refusal.facts.equipment_id}: ${
          refusal.facts.last_cip_at
            ? shortDateTime(String(refusal.facts.last_cip_at))
            : "nooit"
        }.`
      : null;

  async function run() {
    if (!refusal.action) return;
    setBusy(true);
    setError(null);
    try {
      await runRefusalAction(refusal.action, operatorId);
      await onCleared();
      if (onRetry) await onRetry();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "actie mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tile flex flex-col items-start gap-2 border-l-[3px] border-l-status-alarm">
      <StatusPill status="alarm">Geweigerd</StatusPill>
      <p className="text-[0.8125rem]">{refusal.message}</p>
      {facts && <p className="text-[0.8125rem] text-ink-muted">{facts}</p>}
      {refusal.action && (
        <button
          type="button"
          disabled={busy}
          onClick={run}
          className="border border-line-strong px-3 py-1.5 text-[0.8125rem] font-semibold hover:border-ink-muted disabled:opacity-40"
        >
          {busy ? "Bezig" : refusal.action.label}
        </button>
      )}
      {error && <p className="text-[0.8125rem] text-status-alarm">{error}</p>}
    </section>
  );
}
