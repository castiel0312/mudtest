import type { TimeseriesRow, TrajectoryPoint, Well, WellEvent } from "../../api/types";

export interface CompareWellData {
  well: Well;
  trajectory: TrajectoryPoint[];
  events: WellEvent[];
  timeseries: TimeseriesRow[];
}

export type MetricValue = number | string | null;

export interface ComparisonMetric {
  key: string;
  label: string;
  group: "Well details" | "Trajectory" | "Events" | "Data availability";
  unit: string;
  explanation: string;
  values: Record<string, MetricValue>;
}

export interface ChannelAvailability {
  populated: string[];
  empty: string[];
}

export const CHANNELS = [
  { key: "gas_total", label: "Gas" },
  { key: "h2s", label: "H2S" },
  { key: "flow_in", label: "Flow in" },
  { key: "flow_out", label: "Flow out" },
  { key: "ecd", label: "ECD" },
  { key: "mud_weight", label: "Mud weight" },
  { key: "torque", label: "Torque" },
  { key: "rop", label: "ROP" },
  { key: "wob", label: "WOB" },
  { key: "rpm", label: "RPM" },
  { key: "hookload", label: "Hookload" },
  { key: "standpipe_pressure", label: "Standpipe pressure" },
  { key: "pump_rate", label: "Pump rate" },
  { key: "pit_volume", label: "Pit volume" },
] as const;

const finite = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value);

const maximum = (values: Array<number | null | undefined>): number | null => {
  const valid = values.filter(finite);
  return valid.length ? Math.max(...valid) : null;
};

export function totalDepth(data: CompareWellData): number | null {
  const measured = maximum(data.trajectory.map((point) => point.md));
  return measured ?? data.well.actual_td;
}

export function channelAvailability(rows: TimeseriesRow[]): ChannelAvailability {
  const populated: string[] = [];
  const empty: string[] = [];
  for (const channel of CHANNELS) {
    if (rows.some((row) => finite(row[channel.key]))) populated.push(channel.label);
    else empty.push(channel.label);
  }
  return { populated, empty };
}

export function computeMetrics(data: CompareWellData[]): ComparisonMetric[] {
  const make = (
    key: string,
    label: string,
    group: ComparisonMetric["group"],
    unit: string,
    explanation: string,
    value: (item: CompareWellData) => MetricValue,
  ): ComparisonMetric => ({
    key,
    label,
    group,
    unit,
    explanation,
    values: Object.fromEntries(data.map((item) => [item.well.well_id, value(item)])),
  });

  const metrics: ComparisonMetric[] = [
    make("well-name", "Well", "Well details", "", "Name reported by the well record; falls back to the source well ID when no name is reported.", (item) => item.well.well_name ?? item.well.well_id),
    make("field", "Field", "Well details", "", "Field name reported in the well record.", (item) => item.well.field),
    make("operator", "Operator", "Well details", "", "Operator reported in the well record.", (item) => item.well.operator),
    make("spud-date", "Spud date", "Well details", "", "Spud date reported in the well record; no date is inferred.", (item) => item.well.spud_date),
    make("kb-elevation", "KB elevation", "Well details", "m", "Kelly bushing elevation from the well record, in the source-reported units.", (item) => item.well.kb_elevation),
    make("total-depth", "Total depth (MD)", "Trajectory", "m", "Maximum measured depth in the trajectory survey; falls back to actual TD from the well record only when the survey has no MD.", totalDepth),
    make("max-tvd", "Max TVD", "Trajectory", "m", "Maximum finite TVD among trajectory survey points.", (item) => maximum(item.trajectory.map((point) => point.tvd))),
    make("max-inclination", "Max inclination", "Trajectory", "°", "Maximum finite inclination among trajectory survey points.", (item) => maximum(item.trajectory.map((point) => point.inclination))),
    make("max-dogleg", "Max dogleg severity", "Trajectory", "°/30 m", "Maximum finite dogleg severity among trajectory survey points.", (item) => maximum(item.trajectory.map((point) => point.dogleg_severity))),
    make("horizontal-displacement", "Horizontal displacement", "Trajectory", "m", "Largest radial displacement from the first survey point using northing/easting differences. Requires both coordinates at the reference and measured point.", (item) => {
      const origin = item.trajectory.find((point) => point.northing !== null && point.easting !== null);
      if (!origin || origin.northing === null || origin.easting === null) return null;
      const originNorthing = origin.northing;
      const originEasting = origin.easting;
      const distances = item.trajectory.flatMap((point) => point.northing !== null && point.easting !== null
        ? [Math.hypot(point.northing - originNorthing, point.easting - originEasting)]
        : []);
      return maximum(distances);
    }),
    make("event-count", "Event count", "Events", "", "Total number of events returned for the well.", (item) => item.events.length),
  ];

  for (const type of [...new Set(data.flatMap((item) => item.events.map((event) => event.event_subtype ?? event.event_type)))].sort()) {
    metrics.push(make(`event-${type}`, type, "Events", "", `Count of events where event subtype is “${type}”, falling back to event type when subtype is absent.`, (item) => item.events.filter((event) => (event.event_subtype ?? event.event_type) === type).length));
  }

  metrics.push(
    make("populated-channels", "Populated channels", "Data availability", "", "Channels with at least one finite numeric sample in the light timeseries response (up to 20,000 rows).", (item) => {
      const channels = channelAvailability(item.timeseries).populated;
      return channels.length ? channels.join(", ") : null;
    }),
    make("empty-channels", "Empty channels", "Data availability", "", "Channels with no finite numeric sample in the light timeseries response (up to 20,000 rows). This means unavailable in the sampled response, not necessarily absent from every unsampled record.", (item) => {
      const channels = channelAvailability(item.timeseries).empty;
      return channels.length ? channels.join(", ") : null;
    }),
  );
  return metrics;
}
