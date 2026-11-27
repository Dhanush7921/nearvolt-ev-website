import { geohashForLocation, geohashQueryBounds, distanceBetween } from 'geofire-common';
export { geohashForLocation, geohashQueryBounds };
export const distanceKm = (a, b) => distanceBetween([a.lat, a.lng], [b.lat, b.lng]);
export const roundKm = (km) => Math.round(km * 10) / 10;
export const mapsDirectionsUrl = (lat, lng) =>
  `https://www.google.com/maps/dir/?api=1&destination=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
// Point-in-circle service-area check.
export function inServiceArea(point, areas) {
  return areas.find((a) => a.active && distanceKm(point, a.center) <= a.radiusKm) || null;
}

// Privacy-safe map area for discovery: the centre of the ~1.1 km grid cell containing the host.
// Exact coordinates are only revealed to the customer after the host accepts a request.
const CELL = 0.01;
export const approxArea = (p) => ({
  lat: Math.round((Math.floor(p.lat / CELL) * CELL + CELL / 2) * 1e4) / 1e4,
  lng: Math.round((Math.floor(p.lng / CELL) * CELL + CELL / 2) * 1e4) / 1e4,
  radiusM: 800,
});
