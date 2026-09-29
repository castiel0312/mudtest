import type { TimeseriesRow, Well } from "../../api/types";

export interface WellHeaderProps {
  wells: Well[];
  selectedWellId: string;
  onWellChange: (wellId: string) => void;
  latestSample: Partial<Record<keyof TimeseriesRow, TimeseriesRow>>;
  loading: boolean;
}

interface KpiDefinition {
  label: string;
  value: string;
}

function finiteNumber(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function format(value: number | null, unit: string): string {
  if (value === null) return "Unavailable";
  const formatted = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function wellName(well: Well): string {
  return well.well_name ?? well.well_id;
}

export function WellHeader({ wells, selectedWellId, onWellChange, latestSample, loading }: WellHeaderProps) {
  const well = wells.find((item) => item.well_id === selectedWellId) ?? null;
  const rigState = latestSample.rig_state?.rig_state?.trim() ?? "";
  const kpis: KpiDefinition[] = [
    { label: "Well name", value: well ? wellName(well) : "Unavailable" },
    { label: "Well status", value: rigState || "Unavailable" },
    { label: "Current depth", value: format(finiteNumber(latestSample.md?.md), "m") },
    { label: "Current formation", value: latestSample.formation?.formation ?? "Unavailable" },
    { label: "ROP", value: format(finiteNumber(latestSample.rop?.rop), "m/hr") },
    { label: "WOB", value: format(finiteNumber(latestSample.wob?.wob), "kN") },
    { label: "Torque", value: format(finiteNumber(latestSample.torque?.torque), "kN·m") },
    { label: "ECD", value: format(finiteNumber(latestSample.ecd?.ecd), "SG") },
    { label: "Mud weight", value: format(finiteNumber(latestSample.mud_weight?.mud_weight), "SG") },
  ];
  const statusClass = rigState ? "nd-status-dot nd-status-reported" : "nd-status-dot nd-status-unavailable";

  return <section className="nd-well-header" aria-label="Selected well summary">
    <div className="nd-well-select-row">
      <div className="nd-selected-well">
        <span className={statusClass} aria-label={rigState ? `Reported rig state: ${rigState}` : "Well status unavailable"} />
        <label htmlFor="nd-well-select">Selected well</label>
        <select id="nd-well-select" value={selectedWellId} onChange={(event) => onWellChange(event.target.value)} disabled={loading || wells.length === 0}>
          {wells.map((item) => <option key={item.well_id} value={item.well_id}>{wellName(item)}</option>)}
        </select>
      </div>
      {well && <div className="nd-well-identifiers">
        <span>{wellName(well)}</span>
        <small>{well.operator ?? "Operator unavailable"}{well.field ? ` · ${well.field}` : ""}</small>
      </div>}
    </div>
    <div className="nd-well-kpis">
      {kpis.map((kpi) => <article className="nd-well-kpi" key={kpi.label}>
        <span>{kpi.label}</span>
        <strong>{loading ? "Loading…" : kpi.value}</strong>
      </article>)}
    </div>
  </section>;
}
