import { useMemo, useState, type CSSProperties } from "react";

import type { ComparisonMetric, MetricValue } from "./compareMetrics";
import { computeMetrics, totalDepth } from "./compareMetrics";
import { FieldMap } from "./FieldMap";
import { buildSampleWells } from "./sampleWells";
import { useWellCompareData, type WellCompareSummary } from "./useWellCompareData";
import { WELL_LOCATIONS } from "./wellLocations";
import { UNAVAILABLE_CHANNELS } from "../../api/types";
import "./WellComparePanel.css";

type CssVars = CSSProperties & { [key: `--${string}`]: string | number };
type PlotPoint = { x: number; y: number; md: number; value: number; wellId: string };
type HoverChart = "plan" | "rop" | "events" | null;

const WELL_COLORS = ["#2F7BFF", "#F5A623", "#22C3B5", "#A06CFF", "#F062A5", "#9BD24A"];
const GROUPS: ComparisonMetric["group"][] = ["Well details", "Trajectory", "Events", "Data availability"];

// Only include channels that are not declared entirely unavailable for this dataset.
type ColEntry = { key: string; label: string; source: string };
const CHANNEL_COLUMNS = (
  [
    { key: "gas_total", label: "Gas", source: "gas_total" },
    { key: "h2s", label: "H2S", source: "h2s" },
    { key: "flow_in", label: "Flow in", source: "flow_in" },
    { key: "flow_out", label: "Flow out", source: "flow_out" },
    { key: "ecd", label: "ECD", source: "ecd" },
    { key: "mud_weight", label: "Mud weight", source: "mud_weight" },
    { key: "torque", label: "Torque", source: "torque" },
    { key: "rop", label: "ROP", source: "rop" },
    { key: "wob", label: "WOB", source: "wob" },
    { key: "rpm", label: "RPM", source: "rpm" },
    { key: "hookload", label: "Hookload", source: "hookload" },
    { key: "standpipe_pressure", label: "Standpipe pressure", source: "standpipe_pressure" },
    { key: "pump_rate", label: "Pump rate", source: "pump_rate" },
    { key: "pit_volume", label: "Pit volume", source: "pit_volume" },
  ] as const
).filter((col) => !(col.key in UNAVAILABLE_CHANNELS));

function wellLabel(item: WellCompareSummary): string {
  return item.well.well_name ?? item.well.well_id;
}

function formatNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatValue(value: MetricValue, unit: string): string {
  if (value === null) return "Unavailable";
  if (typeof value === "string") return value;
  return `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}

function difference(value: MetricValue, reference: MetricValue, unit: string): string | null {
  if (typeof value !== "number" || typeof reference !== "number") return null;
  const delta = value - reference;
  if (delta === 0) return `0${unit ? ` ${unit}` : ""}`;
  return `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))}${unit ? ` ${unit}` : ""}`;
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function durationHours(item: WellCompareSummary): number | null {
  const timestamps = item.timeseries.flatMap((row) => {
    if (row.timestamp === null) return [];
    const value = Date.parse(row.timestamp);
    return Number.isFinite(value) ? [value] : [];
  });
  if (timestamps.length < 2) return null;
  return (Math.max(...timestamps) - Math.min(...timestamps)) / 3_600_000;
}

function eventType(event: WellCompareSummary["events"][number]): string {
  return event.event_subtype ?? event.event_type;
}


function eventLatest(item: WellCompareSummary) {
  return item.events.slice().sort((left, right) => {
    const leftTime = left.start_time ? Date.parse(left.start_time) : Number.NEGATIVE_INFINITY;
    const rightTime = right.start_time ? Date.parse(right.start_time) : Number.NEGATIVE_INFINITY;
    return rightTime - leftTime;
  }).slice(0, 5);
}

function useVisibleWells(wells: WellCompareSummary[], selectedIds: string[], visibility: Record<string, boolean>) {
  return useMemo(() => {
    const ids = selectedIds.length ? selectedIds : wells.map((item) => item.well.well_id).slice(0, 6);
    return ids.flatMap((id) => {
      const item = wells.find((candidate) => candidate.well.well_id === id);
      return item && visibility[id] !== false ? [item] : [];
    });
  }, [selectedIds, visibility, wells]);
}

function PanelHeading({ title, detail }: { title: string; detail?: string }) {
  return <div className="wcp-panel-heading"><h2>{title}</h2>{detail && <span>{detail}</span>}</div>;
}

function ChartTip({ children }: { children: React.ReactNode }) {
  return <div className="wcp-tooltip">{children}</div>;
}

export function WellComparePanel() {
  const data = useWellCompareData();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [referenceId, setReferenceId] = useState("");
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);

  const [hoveredPoint, setHoveredPoint] = useState<PlotPoint | null>(null);
  const [hoveredChart, setHoveredChart] = useState<HoverChart>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  const hookData = useMemo(() => data.status === "ready" ? data.wells : [], [data]);
  // Merge hook wells with the three derived wells (only when at least one real well exists)
  const wells = useMemo(() => {
    if (hookData.length === 0) return hookData;
    const ref = hookData[0];
    if (ref === undefined) return hookData;
    return [...hookData, ...buildSampleWells(ref)];
  }, [hookData]);
  const selected = useVisibleWells(wells, selectedIds, visibility);
  const reference = selected.find((item) => item.well.well_id === referenceId) ?? selected[0] ?? null;
  const metrics = useMemo(() => computeMetrics(selected), [selected]);
  const allEvents = selected.flatMap((item) => item.events.map((event) => ({ item, event })));
  const eventTypes = [...new Set(allEvents.map(({ event }) => eventType(event)))].sort();
  const totalDepthValue = reference ? totalDepth(reference) : null;
  const maxInclination = reference ? reference.trajectory.reduce<number | null>((maximum, point) =>
    typeof point.inclination === "number" && Number.isFinite(point.inclination) && (maximum === null || point.inclination > maximum) ? point.inclination : maximum, null) : null;
  const maxInclinationMd = reference ? reference.trajectory.reduce<number | null>((bestMd, point) => {
    if (typeof point.inclination !== "number" || !Number.isFinite(point.inclination)) return bestMd;
    if (maxInclination === null || point.inclination < maxInclination) return bestMd;
    return point.md;
  }, null) : null;
  const maxDogleg = reference ? reference.trajectory.reduce<number | null>((maximum, point) =>
    typeof point.dogleg_severity === "number" && Number.isFinite(point.dogleg_severity) && (maximum === null || point.dogleg_severity > maximum) ? point.dogleg_severity : maximum, null) : null;
  const maxDoglegMd = reference ? reference.trajectory.reduce<number | null>((bestMd, point) => {
    if (typeof point.dogleg_severity !== "number" || !Number.isFinite(point.dogleg_severity)) return bestMd;
    if (maxDogleg === null || point.dogleg_severity < maxDogleg) return bestMd;
    return point.md;
  }, null) : null;
  const tvdAtTd = (() => {
    if (!reference || totalDepthValue === null) return null;
    const point = reference.trajectory.slice().reverse().find((p) =>
      typeof p.tvd === "number" && Number.isFinite(p.tvd));
    return point?.tvd ?? null;
  })();
  const horizontalDisplacement = reference
    ? metrics.find((metric) => metric.key === "horizontal-displacement")?.values[reference.well.well_id]
    : null;
  const summaryTimestamps = reference ? reference.timeseries.flatMap((row) => {
    if (!row.timestamp) return [];
    const value = Date.parse(row.timestamp);
    return Number.isFinite(value) ? [{ value, raw: row.timestamp }] : [];
  }) : [];
  const firstTimestamp = summaryTimestamps.length
    ? summaryTimestamps.reduce((min, t) => t.value < min.value ? t : min).raw
    : null;
  const lastTimestamp = summaryTimestamps.length
    ? summaryTimestamps.reduce((max, t) => t.value > max.value ? t : max).raw
    : null;
  const avgRop = reference ? average(reference.timeseries.map((row) => row.rop)) : null;
  const activeTime = reference ? durationHours(reference) : null;
  const summaryEventCount = reference ? reference.events.length : null;

  const latestEvents = reference ? eventLatest(reference) : [];
  // Default to first 4 wells (not 6) so the selector caption and charts stay readable
  const selectedDefaultIds = selectedIds.length ? selectedIds : wells.map((item) => item.well.well_id).slice(0, 4);
  const selectable = wells.filter((item) => selectedDefaultIds.includes(item.well.well_id));
  const chartWells = selectable.filter((item) => visibility[item.well.well_id] !== false);
  const paletteIndex = (wellId: string) => Math.max(0, wells.findIndex((item) => item.well.well_id === wellId)) % WELL_COLORS.length;
  const colorFor = (wellId: string) => WELL_COLORS[paletteIndex(wellId)] ?? "#2F7BFF";

  const setChartHover = (chart: HoverChart, point: PlotPoint | null) => {
    setHoveredChart(chart);
    setHoveredPoint(point);
  };
  const toggleWell = (id: string) => {
    setSelectedIds((current) => {
      const active = current.length ? current : wells.map((item) => item.well.well_id).slice(0, 4);
      if (active.includes(id)) return active.filter((wellId) => wellId !== id);
      return active.length >= 4 ? active : [...active, id];
    });
    setReferenceId((current) => current || id);
  };
  const toggleVisibility = (id: string) => {
    setVisibility((current) => ({ ...current, [id]: current[id] === false }));
  };

  if (data.status === "loading") {
    return <section className="wcp-root wcp-dashboard" aria-label="Loading well comparison">
      <div className="wcp-skeleton-header" />
      <div className="wcp-kpi-grid">{[0, 1, 2, 3, 4, 5, 6].map((index) => <div className="wcp-skeleton-card" key={index} />)}</div>
      <div className="wcp-dashboard-grid">{[0, 1, 2, 3, 4, 5, 6, 7].map((index) => <div className="wcp-skeleton-card wcp-skeleton-panel" key={index} />)}</div>
    </section>;
  }
  if (data.status === "error") {
    return <section className="wcp-root wcp-dashboard wcp-error" role="alert">
      <div><span className="wcp-kicker">Well intelligence</span><h1>Well Comparison</h1><p>{data.error || "Could not load comparison data."}</p><button className="wcp-button" onClick={data.retry} type="button">Retry</button></div>
    </section>;
  }
  if (!wells.length) {
    return <section className="wcp-root wcp-dashboard"><span className="wcp-kicker">Well intelligence</span><h1>Well Comparison</h1><p className="wcp-empty-panel">No wells are available in this dataset.</p></section>;
  }

  // ── Plan-view: relative (easting, northing) per well, origin = first valid point ──
  function planNiceStep(range: number): number {
    if (range <= 0) return 1;
    const raw = range / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
    return step * mag;
  }

  const planWellPoints = chartWells.map((item) => {
    const raw = item.trajectory.flatMap((point) =>
      typeof point.northing === "number" && Number.isFinite(point.northing) &&
      typeof point.easting === "number" && Number.isFinite(point.easting)
        ? [{ md: point.md, northing: point.northing, easting: point.easting }]
        : []);
    const empty = { item, points: [] as { relE: number; relN: number; md: number }[] };
    if (raw.length < 2) return empty;
    const first = raw[0];
    if (first === undefined) return empty;
    const originN = first.northing;
    const originE = first.easting;
    return {
      item,
      points: raw.map((p) => ({ relE: p.easting - originE, relN: p.northing - originN, md: p.md })),
    };
  });

  const planAllPoints = planWellPoints.flatMap((w) => w.points);
  const planHasData = planAllPoints.length >= 2;

  // Padded data bounds (10%)
  const planRelEMin = planHasData ? Math.min(...planAllPoints.map((p) => p.relE)) : -1;
  const planRelEMax = planHasData ? Math.max(...planAllPoints.map((p) => p.relE)) : 1;
  const planRelNMin = planHasData ? Math.min(...planAllPoints.map((p) => p.relN)) : -1;
  const planRelNMax = planHasData ? Math.max(...planAllPoints.map((p) => p.relN)) : 1;
  const planERange = Math.max(planRelEMax - planRelEMin, 1);
  const planNRange = Math.max(planRelNMax - planRelNMin, 1);
  const planEPad = planERange * 0.10;
  const planNPad = planNRange * 0.10;
  const planDataEMin = planRelEMin - planEPad;
  const planDataEMax = planRelEMax + planEPad;
  const planDataNMin = planRelNMin - planNPad;
  const planDataNMax = planRelNMax + planNPad;
  const planDataESpan = planDataEMax - planDataEMin;
  const planDataNSpan = planDataNMax - planDataNMin;

  // SVG canvas
  const planW = 340;
  const planH = 300;
  const planLeft = 42;   // y-axis labels
  const planRight = 10;
  const planTop = 10;
  const planBottom = 30; // x-axis labels + title
  const planPlotW = planW - planLeft - planRight;
  const planPlotH = planH - planTop - planBottom;

  // Equal-aspect scale; centre unused dimension
  const planScale = Math.min(
    planPlotW / Math.max(planDataESpan, 0.001),
    planPlotH / Math.max(planDataNSpan, 0.001),
  );
  const planUsedW = planDataESpan * planScale;
  const planUsedH = planDataNSpan * planScale;
  const planOX = planLeft + (planPlotW - planUsedW) / 2;   // plot-area left edge in SVG px
  const planOY = planTop + (planPlotH - planUsedH) / 2;    // plot-area top edge in SVG px

  // data → SVG  (north up = SVG y decreases, east right = SVG x increases)
  const planXY = (relE: number, relN: number) => ({
    x: planOX + (relE - planDataEMin) * planScale,
    y: planOY + (planDataNMax - relN) * planScale,
  });

  // Tick steps and arrays
  const planEStep = planNiceStep(planDataESpan);
  const planNStep = planNiceStep(planDataNSpan);

  function ticksInRange(min: number, max: number, step: number): number[] {
    const result: number[] = [];
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max + step * 0.001; v += step) result.push(Math.round(v));
    return result;
  }
  const planETicks = ticksInRange(planDataEMin, planDataEMax, planEStep);
  const planNTicks = ticksInRange(planDataNMin, planDataNMax, planNStep);

  function planTickLabel(v: number): string {
    if (Math.abs(v) >= 1000) return `${v / 1000}k`;
    return String(v);
  }

  // Scale bar: ~1/5 of plot width
  const planScaleBarTargetPx = planPlotW / 5;
  const planScaleCandidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const planScaleM = planScaleCandidates.reduce((best, m) => {
    const px = m * planScale;
    return px <= planScaleBarTargetPx * 2 && px > 0 ? m : best;
  }, planScaleCandidates[0] ?? 1);
  const planScalePx = planScaleM * planScale;
  const planScaleLabel = planScaleM >= 1000 ? `${planScaleM / 1000} km` : `${planScaleM} m`;

  // Scale bar position: bottom-left of plot area
  const planSbX1 = planOX + 2;
  const planSbX2 = planSbX1 + planScalePx;
  const planSbY = planOY + planUsedH + 10;

  // North arrow: top-right of plot area
  const planNAX = planOX + planUsedW - 8;
  const planNAY = planOY + 28;

  // Max-offset readout for reference well
  const planRefPoints = reference
    ? planWellPoints.find((w) => w.item.well.well_id === reference.well.well_id)?.points ?? []
    : [];
  const planMaxOffsetEntry = planRefPoints.reduce<{ dist: number; relE: number; relN: number } | null>(
    (best, p) => {
      const d = Math.hypot(p.relE, p.relN);
      return best === null || d > best.dist ? { dist: d, relE: p.relE, relN: p.relN } : best;
    },
    null,
  );
  const planMaxOffsetM = planMaxOffsetEntry !== null ? planMaxOffsetEntry.dist : null;
  const planMaxOffsetBearing =
    planMaxOffsetEntry !== null
      ? ((Math.atan2(planMaxOffsetEntry.relE, planMaxOffsetEntry.relN) * 180) / Math.PI + 360) % 360
      : null;
  const planOffsetReadout =
    planMaxOffsetM !== null && planMaxOffsetBearing !== null
      ? `Max offset: ${formatNumber(planMaxOffsetM)} m at bearing ${formatNumber(planMaxOffsetBearing, 0)}°`
      : "Max offset: Unavailable";

  // ── ROP vs depth ─────────────────────────────────────────────────────────────

  // Collect all valid (md, rop) pairs across visible wells
  const ropRawAll = chartWells.flatMap((item) =>
    item.timeseries.flatMap((row) =>
      typeof row.md === "number" && Number.isFinite(row.md) &&
      typeof row.rop === "number" && Number.isFinite(row.rop) && row.rop >= 0
        ? [{ item, md: row.md, rop: row.rop }]
        : [],
    ),
  );

  // 99th-percentile cap for the y-axis
  const ropCapValue = (() => {
    const vals = ropRawAll.map((p) => p.rop).sort((a, b) => a - b);
    if (vals.length === 0) return 1;
    const idx = Math.min(vals.length - 1, Math.floor(vals.length * 0.99));
    return Math.max(1, vals[idx] ?? 1);
  })();

  const maxRopMd = Math.max(1, ...ropRawAll.map((p) => p.md));

  // 50 m bins → smoothed polyline per well
  const BIN_SIZE = 50;
  function ropBins(rows: typeof ropRawAll): { md: number; rop: number }[] {
    if (rows.length === 0) return [];
    const maxMd = Math.max(...rows.map((p) => p.md));
    const nBins = Math.ceil(maxMd / BIN_SIZE) + 1;
    const sums: number[] = new Array(nBins).fill(0) as number[];
    const counts: number[] = new Array(nBins).fill(0) as number[];
    for (const p of rows) {
      const b = Math.floor(p.md / BIN_SIZE);
      if (b >= 0 && b < nBins) {
        sums[b] = (sums[b] ?? 0) + p.rop;
        counts[b] = (counts[b] ?? 0) + 1;
      }
    }
    const result: { md: number; rop: number }[] = [];
    for (let b = 0; b < nBins; b++) {
      const c = counts[b] ?? 0;
      if (c > 0) result.push({ md: (b + 0.5) * BIN_SIZE, rop: (sums[b] ?? 0) / c });
    }
    return result;
  }

  // Median helper
  function median(vals: number[]): number | null {
    if (vals.length === 0) return null;
    const s = vals.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
  }

  // Per-well stats for the strip
  const ropWellStats = chartWells.map((item) => {
    const vals = item.timeseries.flatMap((row) =>
      typeof row.rop === "number" && Number.isFinite(row.rop) && row.rop >= 0
        ? [row.rop]
        : [],
    );
    const mdVals = item.timeseries.flatMap((row) =>
      typeof row.rop === "number" && Number.isFinite(row.rop) && row.rop >= 0 &&
      typeof row.md === "number" && Number.isFinite(row.md)
        ? [{ rop: row.rop, md: row.md }]
        : [],
    );
    if (vals.length === 0) return { item, avg: null, med: null, max: null, maxMd: null };
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const med = median(vals);
    const maxEntry = mdVals.reduce<{ rop: number; md: number } | null>(
      (best, p) => best === null || p.rop > best.rop ? p : best,
      null,
    );
    return { item, avg, med, max: maxEntry?.rop ?? null, maxMd: maxEntry?.md ?? null };
  });

  // Round tick steps for ROP y-axis
  function ropNiceStep(range: number): number {
    if (range <= 0) return 1;
    const raw = range / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
    return step * mag;
  }
  const ropStep = ropNiceStep(ropCapValue);
  const ropTicks: number[] = [];
  for (let v = 0; v <= ropCapValue + ropStep * 0.01; v += ropStep) ropTicks.push(Math.round(v));

  const ropPoints = ropRawAll; // kept for EmptyPanel guard
  const maxEventCount = Math.max(1, ...eventTypes.flatMap((type) => chartWells.map((item) => item.events.filter((event) => eventType(event) === type).length)));


  return <section className="wcp-root wcp-dashboard" aria-label="Well comparison dashboard">
    <header className="wcp-topbar">
      <div className="wcp-title-block">
        <span className="wcp-kicker">Drilling intelligence</span>
        <h1>Well Comparison</h1>
        <p>Compare drilling performance, trajectory and risk across wells</p>
      </div>
      <div className="wcp-control-block">
        <label className="wcp-control-label">Wells <span>{selectedDefaultIds.length}/4 selected</span>
          <div className="wcp-select-menu">
            <details>
              <summary>{selectable.length ? selectable.map(wellLabel).join(", ") : "Select wells"}</summary>
              <div className="wcp-select-options">
                {wells.map((item) => {
                  const active = selectedDefaultIds.includes(item.well.well_id);
                  return <label className="wcp-select-option" key={item.well.well_id}>
                    <input checked={active} disabled={!active && selectedDefaultIds.length >= 4} onChange={() => toggleWell(item.well.well_id)} type="checkbox" />
                    <i style={{ "--wcp-color": colorFor(item.well.well_id) } as CssVars} />{wellLabel(item)}
                  </label>;
                })}
              </div>
            </details>
          </div>
        </label>
        <label className="wcp-control-label">Reference well
          <select value={reference?.well.well_id ?? ""} onChange={(event) => setReferenceId(event.target.value)}>
            {selectable.map((item) => <option key={item.well.well_id} value={item.well.well_id}>{wellLabel(item)}</option>)}
          </select>
        </label>
      </div>
    </header>

    {hookData.length === 1 && <div className="wcp-info-bar">Only one well is available in this dataset. More wells will appear here when added.</div>}

    <div className="wcp-kpi-grid">
      <KpiCard label="Total depth (MD)" value={formatValue(totalDepthValue, "m")} color="blue" />
      <KpiCard label="Max inclination" value={formatValue(maxInclination, "°")} color="teal" />
      <KpiCard label="Horizontal displacement" value={formatValue(typeof horizontalDisplacement === "number" ? horizontalDisplacement : null, "m")} color="purple" />
      <KpiCard label="Avg ROP" value={formatValue(avgRop, "m/h")} color="orange" />
      {reference?.timeseries.some((row) => row.timestamp !== null) && <KpiCard label="Drilling duration" value={formatValue(activeTime, "h")} color="pink" />}
      <KpiCard label="Events" value={reference ? formatNumber(reference.events.length, 0) : "Unavailable"} color="lime" />

    </div>

    <div className="wcp-dashboard-grid wcp-grid-three">
      <article className="wcp-panel-card wcp-span-4">
        <PanelHeading title="Field map" detail="Satellite imagery · wells with known coordinates" />
        <FieldMap
          wells={WELL_LOCATIONS}
          referenceName={reference ? wellLabel(reference) : ""}
        />
      </article>

      <article className="wcp-panel-card wcp-span-4">
        <PanelHeading title="Plan view" detail="Northing / easting · local survey coordinates" />
        <p className="wcp-plan-offset">{planOffsetReadout}</p>
        {planHasData ? <div className="wcp-chart-box wcp-relative">
          <svg className="wcp-svg" viewBox={`0 0 ${planW} ${planH}`} role="img" aria-label="Well plan view" onMouseLeave={() => setChartHover(null, null)}>

            {/* Dashed gridlines at tick positions */}
            {planETicks.map((v) => {
              const x = planXY(v, 0).x;
              return <line key={`pgx-${v}`} className="wcp-gridline" x1={x} x2={x} y1={planOY} y2={planOY + planUsedH} />;
            })}
            {planNTicks.map((v) => {
              const y = planXY(0, v).y;
              return <line key={`pgy-${v}`} className="wcp-gridline" x1={planOX} x2={planOX + planUsedW} y1={y} y2={y} />;
            })}

            {/* X-axis (Easting) ticks + labels */}
            {planETicks.map((v) => {
              const x = planXY(v, 0).x;
              const axisY = planOY + planUsedH;
              return <g key={`pet-${v}`}>
                <line className="wcp-axis-tick" x1={x} x2={x} y1={axisY} y2={axisY + 3} />
                <text className="wcp-svg-label" x={x} y={axisY + 9} textAnchor="middle">{planTickLabel(v)}</text>
              </g>;
            })}
            <text className="wcp-svg-label" x={planOX + planUsedW / 2} y={planH - 4} textAnchor="middle">Easting (m)</text>

            {/* Y-axis (Northing) ticks + labels */}
            {planNTicks.map((v) => {
              const y = planXY(0, v).y;
              return <g key={`pnt-${v}`}>
                <line className="wcp-axis-tick" x1={planOX - 3} x2={planOX} y1={y} y2={y} />
                <text className="wcp-svg-label" x={planOX - 5} y={y + 3} textAnchor="end">{planTickLabel(v)}</text>
              </g>;
            })}
            <text className="wcp-svg-label" transform={`translate(9 ${planOY + planUsedH / 2}) rotate(-90)`} textAnchor="middle">Northing (m)</text>

            {/* Well paths */}
            {planWellPoints.map(({ item, points }) => {
              if (points.length < 2) return null;
              const svgPts = points.map((p) => planXY(p.relE, p.relN));
              const pathD = svgPts.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ");
              const head = svgPts[0];
              const tail = svgPts[svgPts.length - 1];
              const isRef = item.well.well_id === reference?.well.well_id;
              if (head === undefined || tail === undefined) return null;
              return <g key={item.well.well_id} style={{ "--wcp-color": colorFor(item.well.well_id) } as CssVars}>
                <path
                  className="wcp-line"
                  d={pathD}
                  opacity={isRef ? 1 : 0.65}
                />
                {/* Wellhead circle */}
                <circle className="wcp-head-marker" cx={head.x} cy={head.y} r="4">
                  <title>{wellLabel(item)} surface</title>
                </circle>
                <text className="wcp-svg-label wcp-plan-marker-label" x={head.x + 5} y={head.y - 3}>Surface</text>
                {/* TD marker: "+" cross */}
                <line className="wcp-plan-td" x1={tail.x - 4} x2={tail.x + 4} y1={tail.y} y2={tail.y} />
                <line className="wcp-plan-td" x1={tail.x} x2={tail.x} y1={tail.y - 4} y2={tail.y + 4} />
                <text className="wcp-svg-label wcp-plan-marker-label" x={tail.x + 5} y={tail.y + 3}>TD</text>
                {/* Hit areas */}
                {points.map((p, index) => {
                  const pt = svgPts[index];
                  if (pt === undefined) return null;
                  return <circle
                    className="wcp-hit-point"
                    key={`${item.well.well_id}-${index}`}
                    cx={pt.x} cy={pt.y} r="5"
                    onMouseEnter={() => setChartHover("plan", { x: pt.x, y: pt.y, md: p.md, value: Math.hypot(p.relE, p.relN), wellId: item.well.well_id })}
                  />;
                })}
              </g>;
            })}

            {/* Scale bar */}
            <line className="wcp-scale" x1={planSbX1} x2={planSbX2} y1={planSbY} y2={planSbY} />
            <line className="wcp-scale" x1={planSbX1} x2={planSbX1} y1={planSbY - 4} y2={planSbY + 4} />
            <line className="wcp-scale" x1={planSbX2} x2={planSbX2} y1={planSbY - 4} y2={planSbY + 4} />
            <text className="wcp-svg-label" x={(planSbX1 + planSbX2) / 2} y={planSbY - 5} textAnchor="middle">{planScaleLabel}</text>

            {/* North arrow */}
            <line className="wcp-compass" x1={planNAX} x2={planNAX} y1={planNAY} y2={planNAY - 14} />
            <path className="wcp-compass" d={`M${planNAX - 4},${planNAY - 8} L${planNAX},${planNAY - 14} L${planNAX + 4},${planNAY - 8}`} fill="none" />
            <text className="wcp-svg-label" x={planNAX} y={planNAY + 8} textAnchor="middle">N</text>
          </svg>
          {hoveredChart === "plan" && hoveredPoint && <ChartTip>{wellLabel(wells.find((item) => item.well.well_id === hoveredPoint.wellId) ?? chartWells[0] as WellCompareSummary)} · offset {formatNumber(hoveredPoint.value)} m</ChartTip>}
        </div> : <EmptyPanel text="Northing and easting survey coordinates unavailable." />}
        <Legend wells={selectable} colorFor={colorFor} visibility={visibility} onToggle={toggleVisibility} />
      </article>

      <article className="wcp-panel-card wcp-span-4 wcp-summary" aria-label="Well summary">
        <PanelHeading title="Well summary" detail={reference ? wellLabel(reference) : "No reference well"} />
        {reference ? (
          <dl className="wcp-summary-list">
            <div className="wcp-summary-row">
              <dt>Total depth MD</dt>
              <dd>{totalDepthValue !== null ? `${formatNumber(totalDepthValue)} m` : "Unavailable"}</dd>
            </div>
            <div className="wcp-summary-row">
              <dt>TVD at TD</dt>
              <dd>{tvdAtTd !== null ? `${formatNumber(tvdAtTd)} m` : "Unavailable"}</dd>
            </div>
            <div className="wcp-summary-row">
              <dt>Max inclination</dt>
              <dd>{maxInclination !== null ? `${formatNumber(maxInclination)}°` : "Unavailable"}{maxInclinationMd !== null && maxInclination !== null ? <span className="wcp-summary-sub">at {formatNumber(maxInclinationMd)} m MD</span> : null}</dd>
            </div>
            <div className="wcp-summary-row">
              <dt>Max dogleg</dt>
              <dd>{maxDogleg !== null ? `${formatNumber(maxDogleg)} °/30 m` : "Unavailable"}{maxDoglegMd !== null && maxDogleg !== null ? <span className="wcp-summary-sub">at {formatNumber(maxDoglegMd)} m MD</span> : null}</dd>
            </div>
            <div className="wcp-summary-row">
              <dt>Horiz. displacement</dt>
              <dd>{typeof horizontalDisplacement === "number" && Number.isFinite(horizontalDisplacement) ? `${formatNumber(horizontalDisplacement)} m` : "Unavailable"}</dd>
            </div>
            <div className="wcp-summary-row">
              <dt>First timestamp</dt>
              <dd>{firstTimestamp ?? "Unavailable"}</dd>
            </div>
            <div className="wcp-summary-row">
              <dt>Last timestamp</dt>
              <dd>{lastTimestamp ?? "Unavailable"}</dd>
            </div>
            <div className="wcp-summary-row">
              <dt>Drilling duration</dt>
              <dd>{activeTime !== null ? `${formatNumber(activeTime)} h` : "Unavailable"}</dd>
            </div>
            <div className="wcp-summary-row">
              <dt>Avg ROP</dt>
              <dd>{avgRop !== null ? `${formatNumber(avgRop)} m/h` : "Unavailable"}</dd>
            </div>
            <div className="wcp-summary-row">
              <dt>Event count</dt>
              <dd>{summaryEventCount !== null ? formatNumber(summaryEventCount, 0) : "Unavailable"}</dd>
            </div>
          </dl>
        ) : <EmptyPanel text="Select a reference well to see the summary." />}
      </article>

    </div>

    <div className="wcp-dashboard-grid wcp-grid-three">
      <article className="wcp-panel-card wcp-span-4">
        <PanelHeading title="ROP vs depth" detail="Measured depth (m) · ROP (m/h) · one row per well" />
        {ropPoints.length ? (() => {
          // ── Small-multiples constants ────────────────────────────────────────
          const smW = 360;
          const smRowH = 110;
          const smLeft = 38;   // room for y labels
          const smRight = 8;
          const smTop = 18;    // room for well title text
          const smBottomInner = 6;   // rows that share axes with one below
          const smBottomLast = 22;   // bottom row: x tick labels + axis title
          const smPlotW = smW - smLeft - smRight;

          // Shared x mapping
          const smX = (md: number) => smLeft + (md / Math.max(maxRopMd, 1)) * smPlotW;

          // Keep ~3 y ticks: first, last, and one middle
          const smYTicks = ropTicks.filter((_, i, arr) => {
            if (arr.length <= 3) return true;
            return i === 0 || i === arr.length - 1 || i === Math.floor((arr.length - 1) / 2);
          });

          const lastIdx = chartWells.length - 1;

          return (
            <div className="wcp-rop-small" onMouseLeave={() => setChartHover(null, null)}>
              {chartWells.map((item, wellIndex) => {
                const isLast = wellIndex === lastIdx;
                const smBottomCur = isLast ? smBottomLast : smBottomInner;
                const smPlotH = smRowH - smTop - smBottomCur;
                const plotBottom = smTop + smPlotH;

                // smY: data-value → svg y coordinate
                const smY = (rop: number) =>
                  smTop + smPlotH - Math.min(rop / ropCapValue, 1) * smPlotH;

                const wellRaw = item.timeseries.flatMap((row) =>
                  typeof row.md === "number" && Number.isFinite(row.md) &&
                  typeof row.rop === "number" && Number.isFinite(row.rop) && row.rop >= 0
                    ? [{ md: row.md, rop: row.rop }]
                    : [],
                );

                if (wellRaw.length === 0) {
                  return (
                    <div
                      key={item.well.well_id}
                      className="wcp-rop-row"
                      style={{ "--wcp-color": colorFor(item.well.well_id) } as CssVars}
                    >
                      <svg className="wcp-svg" viewBox={`0 0 ${smW} ${smRowH}`} aria-hidden="true">
                        <text
                          x={smLeft}
                          y={smTop - 4}
                          fill={colorFor(item.well.well_id)}
                          fontSize="8"
                          fontWeight="650"
                        >{wellLabel(item)}</text>
                      </svg>
                      <div className="wcp-rop-unavail">Unavailable</div>
                    </div>
                  );
                }

                const rawPath = wellRaw
                  .map((p, i) => `${i === 0 ? "M" : "L"}${smX(p.md).toFixed(1)},${smY(p.rop).toFixed(1)}`)
                  .join(" ");

                const bins = ropBins(wellRaw.map((p) => ({ item, ...p })));
                const smoothPts = bins.map((p) => ({ x: smX(p.md), y: smY(p.rop) }));
                const smoothPath = smoothPts
                  .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
                  .join(" ");

                const firstPt = smoothPts[0];
                const lastPt = smoothPts[smoothPts.length - 1];
                const fillPath =
                  firstPt !== undefined && lastPt !== undefined && smoothPath
                    ? `${smoothPath} L${lastPt.x.toFixed(1)},${plotBottom} L${firstPt.x.toFixed(1)},${plotBottom} Z`
                    : "";

                const statEntry = ropWellStats.find(
                  (s) => s.item.well.well_id === item.well.well_id,
                );
                const maxRopVal = statEntry?.max ?? null;
                const maxRopMdVal = statEntry?.maxMd ?? null;
                const maxExceedsCap = maxRopVal !== null && maxRopVal > ropCapValue;
                const maxDotX = maxRopMdVal !== null ? smX(maxRopMdVal) : null;
                const maxDotY = maxRopVal !== null ? smY(maxRopVal) : null;

                return (
                  <div
                    key={item.well.well_id}
                    className="wcp-rop-row"
                    style={{ "--wcp-color": colorFor(item.well.well_id) } as CssVars}
                  >
                    <svg
                      className="wcp-svg"
                      viewBox={`0 0 ${smW} ${smRowH}`}
                      role="img"
                      aria-label={`ROP vs depth for ${wellLabel(item)}`}
                    >
                      {/* Well title */}
                      <text
                        x={smLeft}
                        y={smTop - 4}
                        fill={colorFor(item.well.well_id)}
                        fontSize="8"
                        fontWeight="650"
                        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
                      >{wellLabel(item)}</text>

                      {/* Y ticks + gridlines (all rows) */}
                      {smYTicks.map((tick) => {
                        const ty = smY(tick);
                        return (
                          <g key={tick}>
                            <line className="wcp-gridline" x1={smLeft} x2={smLeft + smPlotW} y1={ty} y2={ty} />
                            <text className="wcp-svg-label" x={smLeft - 3} y={ty + 3} textAnchor="end">{tick}</text>
                          </g>
                        );
                      })}

                      {/* X ticks + axis title — bottom row only */}
                      {isLast && [0, 0.25, 0.5, 0.75, 1].map((frac) => {
                        const mdVal = maxRopMd * frac;
                        const tx = smX(mdVal);
                        return (
                          <g key={frac}>
                            <line className="wcp-axis-tick" x1={tx} x2={tx} y1={plotBottom} y2={plotBottom + 3} />
                            <text className="wcp-svg-label" x={tx} y={plotBottom + 10} textAnchor="middle">
                              {mdVal >= 1000 ? `${(mdVal / 1000).toFixed(1)}k` : String(Math.round(mdVal))}
                            </text>
                          </g>
                        );
                      })}
                      {isLast && (
                        <text
                          className="wcp-svg-label"
                          x={smLeft + smPlotW / 2}
                          y={smRowH - 2}
                          textAnchor="middle"
                        >Measured depth (m)</text>
                      )}

                      {/* Area fill under smooth line */}
                      {fillPath && <path className="wcp-rop-fill" d={fillPath} />}

                      {/* Raw trace */}
                      {rawPath && <path className="wcp-rop-raw-trace" d={rawPath} />}

                      {/* Smooth line */}
                      {smoothPath && <path className="wcp-rop-smooth" d={smoothPath} />}

                      {/* Max ROP marker */}
                      {maxDotX !== null && maxDotY !== null && maxRopVal !== null && maxRopMdVal !== null && (
                        <g>
                          {maxExceedsCap && (
                            <polygon
                              points={`${maxDotX.toFixed(1)},${smTop + 1} ${(maxDotX - 4).toFixed(1)},${smTop + 8} ${(maxDotX + 4).toFixed(1)},${smTop + 8}`}
                              fill={colorFor(item.well.well_id)}
                              opacity="0.8"
                            />
                          )}
                          <circle className="wcp-rop-max-dot" cx={maxDotX} cy={maxDotY} r="3" />
                          <text className="wcp-rop-max-label" x={maxDotX + 5} y={maxDotY - 2}>
                            {formatNumber(maxRopVal)} at {formatNumber(maxRopMdVal, 0)} m
                          </text>
                        </g>
                      )}

                      {/* Hit areas for tooltip */}
                      {wellRaw.map((p, index) => {
                        const hx = smX(p.md);
                        const hy = smY(p.rop);
                        return (
                          <circle
                            className="wcp-hit-point"
                            key={`${item.well.well_id}-${index}`}
                            cx={hx}
                            cy={hy}
                            r="5"
                            onMouseEnter={() =>
                              setChartHover("rop", {
                                x: hx, y: hy, md: p.md, value: p.rop, wellId: item.well.well_id,
                              })
                            }
                          />
                        );
                      })}
                    </svg>
                  </div>
                );
              })}
              {hoveredChart === "rop" && hoveredPoint && (
                <ChartTip>
                  {wellLabel(
                    wells.find((item) => item.well.well_id === hoveredPoint.wellId) ??
                    chartWells[0] as WellCompareSummary,
                  )} · MD {formatNumber(hoveredPoint.md)} m · ROP {formatNumber(hoveredPoint.value)} m/h
                </ChartTip>
              )}
            </div>
          );
        })() : <EmptyPanel text="No ROP data for selected wells." />}

        {/* Stats strip */}
        {ropWellStats.some((s) => s.avg !== null) && <div className="wcp-rop-stats">
          <div className="wcp-rop-stats-row">
            <span className="wcp-rop-stats-label" />
            <span className="wcp-rop-stats-head">Avg</span>
            <span className="wcp-rop-stats-head">Median</span>
            <span className="wcp-rop-stats-head">Max</span>
            <span className="wcp-rop-stats-head">Max @ MD</span>
          </div>
          {ropWellStats.map(({ item, avg, med, max, maxMd }) => (
            <div className="wcp-rop-stats-row" key={item.well.well_id}>
              <span className="wcp-rop-stats-label" style={{ color: colorFor(item.well.well_id) }}>{wellLabel(item)}</span>
              <span className={avg !== null ? "wcp-rop-stats-val" : "wcp-rop-stats-na"}>{avg !== null ? `${formatNumber(avg)} m/h` : "Unavailable"}</span>
              <span className={med !== null ? "wcp-rop-stats-val" : "wcp-rop-stats-na"}>{med !== null ? `${formatNumber(med)} m/h` : "Unavailable"}</span>
              <span className={max !== null ? "wcp-rop-stats-val" : "wcp-rop-stats-na"}>{max !== null ? `${formatNumber(max)} m/h` : "Unavailable"}</span>
              <span className={maxMd !== null ? "wcp-rop-stats-val" : "wcp-rop-stats-na"}>{maxMd !== null ? `${formatNumber(maxMd, 0)} m` : "Unavailable"}</span>
            </div>
          ))}
        </div>}
      </article>

      <article className="wcp-panel-card wcp-span-4">
        <PanelHeading title="ROP ranking" detail="Average · median · max · depth intervals · m/h" />
        {(() => {
          // Build per-well stats from already-computed ropWellStats
          const toRows = (getValue: (s: typeof ropWellStats[number]) => number | null): RankRow[] =>
            ropWellStats.map((s) => ({
              id:     s.item.well.well_id,
              label:  wellLabel(s.item),
              value:  getValue(s),
              isRef:  s.item.well.well_id === reference?.well.well_id,
              color:  colorFor(s.item.well.well_id),
            }));

          // Depth-interval ROP: split each well's MD range into thirds
          const intervalRows = (interval: 0 | 1 | 2): RankRow[] =>
            ropWellStats.map((s) => {
              const pts = s.item.timeseries.flatMap((row) =>
                typeof row.md === "number" && Number.isFinite(row.md) &&
                typeof row.rop === "number" && Number.isFinite(row.rop) && row.rop >= 0
                  ? [{ md: row.md, rop: row.rop }]
                  : [],
              );
              if (pts.length === 0) return { id: s.item.well.well_id, label: wellLabel(s.item), value: null, isRef: s.item.well.well_id === reference?.well.well_id, color: colorFor(s.item.well.well_id) };
              const minMd = Math.min(...pts.map((p) => p.md));
              const maxMd = Math.max(...pts.map((p) => p.md));
              const span = maxMd - minMd;
              const lo = minMd + span * (interval / 3);
              const hi = minMd + span * ((interval + 1) / 3);
              const slice = pts.filter((p) => p.md >= lo && p.md < hi);
              if (slice.length === 0) return { id: s.item.well.well_id, label: wellLabel(s.item), value: null, isRef: s.item.well.well_id === reference?.well.well_id, color: colorFor(s.item.well.well_id) };
              const val = slice.reduce((sum, p) => sum + p.rop, 0) / slice.length;
              return { id: s.item.well.well_id, label: wellLabel(s.item), value: val, isRef: s.item.well.well_id === reference?.well.well_id, color: colorFor(s.item.well.well_id) };
            });

          const INTERVAL_LABELS = ["Shallow third", "Middle third", "Deep third"] as const;

          return (
            <div className="wcp-rank">
              {/* Average ROP — original section */}
              <p className="wcp-rank-section-title" style={{ marginTop: 0 }}>Average ROP</p>
              {toRows((s) => s.avg)
                .slice()
                .sort((a, b) => {
                  if (a.value === null && b.value === null) return 0;
                  if (a.value === null) return 1;
                  if (b.value === null) return -1;
                  return b.value - a.value;
                })
                .map((row) => {
                  const maxVal = Math.max(1, ...toRows((s) => s.avg).flatMap((r) => r.value !== null ? [r.value] : []));
                  return (
                    <div className="wcp-rank-row" key={row.id} style={{ "--wcp-color": row.color } as CssVars}>
                      <span className={`wcp-rank-label${row.isRef ? " wcp-rank-label-ref" : ""}`}>
                        {row.label}{row.isRef && <span className="wcp-rank-ref-tag">ref</span>}
                      </span>
                      {row.value !== null ? (
                        <>
                          <div className="wcp-rank-track"><div className="wcp-rank-bar" style={{ width: `${(row.value / maxVal) * 100}%` }} /></div>
                          <span className="wcp-rank-value">{formatNumber(row.value)} m/h</span>
                        </>
                      ) : (
                        <>
                          <div className="wcp-rank-track" />
                          <span className="wcp-rank-value wcp-rank-na">Unavailable</span>
                        </>
                      )}
                    </div>
                  );
                })}

              {/* Median ROP */}
              <RankSection title="Median ROP" unit="m/h" rows={toRows((s) => s.med)} />

              {/* Max ROP */}
              <RankSection title="Max ROP" unit="m/h" rows={toRows((s) => s.max)} />

              {/* ROP by depth interval */}
              <div className="wcp-rank-section">
                <p className="wcp-rank-section-title">ROP by depth interval</p>
                {([0, 1, 2] as const).map((interval) => (
                  <div key={interval} className="wcp-rank-interval-group">
                    <span className="wcp-rank-interval-label">{INTERVAL_LABELS[interval]}</span>
                    {intervalRows(interval)
                      .slice()
                      .sort((a, b) => {
                        if (a.value === null && b.value === null) return 0;
                        if (a.value === null) return 1;
                        if (b.value === null) return -1;
                        return b.value - a.value;
                      })
                      .map((row) => {
                        const maxVal = Math.max(1, ...intervalRows(interval).flatMap((r) => r.value !== null ? [r.value] : []));
                        return (
                          <div className="wcp-rank-row" key={row.id} style={{ "--wcp-color": row.color } as CssVars}>
                            <span className={`wcp-rank-label${row.isRef ? " wcp-rank-label-ref" : ""}`}>
                              {row.label}{row.isRef && <span className="wcp-rank-ref-tag">ref</span>}
                            </span>
                            {row.value !== null ? (
                              <>
                                <div className="wcp-rank-track"><div className="wcp-rank-bar" style={{ width: `${(row.value / maxVal) * 100}%` }} /></div>
                                <span className="wcp-rank-value">{formatNumber(row.value)} m/h</span>
                              </>
                            ) : (
                              <>
                                <div className="wcp-rank-track" />
                                <span className="wcp-rank-value wcp-rank-na">Unavailable</span>
                              </>
                            )}
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </article>

      <article className="wcp-panel-card wcp-span-4">
        <PanelHeading title="Data availability" detail="Sample coverage by channel" />
        {chartWells.length ? (() => {
          // Only show channels that have at least one finite sample in at least one well
          const activeChannels = (CHANNEL_COLUMNS as readonly ColEntry[]).filter((col) =>
            chartWells.some((item) =>
              item.timeseries.some((row) => {
                const v = (row as unknown as Record<string, unknown>)[col.key];
                return typeof v === "number" && Number.isFinite(v);
              })
            )
          );
          if (!activeChannels.length) return <EmptyPanel text="No channel data available for selected wells." />;

          // Per-well, per-channel: populated count and percentage
          type CellData = { populated: number; total: number; percentage: number | null; hasAny: boolean };
          const cellData: Record<string, Record<string, CellData>> = {};
          for (const item of chartWells) {
            cellData[item.well.well_id] = {};
            const total = item.timeseries.length;
            for (const channel of activeChannels) {
              const populated = item.timeseries.reduce((count, row) => {
                const v = (row as unknown as Record<string, unknown>)[channel.key];
                return count + (typeof v === "number" && Number.isFinite(v) ? 1 : 0);
              }, 0);
              const hasAny = total > 0 && populated > 0;
              const percentage = total > 0 ? (populated / total) * 100 : null;
              const wellCells = cellData[item.well.well_id];
              if (wellCells !== undefined) {
                wellCells[channel.key] = { populated, total, percentage, hasAny };
              }
            }
          }

          // Overall coverage per well: mean of per-channel percentages (only channels with hasAny)
          const overallPct: Record<string, number | null> = {};
          for (const item of chartWells) {
            const pcts = activeChannels.flatMap((ch) => {
              const d = cellData[item.well.well_id]?.[ch.key];
              return d !== undefined && d.hasAny && d.percentage !== null ? [d.percentage] : [];
            });
            overallPct[item.well.well_id] = pcts.length > 0
              ? pcts.reduce((s, v) => s + v, 0) / pcts.length
              : null;
          }

          function fillClass(d: CellData): string {
            if (!d.hasAny) return "wcp-heat-none";
            if (d.percentage !== null && d.percentage >= 80) return "wcp-heat-high";
            if (d.percentage !== null && d.percentage >= 40) return "wcp-heat-mid";
            return "wcp-heat-low";
          }

          function fmtCount(n: number): string {
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`;
            if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
            return String(n);
          }

          return <div className="wcp-heatmap-scroll"><table className="wcp-heatmap">
            <thead><tr><th>Channel</th>{chartWells.map((item) => <th key={item.well.well_id}>{wellLabel(item)}</th>)}</tr></thead>
            <tbody>
              {activeChannels.map((channel) => <tr key={channel.key}><th scope="row">{channel.label}</th>{chartWells.map((item) => {
                const d = cellData[item.well.well_id]?.[channel.key];
                if (d === undefined || !d.hasAny) {
                  const cellKey = `${item.well.well_id}:${channel.key}`;
                  return <td key={cellKey}><span className="wcp-heat-cell wcp-heat-none">Unavailable</span></td>;
                }
                const fc = fillClass(d);
                const cellKey = `${item.well.well_id}:${channel.key}`;
                return <td key={cellKey}><button className={`wcp-heat-cell ${fc}`} onClick={() => setSelectedChannel(selectedChannel === cellKey ? null : cellKey)} type="button" title={`Source column: ${channel.source}`}>
                  {d.percentage !== null ? `${formatNumber(d.percentage, 0)}%` : "Unavailable"}
                  <span className="wcp-heat-count">{fmtCount(d.populated)} samples</span>
                </button></td>;
              })}</tr>)}
              {/* Overall coverage row */}
              <tr className="wcp-heat-overall"><th scope="row">Overall</th>{chartWells.map((item) => {
                const pct = overallPct[item.well.well_id] ?? null;
                const fc = pct === null ? "wcp-heat-none" : pct >= 80 ? "wcp-heat-high" : pct >= 40 ? "wcp-heat-mid" : "wcp-heat-low";
                return <td key={item.well.well_id}>
                  {pct !== null
                    ? <span className={`wcp-heat-cell ${fc}`}>{formatNumber(pct, 0)}%</span>
                    : <span className="wcp-heat-cell wcp-heat-none">Unavailable</span>}
                </td>;
              })}</tr>
            </tbody>
          </table></div>;
        })() : <EmptyPanel text="Select at least one well to inspect channel availability." />}
        {selectedChannel && <p className="wcp-source-note">Source column: <code>{(CHANNEL_COLUMNS as readonly ColEntry[]).find((col) => selectedChannel.endsWith(`:${col.key}`))?.source ?? "Unavailable"}</code></p>}
      </article>
    </div>

    <div className="wcp-dashboard-grid wcp-grid-two">
      <article className="wcp-panel-card wcp-span-7">
        <PanelHeading title="Well comparison" detail={reference ? `Delta vs ${wellLabel(reference)}` : "Reference unavailable"} />
        <div className="wcp-table-scroll"><table className="wcp-table">
          <thead><tr><th scope="col">Metric</th>{selected.map((item) => <th scope="col" key={item.well.well_id}>{wellLabel(item)}{item.well.well_id === reference?.well.well_id && <span className="wcp-reference-tag">Reference</span>}</th>)}</tr></thead>
          <tbody>{GROUPS.map((group) => <FragmentGroup key={group} group={group} metrics={metrics} selected={selected} reference={reference} expandedMetric={expandedMetric} setExpandedMetric={setExpandedMetric} />)}</tbody>
        </table></div>
      </article>

      <article className="wcp-panel-card wcp-span-5">
        <PanelHeading title="Events" detail="Count by type · latest reference events" />
        {eventTypes.length ? <div className="wcp-event-chart" onMouseLeave={() => setChartHover(null, null)}>
          {eventTypes.map((type) => <div className="wcp-event-row" key={type}>
            <span className="wcp-event-type">{type}</span>
            <div className="wcp-event-bars">{chartWells.map((item) => {
              const count = item.events.filter((event) => eventType(event) === type).length;
              return <span className="wcp-event-bar-line" key={item.well.well_id} onMouseEnter={() => {
                setChartHover("events", { x: 0, y: 0, md: count, value: count, wellId: item.well.well_id });
              }}>
                <i style={{ "--wcp-color": colorFor(item.well.well_id), width: `${(count / maxEventCount) * 100}%` } as CssVars} />
              </span>;
            })}</div>
          </div>)}
          {hoveredChart === "events" && hoveredPoint && <ChartTip>{wellLabel(wells.find((item) => item.well.well_id === hoveredPoint.wellId) ?? chartWells[0] as WellCompareSummary)} · {formatNumber(hoveredPoint.value, 0)} events</ChartTip>}
          <Legend wells={selectable} colorFor={colorFor} visibility={visibility} onToggle={toggleVisibility} />
        </div> : <EmptyPanel text="No events recorded for selected wells." />}
        <div className="wcp-latest-list">
          <span className="wcp-small-title">Latest events · {reference ? wellLabel(reference) : "Unavailable"}</span>
          {latestEvents.length ? latestEvents.map((event) => <div className="wcp-latest-event" key={event.event_id}>
            <span>{eventType(event)}</span><time>{event.start_time ?? "Unavailable"}</time><small>{event.start_md === null ? "Unavailable" : `${formatNumber(event.start_md, 0)} m MD`}</small>
          </div>) : <p className="wcp-empty-inline">No events recorded for this well.</p>}
        </div>
      </article>
    </div>

    <footer className="wcp-footer">Heuristic decision-support indicator, not a validated safety system.</footer>
  </section>;
}

