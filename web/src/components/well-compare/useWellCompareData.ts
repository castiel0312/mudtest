import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Well } from "../../api/types";
import type { CompareWellData } from "./compareMetrics";

export type WellCompareSummary = CompareWellData;

export type WellCompareState =
  | { status: "loading"; wells: []; error: null; retry: () => void }
  | { status: "ready"; wells: WellCompareSummary[]; error: null; retry: () => void }
  | { status: "error"; wells: []; error: string; retry: () => void };

const PAGE_LIMIT = 20000;

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

async function loadWell(well: Well, signal: AbortSignal): Promise<WellCompareSummary> {
  const [trajectory, events, page] = await Promise.all([
    api.trajectory(well.well_id, signal),
    api.events(well.well_id, signal),
    api.timeseries(well.well_id, { offset: 0, limit: PAGE_LIMIT }, signal),
  ]);
  return { well, trajectory, events, timeseries: page.items };
}

interface KeyedState {
  key: number;
  state: WellCompareState;
}

export function useWellCompareData(): WellCompareState {
  const [retryToken, setRetryToken] = useState(0);
  const [stored, setStored] = useState<KeyedState>(() => ({
    key: retryToken,
    state: { status: "loading", wells: [], error: null, retry: () => undefined },
  }));
  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const load = async () => {
      try {
        const wells = await api.wells(signal);
        const summaries = await Promise.all(wells.map((well) => loadWell(well, signal)));
        if (!signal.aborted) setStored({ key: retryToken, state: { status: "ready", wells: summaries, error: null, retry } });
      } catch (error) {
        if (isAbort(error, signal)) return;
        const message = error instanceof Error ? error.message : "Could not load well comparison data.";
        setStored({ key: retryToken, state: { status: "error", wells: [], error: message, retry } });
      }
    };
    void load();
    return () => controller.abort();
  }, [retry, retryToken]);

  return stored.key === retryToken
    ? stored.state
    : { status: "loading", wells: [], error: null, retry };
}
