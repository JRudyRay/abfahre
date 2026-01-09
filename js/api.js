/**
 * Swiss Transport API Client
 * https://transport.opendata.ch
 */

const API_BASE = 'https://transport.opendata.ch/v1';

const API_TIMEOUT_MS = 15000;

async function fetchJson(url, { timeoutMs = API_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController();

  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      let bodyPreview = '';
      try {
        const text = await response.text();
        if (text) bodyPreview = ` - ${text.slice(0, 200)}`;
      } catch {
        // ignore
      }
      throw new Error(`Fehler beim Laden: ${response.status}${bodyPreview}`);
    }

    return await response.json();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      if (didTimeout) throw new Error('Zeitüberschreitung (API)');
      throw new Error('Abgebrochen');
    }
    throw err;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    clearTimeout(timeoutId);
  }
}

/**
 * Search for stations by name
 * @param {string} query - Station name to search for
 * @returns {Promise<Array>} List of matching stations
 */
async function searchStations(query, { signal } = {}) {
  if (!query || query.length < 2) return [];

  const url = `${API_BASE}/locations?query=${encodeURIComponent(query)}&type=station`;
  const data = await fetchJson(url, { signal });
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
async function findNearestStation(lat, lon, { signal } = {}) {
  const url = `${API_BASE}/locations?x=${lat}&y=${lon}`;
  const data = await fetchJson(url, { signal });
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
async function fetchDepartures(stationId, limit = 8, { signal } = {}) {
  const url = `${API_BASE}/stationboard?station=${encodeURIComponent(stationId)}&limit=${limit}`;
  const data = await fetchJson(url, { signal });
  return (data.stationboard || []).map(dep => ({
    line: dep.number || dep.name || '',
    destination: dep.to || '',
    departureTime: dep.stop?.departure ? new Date(dep.stop.departure) : new Date(),
    platform: dep.stop?.platform || '',
    category: dep.category || ''
  }));
}
