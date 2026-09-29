import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { TimeseriesRow, Well } from "../../api/types";
import { WellHeader } from "./WellHeader";
import { NdMap } from "./NdMap";
import { useWellCompareData, type WellCompareSummary } from "../well-compare/useWellCompareData";
import "./NwisDashboard.css";

interface DashboardData {
  wells: Well[];
  latest: Partial<Record<keyof TimeseriesRow, TimeseriesRow>>;
}

type LoadState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: DashboardData; error: null }
  | { status: "error"; data: null; error: string };

interface KeyedLoadState {
  key: string;
  state: LoadState;
}

const NAV_ITEMS = [
  { label: "Dashboard", symbol: "▦", active: true },
  { label: "Oil Field Map", symbol: "⌖" },
  { label: "3D Subsurface", symbol: "◈" },
  { label: "Well Comparison", symbol: "⇄" },
  { label: "Risk Intelligence", symbol: "◉" },
  { label: "Formation Analysis", symbol: "▤" },
  { label: "Knowledge Graph", symbol: "⌘" },
  { label: "What-If Simulator", symbol: "⟁" },
  { label: "Drilling Time Machine", symbol: "◷" },
  { label: "Future Well Planner", symbol: "⌁" },
  { label: "Search & Evidence", symbol: "⌕" },
  { label: "Reports & Case Studies", symbol: "▧" },
  { label: "Alerts & Notifications", symbol: "♢" },
  { label: "User Management", symbol: "♙" },
];

const COMPARE_ROWS = [
  { key: "formation", label: "Formation", value: (item: WellCompareSummary) => latestValue(item.timeseries, "formation") },
  { key: "depth", label: "Depth", value: (item: WellCompareSummary) => latestValue(item.timeseries, "md", "m") },
  { key: "mud-weight", label: "Mud weight", value: (item: WellCompareSummary) => latestValue(item.timeseries, "mud_weight", "SG") },
  { key: "rop", label: "ROP", value: (item: WellCompareSummary) => latestValue(item.timeseries, "rop", "m/hr") },
  { key: "wob", label: "WOB", value: (item: WellCompareSummary) => latestValue(item.timeseries, "wob", "kN") },
  { key: "torque", label: "Torque", value: (item: WellCompareSummary) => latestValue(item.timeseries, "torque", "kN·m") },
  { key: "ecd", label: "ECD", value: (item: WellCompareSummary) => latestValue(item.timeseries, "ecd", "SG") },
  { key: "events", label: "Event count", value: (item: WellCompareSummary) => String(item.events.length) },
] as const;

function latestValue<K extends "formation" | "md" | "mud_weight" | "rop" | "wob" | "torque" | "ecd">(
  rows: WellCompareSummary["timeseries"],
  field: K,
  unit = "",
): string {
  const row = rows.reduce<WellCompareSummary["timeseries"][number] | null>((latest, candidate) => {
    if (candidate[field] === null || candidate[field] === undefined) return latest;
    if (!latest || (candidate.timestamp && (!latest.timestamp || Date.parse(candidate.timestamp) >= Date.parse(latest.timestamp)))) return candidate;
    return latest;
  }, null);
  const value = row?.[field];
  if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "Unavailable";
  if (typeof value === "number") return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
  return value;
}

const PANEL_TITLES = [
  "Field activity overview",
  "Well location and depth",
  "Drilling performance",
  "Trajectory profile",
  "Operational events",
  "Formation and lithology",
  "Risk indicators",
  "Recent activity",
];

function displayWellName(well: Well): string {
  return well.well_name ?? well.well_id;
}

