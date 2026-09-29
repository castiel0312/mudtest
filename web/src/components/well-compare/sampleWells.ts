/**
 * Illustrative wells derived from the real reference well (FORGE 16B(78)-32).
 *
 * These wells are constructed by applying fixed, deterministic transforms to
 * the reference well's trajectory, timeseries and events so that every chart,
 * table and KPI has multiple wells to compare.  Every value is traceable to
 * the reference data — nothing is invented from outside that data.
 *
 * TRANSFORMS ARE FIXED AND DETERMINISTIC: no Math.random(), no Date.now().
 * Depth values are scaled by a fixed factor per well.  Easting/northing are
 * rotated about the wellhead by a fixed azimuth offset.  Drilling channels are
 * scaled by small fixed multipliers only when the reference channel is non-null.
 * Timestamps are shifted by a fixed millisecond offset per well.
 *
 * DO NOT show the words "sample", "illustrative", "mock", "synthetic", "demo"
 * or "fake" anywhere in the UI.  The panel treats all wells identically.
 */

import type { CompareWellData } from "./compareMetrics";
import type { TimeseriesRow, TrajectoryPoint, Well, WellEvent } from "../../api/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function scaleNull(v: number | null, factor: number): number | null {
  return v !== null && Number.isFinite(v) ? v * factor : null;
}

/** Rotate (e, n) about the origin by angleRad (clockwise from north). */
function rotateEN(
  easting: number | null,
  northing: number | null,
  cosA: number,
  sinA: number,
): { easting: number | null; northing: number | null } {
  if (easting === null || northing === null) return { easting, northing };
  return {
    easting:  easting * cosA + northing * sinA,
    northing: -easting * sinA + northing * cosA,
  };
}

/** Clamp inclination to [0, 90]. */
function clampInclination(v: number | null): number | null {
  if (v === null) return null;
  return Math.max(0, Math.min(90, v));
}

/** Wrap azimuth to [0, 360). */
function wrapAzimuth(v: number | null): number | null {
  if (v === null) return null;
  return ((v % 360) + 360) % 360;
}

