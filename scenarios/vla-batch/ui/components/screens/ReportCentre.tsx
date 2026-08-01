"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useBatches, useEquipmentHealth } from "@/lib/queries";
import { shortDateTime } from "@/lib/format";

/**
 * Scherm 10, report centre.
 *
 * Een ingang voor de rapporten, met per type de juiste invoerdimensie. Type en
 * dimensie staan in de URL, zodat scherm 8 en 12 er voorgeselecteerd naartoe
 * kunnen linken en een keuze deelbaar is.
 */

const TYPES = [
  {
    id: "period",
    label: "Periode",
    dimension: "days",
    hint: "Plant-breed over N dagen, met het verliesblok.",
  },
  {
    id: "batch",
    label: "Batch (EBR)",
    dimension: "batch",
    hint: "Het bewijsstuk per batch, met doses, samples en verdict.",
  },
  {
    id: "equipment",
    label: "Onderhoud",
    dimension: "equipment",
    hint: "Per procesdeel: CIP-historie, meldingen en draaiuren.",
  },
] as const;

export function ReportCentre() {
  const params = useSearchParams();
  const router = useRouter();
  const type = params.get("type") ?? "period";
  const dimension = params.get("dimension") ?? "";
  const days = params.get("days") ?? "7";

  const batches = useBatches<Array<{ batch_id: string; completed_at: string | null }>>();
  const equipment = useEquipmentHealth<Array<{ equipment_id: string }>>();

  function set(key: string, val: string) {
    const next = new URLSearchParams(params.toString());
    if (val) next.set(key, val);
    else next.delete(key);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  const active = TYPES.find((t) => t.id === type) ?? TYPES[0];
  const href =
    type === "period"
      ? `/api/v1/report/period?days=${encodeURIComponent(days)}&format=pdf`
      : type === "batch" && dimension
        ? `/api/v1/report/${encodeURIComponent(dimension)}?format=pdf`
        : type === "equipment" && dimension
          ? `/api/v1/report/equipment/${encodeURIComponent(dimension)}?days=30&format=pdf`
          : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 p-6 pb-16">
      <header className="border-b border-line-strong pb-4">
        <span className="eyebrow">Report centre &middot; scherm 10</span>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">Rapporten</h1>
      </header>

      <section className="tile flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="eyebrow">Type</legend>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <label
                key={t.id}
                className={`cursor-pointer border px-3 py-1.5 text-[0.8125rem] ${
                  type === t.id
                    ? "border-ink bg-ink font-semibold text-canvas"
                    : "border-line-strong text-ink-muted hover:border-ink-muted"
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  className="sr-only"
                  checked={type === t.id}
                  onChange={() => {
                    set("type", t.id);
                    set("dimension", "");
                  }}
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="text-[0.8125rem] text-ink-muted">{active.hint}</p>
        </fieldset>

        {type === "period" && (
          <label className="flex items-center gap-2 text-[0.8125rem]">
            Over de laatste
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => set("days", e.target.value)}
              className="w-20 border border-line-strong bg-surface px-2 py-1 text-right num"
            />
            dagen
          </label>
        )}

        {type === "batch" && (
          <label className="flex flex-col gap-1 text-[0.8125rem]">
            Batch
            <select
              value={dimension}
              onChange={(e) => set("dimension", e.target.value)}
              className="border border-line-strong bg-surface px-2 py-1"
            >
              <option value="">kies een batch</option>
              {(batches.data ?? []).map((b) => (
                <option key={b.batch_id} value={b.batch_id}>
                  {b.batch_id}
                  {b.completed_at ? ` (${shortDateTime(b.completed_at)})` : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === "equipment" && (
          <label className="flex flex-col gap-1 text-[0.8125rem]">
            Procesdeel
            <select
              value={dimension}
              onChange={(e) => set("dimension", e.target.value)}
              className="border border-line-strong bg-surface px-2 py-1"
            >
              <option value="">kies een procesdeel</option>
              {(equipment.data ?? []).map((e) => (
                <option key={e.equipment_id} value={e.equipment_id}>
                  {e.equipment_id}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-3 border-t border-line pt-3">
          <a
            href={href ?? undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!href}
            className={`border border-line-strong px-3 py-1.5 text-[0.8125rem] font-semibold ${
              href ? "hover:border-ink-muted" : "pointer-events-none opacity-40"
            }`}
          >
            PDF openen
          </a>
          {!href && (
            <span className="text-[0.8125rem] text-ink-muted">Kies eerst een dimensie.</span>
          )}
        </div>
      </section>

      <p className="text-[0.8125rem] text-ink-muted">
        Het PDF leest dezelfde endpoint als het scherm, met dezelfde parameters. Zo tonen scherm en
        rapport gegarandeerd hetzelfde getal.
      </p>
    </main>
  );
}
