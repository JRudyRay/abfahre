/**
 * Swiss Transport API Client
 * https://transport.opendata.ch
 */

const API_BASE = 'https://transport.opendata.ch/v1';

/**
 * Search for stations by name
 * @param {string} query - Station name to search for
 * @returns {Promise<Array>} List of matching stations
 */
async function searchStations(query) {
  if (!query || query.length < 2) return [];

  const url = `${API_BASE}/locations?query=${encodeURIComponent(query)}&type=station`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Fehler beim Laden: ${response.status}`);
  }

  const data = await response.json();
  return (data.stations || [])
    .filter(s => s.id && s.name)
    .slice(0, 8);
}

/**
 * Find nearest station by coordinates
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<Object>} Nearest station
 */
async function findNearestStation(lat, lon) {
  const url = `${API_BASE}/locations?x=${lat}&y=${lon}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Fehler: ${response.status}`);
  }

  const data = await response.json();
  const stations = (data.stations || []).filter(s => s.id && s.name);

  if (stations.length === 0) {
    throw new Error('Keine Haltestelle in der Nähe gefunden');
  }

  return stations[0];
}

/**
 * Fetch departures for a station
 * @param {string} stationId - Station ID or name
 * @param {number} limit - Maximum number of departures
 * @returns {Promise<Array>} List of departures
 */
async function fetchDepartures(stationId, limit = 8) {
  const url = `${API_BASE}/stationboard?station=${encodeURIComponent(stationId)}&limit=${limit}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Fehler: ${response.status}`);
  }

  const data = await response.json();
  return (data.stationboard || []).map(dep => ({
    line: dep.number || dep.name || '',
    destination: dep.to || '',
    departureTime: dep.stop?.departure ? new Date(dep.stop.departure) : new Date(),
    platform: dep.stop?.platform || '',
    category: dep.category || ''
  }));
}