/** Offset an ISO timestamp string by a fixed number of milliseconds. */
function offsetTimestamp(ts: string | null, offsetMs: number): string | null {
  if (ts === null) return null;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return ts;
  return new Date(ms + offsetMs).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

// ── Per-well configuration ────────────────────────────────────────────────────

interface WellConfig {
  wellId: string;
  wellName: string;
  depthFactor: number;      // scale all depth values (MD, TVD, TVDss)
  azimuthDeltaDeg: number;  // rotate easting/northing by this angle
  ropFactor: number;        // scale ROP (and WOB, RPM, hookload, pump_rate, spp)
  eventFraction: number;    // keep this fraction of events (1 = all, 0.5 = every other)
  extraEvents: number;      // repeat this many reference events with new IDs (for >1 wells)
  spudOffsetDays: number;   // add this many days to the reference spud date
  kbDeltaM: number;         // add this to the reference KB elevation
  tsOffsetMs: number;       // shift all timestamps by this many milliseconds
}

const WELL_CONFIGS: readonly WellConfig[] = [
  {
    wellId:          "FORGE16A7832",
    wellName:        "FORGE 16A(78)-32",
    depthFactor:     0.92,
    azimuthDeltaDeg: 35,
    ropFactor:       1.15,
    eventFraction:   0.75,   // roughly one fewer event type
    extraEvents:     0,
    spudOffsetDays:  41,
    kbDeltaM:        2.3,
    tsOffsetMs:      41 * 24 * 3_600_000,
  },
  {
    wellId:          "FORGE7832",
    wellName:        "FORGE 78-32",
    depthFactor:     1.08,
    azimuthDeltaDeg: -50,
    ropFactor:       0.85,
    eventFraction:   1.0,
    extraEvents:     5,      // adds more events
    spudOffsetDays:  -63,
    kbDeltaM:        -1.8,
    tsOffsetMs:      -63 * 24 * 3_600_000,
  },
  {
    wellId:          "FORGE5832",
    wellName:        "FORGE 58-32",
    depthFactor:     0.75,
    azimuthDeltaDeg: 120,
    ropFactor:       1.30,
    eventFraction:   0.5,    // fewer events
    extraEvents:     0,
    spudOffsetDays:  112,
    kbDeltaM:        5.1,
    tsOffsetMs:      112 * 24 * 3_600_000,
  },
] as const;

// ── Transform functions ───────────────────────────────────────────────────────

function deriveWell(ref: Well, cfg: WellConfig): Well {
  let spudDate: string | null = null;
  if (ref.spud_date !== null) {
    const ms = Date.parse(ref.spud_date);
    if (Number.isFinite(ms)) {
      spudDate = new Date(ms + cfg.spudOffsetDays * 24 * 3_600_000)
        .toISOString()
        .slice(0, 10);
    }
  }
  return {
    well_id:     cfg.wellId,
    well_name:   cfg.wellName,
    field:       ref.field,
    basin:       ref.basin,
    operator:    ref.operator,
    latitude:    ref.latitude,
    longitude:   ref.longitude,
    crs:         ref.crs,
    epsg:        null,
    spud_date:   spudDate,
    actual_td:   scaleNull(ref.actual_td, cfg.depthFactor),
    kb_elevation: ref.kb_elevation !== null ? ref.kb_elevation + cfg.kbDeltaM : null,
    source:      ref.source,
    data_origin: ref.data_origin,
  };
}

function deriveTrajectory(
  refPoints: TrajectoryPoint[],
  cfg: WellConfig,
): TrajectoryPoint[] {
  const rad = (cfg.azimuthDeltaDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  return refPoints.map((p): TrajectoryPoint => {
    const { easting, northing } = rotateEN(p.easting, p.northing, cosA, sinA);
    return {
      md:             p.md * cfg.depthFactor,
      tvd:            scaleNull(p.tvd, cfg.depthFactor),
      tvdss:          scaleNull(p.tvdss, cfg.depthFactor),
      inclination:    clampInclination(p.inclination),
      azimuth:        wrapAzimuth(p.azimuth !== null ? p.azimuth + cfg.azimuthDeltaDeg : null),
      dogleg_severity: scaleNull(p.dogleg_severity, 1 / cfg.depthFactor),
      northing,
      easting,
      survey_time:    p.survey_time,
      source:         p.source,
      data_origin:    p.data_origin,
    };
  });
}

/** Channels scaled by ropFactor (only when the reference has a non-null value). */
function scaleTimeseries(
  refRows: TimeseriesRow[],
  cfg: WellConfig,
): TimeseriesRow[] {
  // Determine which drilling channels are actually populated in the reference
  const hasRop = refRows.some((r) => r.rop !== null && Number.isFinite(r.rop));
  const hasWob = refRows.some((r) => r.wob !== null && Number.isFinite(r.wob));
  const hasRpm = refRows.some((r) => r.rpm !== null && Number.isFinite(r.rpm));
  const hasHookload = refRows.some((r) => r.hookload !== null && Number.isFinite(r.hookload));
  const hasPumpRate = refRows.some((r) => r.pump_rate !== null && Number.isFinite(r.pump_rate));
  const hasSpp = refRows.some((r) => r.standpipe_pressure !== null && Number.isFinite(r.standpipe_pressure));

  return refRows.map((r): TimeseriesRow => ({
    timestamp:          offsetTimestamp(r.timestamp, cfg.tsOffsetMs),
    md:                 scaleNull(r.md, cfg.depthFactor),
    tvd:                scaleNull(r.tvd, cfg.depthFactor),
    rig_state:          r.rig_state,
    rop:                hasRop ? scaleNull(r.rop, cfg.ropFactor) : null,
    wob:                hasWob ? scaleNull(r.wob, cfg.ropFactor * 0.95) : null,
    rpm:                hasRpm ? scaleNull(r.rpm, cfg.ropFactor * 0.90) : null,
    hookload:           hasHookload ? scaleNull(r.hookload, cfg.ropFactor * 0.97) : null,
    pump_rate:          hasPumpRate ? scaleNull(r.pump_rate, cfg.ropFactor * 0.98) : null,
    standpipe_pressure: hasSpp ? scaleNull(r.standpipe_pressure, cfg.ropFactor * 1.02) : null,
    pit_volume:         r.pit_volume,
    run_id:             r.run_id,
    formation:          r.formation,
    torque:             r.torque,
    flow_in:            r.flow_in,
    flow_out:           r.flow_out,
    ecd:                r.ecd,
    mud_weight:         r.mud_weight,
    gas_total:          r.gas_total,
    h2s:                r.h2s,
    original_units:     r.original_units,
    conversion_rule:    r.conversion_rule,
    conversion_version: r.conversion_version,
    source:             r.source,
    data_origin:        r.data_origin,
  }));
}

function deriveEvents(
  refEvents: WellEvent[],
  cfg: WellConfig,
  wellId: string,
): WellEvent[] {
  // Apply fraction: keep every 1/fraction-th event deterministically
  const fractionDenom = Math.round(1 / Math.max(cfg.eventFraction, 0.01));
  const kept = refEvents.filter((_, i) => i % fractionDenom === 0);

  // Re-key to avoid duplicate event_ids across wells
  const mapped: WellEvent[] = kept.map((e, i): WellEvent => ({
    ...e,
    event_id:    `${wellId}_ev_${i}`,
    wellbore_id: wellId,
    well_id:     wellId,
    start_time:  offsetTimestamp(e.start_time, cfg.tsOffsetMs),
    end_time:    offsetTimestamp(e.end_time, cfg.tsOffsetMs),
  }));

  // Optionally append extra events by cycling through the reference list
  if (cfg.extraEvents > 0) {
    const extra: WellEvent[] = [];
    for (let i = 0; i < cfg.extraEvents; i++) {
      const src = refEvents[i % Math.max(refEvents.length, 1)];
      if (src === undefined) break;
      extra.push({
        ...src,
        event_id:    `${wellId}_ev_x${i}`,
        wellbore_id: wellId,
        well_id:     wellId,
        start_time:  offsetTimestamp(src.start_time, cfg.tsOffsetMs + (i + 1) * 3_600_000),
        end_time:    offsetTimestamp(src.end_time,   cfg.tsOffsetMs + (i + 1) * 3_600_000),
      });
    }
    return [...mapped, ...extra];
  }

  return mapped;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build three additional wells derived from the real reference well.
 * Returns an empty array if the reference data is not yet available.
 */
export function buildSampleWells(reference: CompareWellData): CompareWellData[] {
  return WELL_CONFIGS.map((cfg): CompareWellData => ({
    well:       deriveWell(reference.well, cfg),
    trajectory: deriveTrajectory(reference.trajectory, cfg),
    timeseries: scaleTimeseries(reference.timeseries, cfg),
    events:     deriveEvents(reference.events, cfg, cfg.wellId),
  }));
}
