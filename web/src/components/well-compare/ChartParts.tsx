import type { CSSProperties, ReactNode } from "react";
import type { WellCompareSummary } from "./useWellCompareData";
import { wellLabel } from "./chartUtils";

type CssVars = CSSProperties & { [key: `--${string}`]: string | number };


export function DashboardLegend({
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

export function DashboardPanelHeading({ title, detail }: { title: string; detail?: string }) {
  return <div className="wcp-panel-heading"><h2>{title}</h2>{detail && <span>{detail}</span>}</div>;
}

export function EmptyChart({ text }: { text: string }) {
  return <div className="wcp-empty-panel">{text}</div>;
}

export function ChartTooltip({ children }: { children: ReactNode }) {
  return <div className="wcp-tooltip">{children}</div>;
}