async function fetchSelectedWell(wellId: string, signal: AbortSignal): Promise<DashboardData> {
  const [wells, page] = await Promise.all([
    api.wells(signal),
    api.timeseries(wellId, { offset: 0, limit: 20000 }, signal),
  ]);
  const latest = page.items.reduce<Partial<Record<keyof TimeseriesRow, TimeseriesRow>>>((current, row) => {
    const timestamp = row.timestamp === null ? Number.NEGATIVE_INFINITY : Date.parse(row.timestamp);
    for (const field of ["md", "formation", "rig_state", "rop", "wob", "torque", "ecd", "mud_weight"] as const) {
      const value = row[field];
      if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) continue;
      const previous = current[field];
      const previousTimestamp = previous?.timestamp === null || previous === undefined
        ? Number.NEGATIVE_INFINITY
        : Date.parse(previous.timestamp);
      if (!previous || (Number.isFinite(timestamp) && timestamp >= previousTimestamp)) current[field] = row;
    }
    return current;
  }, {});
  return { wells, latest };
}

export function NwisDashboard() {
  const [selectedWellId, setSelectedWellId] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const requestKey = `${selectedWellId}:${retryToken}`;
  const [stored, setStored] = useState<KeyedLoadState>({
    key: "",
    state: { status: "loading", data: null, error: null },
  });
  const retry = useCallback(() => setRetryToken((token) => token + 1), []);
  const compareData = useWellCompareData();
  const [compareWellIds, setCompareWellIds] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const load = async () => {
      try {
        let wellId = selectedWellId;
        let wells: Well[] = [];
        if (!wellId) {
          wells = await api.wells(signal);
          const firstWell = wells[0];
          if (!firstWell) {
            if (!signal.aborted) setStored({ key: requestKey, state: { status: "ready", data: { wells, latest: {} }, error: null } });
            return;
          }
          wellId = firstWell.well_id;
        }
        const data = await fetchSelectedWell(wellId, signal);
        if (!signal.aborted) {
          setStored({ key: requestKey, state: { status: "ready", data, error: null } });
          if (!selectedWellId && data.wells.some((well) => well.well_id === wellId)) setSelectedWellId(wellId);
        }
      } catch (error) {
        if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        const message = error instanceof Error ? error.message : "Could not load the dashboard data.";
        setStored({ key: requestKey, state: { status: "error", data: null, error: message } });
      }
    };
    void load();
    return () => controller.abort();
  }, [requestKey, selectedWellId]);

  const current = stored.key === requestKey ? stored.state : { status: "loading", data: null, error: null } as const;
  const wells = current.status === "ready" ? current.data.wells : [];
  const selectedWell = useMemo(() => wells.find((well) => well.well_id === selectedWellId) ?? wells[0] ?? null, [selectedWellId, wells]);
  const latest = current.status === "ready" ? current.data.latest : {};
  const compareWells = compareData.status === "ready" ? compareData.wells : [];
  const activeCompareIds = compareWellIds.length
    ? compareWellIds.filter((id) => compareWells.some((item) => item.well.well_id === id))
    : compareWells.slice(0, 3).map((item) => item.well.well_id);
  const visibleCompareWells = activeCompareIds.flatMap((id) => {
    const item = compareWells.find((candidate) => candidate.well.well_id === id);
    return item ? [item] : [];
  });
  const nearbyWells = wells.filter((well) => well.well_id !== selectedWell?.well_id).map((well) => ({
    name: well.well_name ?? well.well_id,
    lat: well.latitude,
    lon: well.longitude,
  }));

  const updateSelectedWell = (wellId: string) => {
    setSelectedWellId(wellId);
    setStored((existing) => ({ ...existing, key: "" }));
  };

  return <div className="nd-root">
    <aside className="nd-sidebar">
      <a className="nd-brand" href="#dashboard" aria-label="NWIS dashboard home"><span className="nd-brand-mark">N</span><span>NWIS</span></a>
      <nav className="nd-navigation" aria-label="Main navigation">
        <span className="nd-nav-caption">Workspace</span>
        {NAV_ITEMS.map((item) => <a className={item.active ? "nd-nav-item nd-nav-active" : "nd-nav-item"} href={`#${item.label.toLowerCase().replaceAll(" ", "-")}`} key={item.label} aria-current={item.active ? "page" : undefined}>
          <span className="nd-nav-symbol" aria-hidden="true">{item.symbol}</span><span>{item.label}</span>
        </a>)}
      </nav>
      <div className="nd-sidebar-foot"><span className="nd-connection-dot" />Data service</div>
    </aside>

    <main className="nd-main" id="dashboard">
      <header className="nd-topbar">
        <div className="nd-breadcrumb"><span>Workspace</span><span className="nd-breadcrumb-separator">/</span><strong>Dashboard</strong></div>
        <label className="nd-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search wells, fields, reports…" aria-label="Search" /><kbd>⌘ K</kbd></label>
        <button className="nd-user-button" type="button" aria-label="User account">JD</button>
      </header>

      <section className="nd-page-heading"><div><span className="nd-overline">Operations overview</span><h1>Dashboard</h1><p>Current well status and drilling activity from reported source data.</p></div><span className="nd-data-tag"><i /> Live source data</span></section>

      {current.status === "error" && <div className="nd-error" role="alert"><span>{current.error}</span><button type="button" onClick={retry}>Retry</button></div>}
      <WellHeader wells={wells} selectedWellId={selectedWell?.well_id ?? ""} onWellChange={updateSelectedWell} latestSample={latest} loading={current.status === "loading"} />

      <section className="nd-content-grid" aria-label="Dashboard panels">
        {PANEL_TITLES.map((title, index) => <article className={`nd-placeholder nd-placeholder-${index + 1}`} key={title}>
          <div className="nd-placeholder-heading"><span>{title}</span><button type="button" aria-label={`More options for ${title}`}>···</button></div>
          {index === 1 && <NdMap
            active={{
              name: selectedWell ? displayWellName(selectedWell) : "Unavailable",
              lat: selectedWell?.latitude ?? null,
              lon: selectedWell?.longitude ?? null,
            }}
            nearby={nearbyWells}
          />}
          {index === 6 && <section className="nd-compare">
            <label className="nd-compare-select-label">Select wells
              <select multiple value={activeCompareIds} onChange={(event) => {
                const chosen = Array.from(event.currentTarget.selectedOptions, (option) => option.value).slice(0, 3);
                setCompareWellIds(chosen);
              }} aria-label="Select up to three wells to compare">
                {compareWells.map((item) => <option key={item.well.well_id} value={item.well.well_id}>{item.well.well_name ?? item.well.well_id}</option>)}
              </select>
            </label>
            {compareData.status === "loading" && <p className="nd-compare-message">Loading comparison data…</p>}
            {compareData.status === "error" && <p className="nd-compare-message" role="alert">{compareData.error}</p>}
            {compareData.status === "ready" && <div className="nd-compare-table-scroll"><table className="nd-compare-table">
              <thead><tr><th scope="col">Metric</th>{visibleCompareWells.map((item) => <th scope="col" key={item.well.well_id}>{item.well.well_name ?? item.well.well_id}</th>)}</tr></thead>
              <tbody>{COMPARE_ROWS.map((row) => <tr key={row.key}><th scope="row">{row.label}</th>{visibleCompareWells.map((item) => <td key={item.well.well_id}>{row.value(item)}</td>)}</tr>)}</tbody>
            </table></div>}
          </section>}
          {index !== 1 && index !== 6 && <div className="nd-placeholder-body"><span className="nd-placeholder-icon">{["◫", "⌖", "⌁", "⌇", "◷", "▤", "◉", "◴"][index]}</span><p>{title} panel</p><small>Panel content will appear here</small></div>}
        </article>)}
      </section>
      <footer className="nd-footer"><span>NWIS · Well operations intelligence</span><span>{selectedWell ? displayWellName(selectedWell) : "Well unavailable"}</span></footer>
    </main>
  </div>;
}
