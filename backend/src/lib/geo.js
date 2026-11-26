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