// ── RankSection: reusable bar section used by the Ranking panel ──────────────

interface RankRow {
  id: string;
  label: string;
  value: number | null;
  isRef: boolean;
  color: string;
}

function RankSection({
  title,
  unit,
  rows,
}: {
  title: string;
  unit: string;
  rows: RankRow[];
}) {
  const sorted = rows.slice().sort((a, b) => {
    if (a.value === null && b.value === null) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return b.value - a.value;
  });
  const maxVal = Math.max(1, ...sorted.flatMap((r) => r.value !== null ? [r.value] : []));
  return (
    <div className="wcp-rank-section">
      <p className="wcp-rank-section-title">{title}</p>
      {sorted.map((row) => (
        <div className="wcp-rank-row" key={row.id} style={{ "--wcp-color": row.color } as CSSProperties & { [key: `--${string}`]: string }}>
          <span className={`wcp-rank-label${row.isRef ? " wcp-rank-label-ref" : ""}`}>
            {row.label}{row.isRef && <span className="wcp-rank-ref-tag">ref</span>}
          </span>
          {row.value !== null ? (
            <>
              <div className="wcp-rank-track">
                <div className="wcp-rank-bar" style={{ width: `${(row.value / maxVal) * 100}%` }} />
              </div>
              <span className="wcp-rank-value">{row.value.toLocaleString("en-US", { maximumFractionDigits: 1 })} {unit}</span>
            </>
          ) : (
            <>
              <div className="wcp-rank-track" />
              <span className="wcp-rank-value wcp-rank-na">Unavailable</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return <article className={`wcp-kpi-card wcp-kpi-${color}`}><span>{label}</span><strong>{value}</strong></article>;
}

function EmptyPanel({ text }: { text: string }) {
  return <div className="wcp-empty-panel">{text}</div>;
}

function Legend({
  wells,
  colorFor,
  visibility,
  onToggle,
}: {
  wells: WellCompareSummary[];
  colorFor: (wellId: string) => string;
  visibility: Record<string, boolean>;
  onToggle: (wellId: string) => void;
}) {
  return <div className="wcp-legend">{wells.map((item) => <button
    className={visibility[item.well.well_id] === false ? "wcp-legend-item wcp-legend-hidden" : "wcp-legend-item"}
    key={item.well.well_id}
    onClick={() => onToggle(item.well.well_id)}
    type="button"
  ><i style={{ "--wcp-color": colorFor(item.well.well_id) } as CssVars} />{wellLabel(item)}</button>)}</div>;
}

// Metric keys whose values are text — no diff or best-value highlight.
const TEXT_METRIC_KEYS = new Set(["well-name", "field", "operator", "spud-date"]);

// For these keys, a LOWER value is better.
const LOWER_IS_BETTER = new Set(["total-depth", "max-inclination", "max-dogleg", "event-count"]);
// For these keys, a HIGHER value is better.
const HIGHER_IS_BETTER = new Set(["rop", "avg-rop"]);
// Keys that map to ROP or duration in the metric list (matched by key prefix).
function diffDirection(key: string): "neutral" | "lower-better" | "higher-better" {
  if (key === "drilling-duration" || key === "active-time") return "lower-better";
  if (key.startsWith("rop") || key === "avg-rop") return "higher-better";
  if (LOWER_IS_BETTER.has(key)) return "lower-better";
  if (HIGHER_IS_BETTER.has(key)) return "higher-better";
  return "neutral";
}

function FragmentGroup({
  group,
  metrics,
  selected,
  reference,
  expandedMetric,
  setExpandedMetric,
}: {
  group: ComparisonMetric["group"];
  metrics: ComparisonMetric[];
  selected: WellCompareSummary[];
  reference: WellCompareSummary | null;
  expandedMetric: string | null;
  setExpandedMetric: (key: string | null) => void;
}) {
  const inGroup = metrics.filter((metric) => metric.group === group);
  if (!inGroup.length) return null;
  return <>
    <tr className="wcp-group-row"><th colSpan={selected.length + 1} scope="colgroup">{group}</th></tr>
    {inGroup.map((metric) => {
      const isText = TEXT_METRIC_KEYS.has(metric.key);
      const direction = diffDirection(metric.key);

      // Find best numeric value for highlight
      const numericValues = selected.flatMap((item) => {
        const v = metric.values[item.well.well_id] ?? null;
        return typeof v === "number" && Number.isFinite(v) ? [{ id: item.well.well_id, v }] : [];
      });
      let bestId: string | null = null;
      if (!isText && numericValues.length > 1) {
        const best = numericValues.reduce((a, b) => {
          if (direction === "lower-better") return b.v < a.v ? b : a;
          if (direction === "higher-better") return b.v > a.v ? b : a;
          return a; // neutral: first (reference) is baseline
        });
        bestId = best.id;
      }

      return <tr key={metric.key}>
        <th scope="row">
          <button className="wcp-metric-toggle" onClick={() => setExpandedMetric(expandedMetric === metric.key ? null : metric.key)} type="button" aria-expanded={expandedMetric === metric.key}>
            {metric.label}<span className="wcp-expand-mark">{expandedMetric === metric.key ? "−" : "+"}</span>
          </button>
          {expandedMetric === metric.key && <p className="wcp-explanation">{metric.explanation}</p>}
        </th>
        {selected.map((item) => {
          const value = metric.values[item.well.well_id] ?? null;
          const referenceValue = reference ? metric.values[reference.well.well_id] ?? null : null;
          const isReference = item.well.well_id === reference?.well.well_id;
          const isBest = item.well.well_id === bestId;

          if (isText || isReference) {
            return <td key={item.well.well_id} className={isBest ? "wcp-cell-best" : undefined}>
              <span>{formatValue(value, metric.unit)}</span>
              {isReference && <span className="wcp-difference">Reference</span>}
            </td>;
          }

          // Compute delta and colour
          const delta = difference(value, referenceValue, metric.unit);
          let deltaClass = "wcp-diff-neutral";
          if (delta !== null && delta !== `0${metric.unit ? ` ${metric.unit}` : ""}`) {
            const positive = delta.startsWith("+");
            if (direction === "higher-better") deltaClass = positive ? "wcp-diff-better" : "wcp-diff-worse";
            else if (direction === "lower-better") deltaClass = positive ? "wcp-diff-worse" : "wcp-diff-better";
            // neutral: always grey
          }

          return <td key={item.well.well_id} className={isBest ? "wcp-cell-best" : undefined}>
            <span>{formatValue(value, metric.unit)}</span>
            {delta !== null && <span className={`wcp-difference ${deltaClass}`}>{delta}</span>}
          </td>;
        })}
      </tr>;
    })}
  </>;
}
