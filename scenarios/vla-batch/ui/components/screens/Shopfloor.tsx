"use client";

import { useState } from "react";
import { RefusalPanel } from "@/components/toolkit/RefusalPanel";
import { StatusPill } from "@/components/toolkit/StatusPill";
import { post } from "@/lib/client";
import { EMPTY, num } from "@/lib/format";
import type { Refusal } from "@/lib/refusal";

/**
 * De werkvloerflow, uit scherm 4 gelicht.
 *
 * In v0.5 deed scherm 4 vijf banen tegelijk: setpoint-console, batchbesturing,
 * de volledige scan- en weegapplicatie, de HU-flow en fault-injectie. Dat is
 * een werkvloerapplicatie in een SCADA-scherm gepropt, terwijl de operator die
 * dat werk doet nooit een kook-setpoint zet.
 *
 * DE SCAN-GATE HEEFT DRIE TOESTANDEN, NIET TWEE:
 *   groen    order gescand en er is een batch, panel open
 *   NEUTRAAL order bestaat maar heeft nog geen batch: panel DICHT, kaarten
 *            geleegd, met de tekst dat er eerst een batch moet komen
 *   rood     geweigerd
 *
 * Die middelste is er bewust ingezet om vals-groen te voorkomen. Zonder hem
 * lijkt de gate open terwijl er niets te wegen valt.
 */

type GateState = "idle" | "open" | "no-batch" | "rejected";

type ScanResult = {
  order_id?: string;
  batch_id?: string | null;
  materials?: Array<{
    material_id: string;
    qty_target: number;
    qty_staged?: number | null;
    remaining?: number | null;
  }>;
};

const OPERATOR = "op-01";

export function Shopfloor() {
  const [code, setCode] = useState("");
  const [gate, setGate] = useState<GateState>("idle");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setRefusal(null);
    setMessage(null);
    try {
      const res = await post<ScanResult>("/scan/order", { code, operator_id: OPERATOR });
      setResult(res);
      // De middelste toestand: order gevonden, batch nog niet.
      if (!res.batch_id) {
        setGate("no-batch");
      } else {
        setGate("open");
      }
    } catch (err) {
      setResult(null);
      setGate("rejected");
      setRefusal(err as Refusal);
    } finally {
      setBusy(false);
    }
  }

  async function weigh(materialId: string, qty: number, total: boolean) {
    if (!result?.batch_id) return;
    setBusy(true);
    setRefusal(null);
    try {
      // Altijd eerst de labelscan, dan pas de weging. Twee calls, zoals de
      // engine ze verwacht; er is geen transactie.
      await post("/scan/label", {
        batch_id: result.batch_id,
        material_id: materialId,
        lot_no: "L-0000",
        operator_id: OPERATOR,
      });
      await post("/scan/weigh", {
        batch_id: result.batch_id,
        material_id: materialId,
        qty_kg: total ? null : qty,
        lot_no: "L-0000",
        operator_id: OPERATOR,
        total,
      });
      setMessage(`${materialId} geboekt`);
    } catch (err) {
      setRefusal(err as Refusal);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!result?.batch_id) return;
    setBusy(true);
    setRefusal(null);
    try {
      const res = await post<{ booked_materials?: string[] }>("/scan/report", {
        batch_id: result.batch_id,
        operator_id: OPERATOR,
      });
      setMessage(`Gecommit: ${(res.booked_materials ?? []).join(", ") || "niets open"}`);
    } catch (err) {
      setRefusal(err as Refusal);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-4 pb-16">
      <header>
        <span className="eyebrow">Werkvloer &middot; scan en weeg</span>
        <h1 className="text-lg font-semibold tracking-[-0.015em]">Afwegen</h1>
      </header>

      <form onSubmit={scan} className="tile flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-[0.8125rem]">
          <span className="eyebrow">Order- of batchcode</span>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ORD-2210 of B-1042"
            className="border border-line-strong bg-surface px-2 py-1.5 mono"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="border border-line-strong px-3 py-1.5 text-[0.8125rem] font-semibold hover:border-ink-muted disabled:opacity-40"
        >
          Scannen
        </button>

        <span className="flex items-center gap-2">
          {gate === "open" && <StatusPill status="ok">Gate open</StatusPill>}
          {/* NEUTRAAL, niet groen en niet rood. */}
          {gate === "no-batch" && <StatusPill status="idle">Order zonder batch</StatusPill>}
          {gate === "rejected" && <StatusPill status="alarm">Geweigerd</StatusPill>}
        </span>
      </form>

      {gate === "no-batch" && (
        <p className="text-[0.8125rem] text-ink-muted">
          Deze order heeft nog geen batch. Maak er eerst een aan op het orderscherm.
        </p>
      )}

      {refusal && (
        <RefusalPanel
          refusal={refusal}
          operatorId={OPERATOR}
          onCleared={() => setRefusal(null)}
          // Bewust GEEN onRetry: een weeg- of scanhandeling opnieuw uitvoeren
          // zonder dat de operator dat vraagt kan dubbel boeken.
        />
      )}

      {message && <p className="text-[0.8125rem] text-ink-muted">{message}</p>}

      {/* Panel alleen open bij een echte gate. De kaarten worden geleegd zodra
          de gate dat niet is, anders blijft er oude context staan. */}
      {gate === "open" && result?.materials && (
        <section className="tile flex flex-col gap-3">
          <span className="eyebrow">
            Batch <span className="mono">{result.batch_id}</span>
          </span>
          {result.materials.map((m) => (
            <div
              key={m.material_id}
              className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 border-b border-line py-[var(--density-row)] last:border-b-0"
            >
              <span className="mono">{m.material_id}</span>
              <span className="text-[0.8125rem] num">
                {m.qty_staged === null || m.qty_staged === undefined
                  ? EMPTY
                  : num(m.qty_staged, 1)}{" "}
                van {num(m.qty_target, 1)} kg
                {m.remaining !== null && m.remaining !== undefined && (
                  <span className="ml-2 text-ink-faint">rest {num(m.remaining, 1)}</span>
                )}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => weigh(m.material_id, m.remaining ?? m.qty_target, true)}
                className="border border-line-strong px-2 py-1 text-[0.6875rem] font-semibold tracking-[0.04em] uppercase hover:border-ink-muted disabled:opacity-40"
              >
                Totaal
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={commit}
            className="self-start border border-line-strong px-3 py-1.5 text-[0.8125rem] font-semibold hover:border-ink-muted disabled:opacity-40"
          >
            Rapport-scan (commit)
          </button>
        </section>
      )}
    </main>
  );
}
