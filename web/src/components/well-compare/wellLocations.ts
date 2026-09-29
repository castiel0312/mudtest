export type WellLocation = {
  name: string;
  lat: number | null;
  lon: number | null;
};

// NOTE: approximate positions near the Utah FORGE site (Milford, UT).
// Replace with surveyed well-header coordinates before treating as real data.
export const WELL_LOCATIONS: WellLocation[] = [
  { name: "FORGE 16B(78)-32", lat: 38.5019, lon: -112.8981 },
  { name: "FORGE 16A(78)-32", lat: 38.5022, lon: -112.8976 },
  { name: "FORGE 78-32", lat: 38.5015, lon: -112.8988 },
  { name: "FORGE 58-32", lat: 38.5049, lon: -112.8925 },
];