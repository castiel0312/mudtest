import { useState } from "react";
import "./nd-map.css";

export interface MapWell {
  name: string;
  lat: number | null;
  lon: number | null;
}

export interface NdMapProps {
  active: MapWell;
  nearby: MapWell[];
}

const WIDTH = 720;
const HEIGHT = 360;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const RADII = [5, 10, 20] as const;
const EARTH_RADIUS_KM = 6371;

function validCoordinates(well: MapWell): well is MapWell & { lat: number; lon: number } {
  return well.lat !== null && well.lon !== null && Number.isFinite(well.lat) && Number.isFinite(well.lon);
}

function haversineDistance(active: MapWell & { lat: number; lon: number }, nearby: MapWell & { lat: number; lon: number }): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (nearby.lat - active.lat) * radians;
  const longitudeDelta = (nearby.lon - active.lon) * radians;
  const latitude1 = active.lat * radians;
  const latitude2 = nearby.lat * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function NdMap({ active, nearby }: NdMapProps) {
  const [radiusKm, setRadiusKm] = useState<(typeof RADII)[number]>(10);
  const [zoom, setZoom] = useState(1);
  const locatedNearby = nearby.filter(validCoordinates);
  const omittedCount = nearby.length - locatedNearby.length;

  if (!validCoordinates(active)) {
    return <section className="nd-map-panel" aria-label="Well location map">
      <div className="nd-map-unavailable">Unavailable</div>
      <p className="nd-map-omitted">{omittedCount} wells without location</p>
    </section>;
  }

  const mapRadius = Math.min(WIDTH, HEIGHT) * 0.39 * zoom;
  const longitudeScale = Math.cos(active.lat * Math.PI / 180);
  const project = (well: MapWell & { lat: number; lon: number }) => {
    const eastKm = (well.lon - active.lon) * Math.PI / 180 * EARTH_RADIUS_KM * longitudeScale;
    const northKm = (well.lat - active.lat) * Math.PI / 180 * EARTH_RADIUS_KM;
    return {
      x: CENTER_X + (eastKm / radiusKm) * mapRadius,
      y: CENTER_Y - (northKm / radiusKm) * mapRadius,
    };
  };
  const activePoint = project(active);

  return <section className="nd-map-panel" aria-label="Well location map">
    <div className="nd-map-toolbar">
      <label className="nd-map-radius-label">Radius
        <select value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value) as (typeof RADII)[number])}>
          {RADII.map((radius) => <option key={radius} value={radius}>{radius} km</option>)}
        </select>
      </label>
      <div className="nd-map-zoom" aria-label="Map zoom controls">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(2, current * 1.25))}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(0.5, current / 1.25))}>−</button>
      </div>
    </div>
    <div className="nd-map-frame">
      <svg className="nd-map-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Map centred on ${active.name}, ${radiusKm} kilometre radius`}>
        <defs>
          <pattern id="nd-map-contours" width="146" height="108" patternUnits="userSpaceOnUse">
            <path d="M-20 27 C18 2 42 54 82 29 S142 5 168 28 M-28 48 C12 24 43 75 83 50 S140 28 172 51 M-20 76 C19 52 48 103 89 78 S143 55 167 80" fill="none" stroke="rgba(127, 157, 145, .22)" strokeWidth="1" />
          </pattern>
          <radialGradient id="nd-map-glow">
            <stop offset="0" stopColor="#233b3c" />
            <stop offset="1" stopColor="#101c2a" />
          </radialGradient>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#nd-map-glow)" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#nd-map-contours)" />
        <path className="nd-map-river" d="M0 272 C104 231 132 303 232 259 S382 210 471 249 S620 293 720 236" />
        <path className="nd-map-road" d="M38 0 C120 88 179 97 269 162 S426 226 508 360 M0 100 C108 151 174 157 282 135 S516 78 720 127" />
        <circle className="nd-map-range" cx={CENTER_X} cy={CENTER_Y} r={mapRadius} />
        <line className="nd-map-crosshair" x1={CENTER_X - mapRadius} x2={CENTER_X + mapRadius} y1={CENTER_Y} y2={CENTER_Y} />
        <line className="nd-map-crosshair" x1={CENTER_X} x2={CENTER_X} y1={CENTER_Y - mapRadius} y2={CENTER_Y + mapRadius} />
        {locatedNearby.map((well, index) => {
          const point = project(well);
          const distance = haversineDistance(active, well);
          if (Math.hypot(point.x - CENTER_X, point.y - CENTER_Y) > mapRadius) return null;
          return <g className="nd-map-nearby" key={`${well.name}-${index}`}>
            <circle cx={point.x} cy={point.y} r="5" />
            <title>{well.name} · {distance.toFixed(1)} km</title>
            <text x={point.x + 9} y={point.y - 7}>{well.name}</text>
            <text className="nd-map-distance" x={point.x + 9} y={point.y + 7}>{distance.toFixed(1)} km</text>
          </g>;
        })}
        <g className="nd-map-active" transform={`translate(${activePoint.x} ${activePoint.y})`}>
          <circle r="10" />
          <circle className="nd-map-active-core" r="3" />
          <text x="13" y="-11">{active.name}</text>
        </g>
        <text className="nd-map-north" x={WIDTH - 25} y="26">N ↑</text>
        <text className="nd-map-scale" x="16" y={HEIGHT - 14}>{radiusKm} km radius</text>
      </svg>
    </div>
    <div className="nd-map-footer">
      <div className="nd-map-legend"><span><i className="nd-map-active-key" />Active well</span><span><i className="nd-map-nearby-key" />Nearby wells</span></div>
      <p className="nd-map-omitted">{omittedCount} wells without location</p>
    </div>
  </section>;
}
