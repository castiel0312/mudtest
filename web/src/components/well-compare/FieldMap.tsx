import { useEffect, useRef, useState } from "react";
import type { WellLocation } from "./wellLocations";
import "./field-map.css";

// ── Constants ────────────────────────────────────────────────────────────────

const TILE_SIZE = 256;
const ZOOM_MIN = 8;
const ZOOM_MAX = 17;
const ACCENT_BLUE = "#2F7BFF";
const OTHER_COLOR = "#F5A623";
const EARTH_RADIUS_M = 6_378_137;

// Candidate scale-bar lengths in metres (round numbers)
const SCALE_CANDIDATES_M = [
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  1_000, 2_000, 5_000,
];

// ── Web Mercator helpers ──────────────────────────────────────────────────────

/** Tile column (may be fractional) for a longitude at zoom z. */
function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}

/** Tile row (may be fractional) for a latitude at zoom z. */
function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) /
    2 *
    Math.pow(2, z)
  );
}

/** Metres per pixel at a given latitude and zoom (standard Web Mercator). */
function meresPerPixel(lat: number, z: number): number {
  return (
    (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * EARTH_RADIUS_M) /
    (Math.pow(2, z) * TILE_SIZE)
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocatedWell {
  name: string;
  lat: number;
  lon: number;
  isReference: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface FieldMapProps {
  wells: WellLocation[];
  referenceName: string;
}

export function FieldMap({ wells, referenceName }: FieldMapProps) {
  // Stage size – measured from the DOM so the tile grid matches the actual CSS size
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(340);
  const [stageH, setStageH] = useState(255);

  useEffect(() => {
    const el = stageRef.current;
    if (el === null) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      if (width > 0) setStageW(Math.round(width));
      if (height > 0) setStageH(Math.round(height));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Separate wells into those with and without coordinates
  const located: LocatedWell[] = wells.flatMap((w) =>
    w.lat !== null && w.lon !== null
      ? [{ name: w.name, lat: w.lat, lon: w.lon, isReference: w.name === referenceName }]
      : [],
  );
  const missingCount = wells.length - located.length;

  // Reference well – used for unavailability check
  const refWell = wells.find((w) => w.name === referenceName);
  const refHasCoords =
    refWell !== undefined && refWell.lat !== null && refWell.lon !== null;

  // ── Auto-zoom: choose zoom so all located wells fit with padding ──────────
  function autoZoom(w: number, h: number): number {
    if (located.length === 0) return 12;
    if (located.length === 1) {
      const only = located[0];
      if (only === undefined) return 12;
      return 15;
    }
    const lats = located.map((p) => p.lat);
    const lons = located.map((p) => p.lon);
    const latMin = Math.min(...lats);
    const latMax = Math.max(...lats);
    const lonMin = Math.min(...lons);
    const lonMax = Math.max(...lons);
    for (let z = ZOOM_MAX; z >= ZOOM_MIN; z--) {
      const x0 = lonToTileX(lonMin, z) * TILE_SIZE;
      const x1 = lonToTileX(lonMax, z) * TILE_SIZE;
      const y0 = latToTileY(latMax, z) * TILE_SIZE; // latMax → smaller y
      const y1 = latToTileY(latMin, z) * TILE_SIZE;
      const spanX = x1 - x0;
      const spanY = y1 - y0;
      const pad = 0.15; // 15% padding each side
      if (spanX <= w * (1 - 2 * pad) && spanY <= h * (1 - 2 * pad)) return z;
    }
    return ZOOM_MIN;
  }

  const [zoom, setZoom] = useState<number>(() => autoZoom(stageW, stageH));

  // Recompute auto-zoom only when located wells change (not on every stage resize,
  // to preserve manual zoom adjustments)
  const locatedKey = located.map((l) => `${l.lat},${l.lon}`).join("|");
  const prevLocatedKey = useRef(locatedKey);
  useEffect(() => {
    if (prevLocatedKey.current !== locatedKey) {
      prevLocatedKey.current = locatedKey;
      setZoom(autoZoom(stageW, stageH));
    }
    // autoZoom is a closure over located/stageW/stageH — intentionally not listed;
    // we only want to reset zoom when the set of well coordinates changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locatedKey]);

  // ── Map centre: bounding-box centre of all located wells ─────────────────
  const centreLat =
    located.length > 0
      ? located.reduce((s, l) => s + l.lat, 0) / located.length
      : 0;
  const centreLon =
    located.length > 0
      ? located.reduce((s, l) => s + l.lon, 0) / located.length
      : 0;

  // Centre tile coords (fractional)
  const centreTileX = lonToTileX(centreLon, zoom);
  const centreTileY = latToTileY(centreLat, zoom);

  // Pixel offset of the top-left corner of the tile grid relative to the stage.
  // We want (centreTileX, centreTileY) to map to (stageW/2, stageH/2).
  const originPxX = stageW / 2 - centreTileX * TILE_SIZE;
  const originPxY = stageH / 2 - centreTileY * TILE_SIZE;

  // ── Tile grid ─────────────────────────────────────────────────────────────
  // Which integer tile columns/rows are visible?
  const tileColMin = Math.floor(-originPxX / TILE_SIZE);
  const tileColMax = Math.ceil((stageW - originPxX) / TILE_SIZE);
  const tileRowMin = Math.floor(-originPxY / TILE_SIZE);
  const tileRowMax = Math.ceil((stageH - originPxY) / TILE_SIZE);

  const maxTile = Math.pow(2, zoom) - 1;

  const tiles: { col: number; row: number; left: number; top: number }[] = [];
  for (let col = tileColMin; col <= tileColMax; col++) {
    for (let row = tileRowMin; row <= tileRowMax; row++) {
      if (row < 0 || row > maxTile) continue;
      // Wrap longitude
      const wrappedCol = ((col % Math.pow(2, zoom)) + Math.pow(2, zoom)) % Math.pow(2, zoom);
      tiles.push({
        col: wrappedCol,
        row,
        left: originPxX + col * TILE_SIZE,
        top: originPxY + row * TILE_SIZE,
      });
    }
  }

  // ── Well SVG coordinates ──────────────────────────────────────────────────
  function wellSvgXY(lat: number, lon: number): { x: number; y: number } {
    const tx = lonToTileX(lon, zoom) * TILE_SIZE;
    const ty = latToTileY(lat, zoom) * TILE_SIZE;
    return { x: originPxX + tx, y: originPxY + ty };
  }

  // ── Scale bar ─────────────────────────────────────────────────────────────
  const mpp = meresPerPixel(centreLat, zoom);
  const scaleBarMaxPx = 80;
  const bestCandidate = SCALE_CANDIDATES_M.filter(
    (m) => m / mpp <= scaleBarMaxPx,
  ).reduce<number | null>((best, m) => (best === null || m > best ? m : best), null);
  const scaleM = bestCandidate ?? SCALE_CANDIDATES_M[0] ?? 1;
  const scalePx = scaleM / mpp;
  const scaleLabel =
    scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`;

  // Scale bar position: bottom-left of stage with padding
  const scaleX1 = 14;
  const scaleX2 = scaleX1 + scalePx;
  const scaleY = stageH - 18;

  // ── North arrow position: top-left ────────────────────────────────────────
  const northX = 22;
  const northY = 32;
  const arrowLen = 13;

  return (
    <div className="wcp-map">
      {/* Stage: tiles + SVG overlay */}
      <div className="wcp-map-stage" ref={stageRef}>
        {refHasCoords ? (
          <>
            {/* Tile layer */}
            {tiles.map(({ col, row, left, top }) => (
              <img
                key={`${zoom}/${row}/${col}`}
                className="wcp-map-tile"
                src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${row}/${col}`}
                alt=""
                loading="lazy"
                width={TILE_SIZE}
                height={TILE_SIZE}
                style={{ left, top }}
                onError={(e) => {
                  // Hide broken tiles; dark background shows through
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ))}

            {/* SVG overlay */}
            <svg
              className="wcp-map-svg"
              viewBox={`0 0 ${stageW} ${stageH}`}
              aria-hidden="true"
            >
              {/* Non-reference wells */}
              {located
                .filter((w) => !w.isReference)
                .map((w) => {
                  const { x, y } = wellSvgXY(w.lat, w.lon);
                  return (
                    <g key={w.name}>
                      <circle
                        className="wcp-map-dot"
                        cx={x}
                        cy={y}
                        r={5}
                        fill={OTHER_COLOR}
                        stroke="#fff"
                        strokeWidth={1.2}
                      />
                      <text
                        className="wcp-map-label"
                        x={x + 7}
                        y={y + 3}
                      >
                        {w.name}
                      </text>
                    </g>
                  );
                })}

              {/* Reference well (drawn on top) */}
              {located
                .filter((w) => w.isReference)
                .map((w) => {
                  const { x, y } = wellSvgXY(w.lat, w.lon);
                  return (
                    <g key={w.name}>
                      {/* Pulsing ring */}
                      <circle
                        className="wcp-map-pulse"
                        cx={x}
                        cy={y}
                        r={7}
                      />
                      <circle
                        className="wcp-map-dot"
                        cx={x}
                        cy={y}
                        r={7}
                        fill={ACCENT_BLUE}
                        stroke="#fff"
                        strokeWidth={1.5}
                      />
                      <text
                        className="wcp-map-label"
                        x={x + 9}
                        y={y + 3}
                        fontWeight="700"
                      >
                        {w.name}
                      </text>
                    </g>
                  );
                })}

              {/* Scale bar */}
              <line
                className="wcp-map-scalebar"
                x1={scaleX1}
                x2={scaleX2}
                y1={scaleY}
                y2={scaleY}
              />
              <line
                className="wcp-map-scalebar"
                x1={scaleX1}
                x2={scaleX1}
                y1={scaleY - 4}
                y2={scaleY + 4}
              />
              <line
                className="wcp-map-scalebar"
                x1={scaleX2}
                x2={scaleX2}
                y1={scaleY - 4}
                y2={scaleY + 4}
              />
              <text
                className="wcp-map-scalelabel"
                x={(scaleX1 + scaleX2) / 2}
                y={scaleY - 6}
                textAnchor="middle"
              >
                {scaleLabel}
              </text>

              {/* North arrow */}
              <line
                className="wcp-map-north"
                x1={northX}
                x2={northX}
                y1={northY}
                y2={northY - arrowLen}
              />
              <path
                className="wcp-map-north"
                d={`M${northX - 4},${northY - arrowLen + 6} L${northX},${northY - arrowLen} L${northX + 4},${northY - arrowLen + 6}`}
                fill="none"
              />
              <text
                className="wcp-map-north-letter"
                x={northX}
                y={northY + 10}
                textAnchor="middle"
              >
                N
              </text>
            </svg>

            {/* Zoom controls */}
            <div className="wcp-map-controls">
              <button
                className="wcp-map-zoom"
                type="button"
                aria-label="Zoom in"
                disabled={zoom >= ZOOM_MAX}
                onClick={() => setZoom((z) => Math.min(z + 1, ZOOM_MAX))}
              >
                +
              </button>
              <button
                className="wcp-map-zoom"
                type="button"
                aria-label="Zoom out"
                disabled={zoom <= ZOOM_MIN}
                onClick={() => setZoom((z) => Math.max(z - 1, ZOOM_MIN))}
              >
                −
              </button>
            </div>

            {/* Attribution */}
            <div className="wcp-map-attribution">
              Imagery: Esri, Maxar, Earthstar Geographics
            </div>
          </>
        ) : (
          /* Reference well has no coordinates */
          <div className="wcp-map-unavailable">
            <strong>Unavailable</strong>
            <small>Add coordinates in wellLocations.ts</small>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="wcp-map-legend">
        <span className="wcp-map-legend-item">
          <span
            className="wcp-map-legend-dot"
            style={{ background: ACCENT_BLUE }}
          />
          Reference well
        </span>
        <span className="wcp-map-legend-item">
          <span
            className="wcp-map-legend-dot"
            style={{ background: OTHER_COLOR }}
          />
          Other wells
        </span>
      </div>

      {/* Missing-coordinates footnote */}
      {missingCount > 0 && (
        <p className="wcp-map-footnote">
          {missingCount === 1
            ? "1 well without location"
            : `${missingCount} wells without location`}
        </p>
      )}
    </div>
  );
}
