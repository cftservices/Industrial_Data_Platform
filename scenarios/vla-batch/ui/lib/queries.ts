"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { get, getUi } from "./client";
import type { Refusal } from "./refusal";
import type { KpiSummary, UiModel } from "./types";

/**
 * Query-keys en poll-intervallen op een plek.
 *
 * De oude SPA had zes losse setInterval-loops die nooit werden opgeruimd, met
 * handmatige guards per tab. Drie gedragingen daaruit moeten blijven en worden
 * hier door TanStack Query gedekt in plaats van met de hand:
 *
 *   1. Een verborgen view pollt niet. Een ongemounte route observeert zijn
 *      query niet meer, en `refetchIntervalInBackground: false` dekt het
 *      geval waarin het tabblad zelf naar de achtergrond gaat.
 *   2. Een geopende view refresht direct. `staleTime: 0` laat een nieuwe
 *      observer meteen fetchen in plaats van tot de volgende tick te wachten.
 *   3. Een geopend detailpaneel bevriest zijn lijst-loop. Dat is de `enabled`
 *      -vlag op de lijstquery; zie het `frozen`-argument.
 *
 * De connectie-indicator is de uitzondering: die pollt altijd door, want hij is
 * de enige bron voor "engine offline".
 */

export const POLL = {
  /** Live procesbeeld: de snelste loop, voedt ook de connectie-indicator. */
  live: 1500,
  /** Lijsten die tijdens een demo zichtbaar bewegen. */
  lists: 2500,
  /** Aggregaten: duurder om te berekenen, veranderen trager. */
  aggregates: 5000,
} as const;

export const keys = {
  tags: ["tags"] as const,
  line: ["line"] as const,
  batches: ["batches"] as const,
  batch: (id: string) => ["batch", id] as const,
  orders: ["orders"] as const,
  order: (id: string) => ["order", id] as const,
  inventory: ["inventory"] as const,
  equipment: ["equipment", "health"] as const,
  oee: ["oee"] as const,
  alarms: (filter: string) => ["alarms", filter] as const,
  kpi: (window: string, compare: boolean) => ["kpi", window, compare] as const,
  model: ["ui", "model"] as const,
};

type Extra<T> = Omit<UseQueryOptions<T, Refusal, T>, "queryKey" | "queryFn">;

function usePolled<T>(
  queryKey: readonly unknown[],
  path: string,
  refetchInterval: number,
  extra?: Extra<T>,
) {
  return useQuery<T, Refusal, T>({
    queryKey,
    queryFn: ({ signal }) => get<T>(path, signal),
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 0,
    // Laat de laatst gerenderde inhoud staan als een refresh faalt. Per-blok
    // foutafhandeling: een falende call mag het scherm niet leegmaken.
    retry: 1,
    ...extra,
  });
}

export function useKpiSummary(window: string, compare = true, extra?: Extra<KpiSummary>) {
  return usePolled<KpiSummary>(
    keys.kpi(window, compare),
    `/kpi/summary?window=${encodeURIComponent(window)}&compare=${compare}`,
    POLL.aggregates,
    extra,
  );
}

export function useTags<T = Record<string, unknown>>(extra?: Extra<T>) {
  return usePolled<T>(keys.tags, "/tags", POLL.live, extra);
}

/** `frozen` bevriest de lijst zolang er een detailpaneel open staat. */
export function useBatches<T = unknown[]>(frozen = false, extra?: Extra<T>) {
  return usePolled<T>(keys.batches, "/batches", POLL.lists, { enabled: !frozen, ...extra });
}

export function useEquipmentHealth<T = unknown[]>(extra?: Extra<T>) {
  return usePolled<T>(keys.equipment, "/equipment/health", POLL.lists, extra);
}

/**
 * Masterdata: drempels, specbanden, materialen. Verandert alleen bij een
 * deploy, dus geen poll.
 */
export function useUiModel(extra?: Extra<UiModel>) {
  return useQuery<UiModel, Refusal, UiModel>({
    queryKey: keys.model,
    queryFn: ({ signal }) => getUi<UiModel>("/model", signal),
    staleTime: Infinity,
    retry: 1,
    ...extra,
  });
}
