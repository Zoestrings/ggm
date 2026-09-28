/**
 * Calculates distance between two coordinates in meters using the Haversine formula.
 * @param {number} lat1 Latitude of coordinate 1
 * @param {number} lng1 Longitude of coordinate 1
 * @param {number} lat2 Latitude of coordinate 2
 * @param {number} lng2 Longitude of coordinate 2
 * @returns {number} Distance in meters
 */
export function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lng2 - lng1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
