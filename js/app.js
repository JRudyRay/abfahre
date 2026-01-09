/**
 * Abfahre - Swiss Departure Board
 * Main Application
 */

// DOM Elements
const stationInput = document.getElementById('station-input');
const searchBtn = document.getElementById('search-btn');
const locationBtn = document.getElementById('location-btn');
const suggestions = document.getElementById('suggestions');
const boardWrapper = document.getElementById('board-wrapper');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const errorMessage = document.getElementById('error-message');
const retryBtn = document.getElementById('retry-btn');
const departuresContainer = document.getElementById('departures-container');
const emptyState = document.getElementById('empty-state');
const clock = document.getElementById('clock');
const sbbHourHand = document.getElementById('sbb-hour');
const sbbMinuteHand = document.getElementById('sbb-minute');
const sbbSecondHand = document.getElementById('sbb-second');
const sbbSecondDisc = document.getElementById('sbb-second-disc');

// Config
const GEOLOCATION_TIMEOUT_MS = 15000;
const GEOLOCATION_MAX_AGE_MS = 60000;

// In-flight request handling (for smooth UX)
let suggestionsController = null;
let suggestionsSeq = 0;
let departuresController = null;
let departuresSeq = 0;

// State
let currentStation = null;
let currentDepartures = [];
let refreshInterval = null;
let countdownInterval = null;
let searchTimeout = null;

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
  // Event listeners
  stationInput.addEventListener('input', handleInputChange);
  stationInput.addEventListener('keydown', handleInputKeydown);
  searchBtn.addEventListener('click', handleSearch);
  locationBtn.addEventListener('click', handleLocationClick);
  retryBtn.addEventListener('click', handleRetry);

  // Close suggestions on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-section')) {
      hideSuggestions();
    }
  });

  // Start clock
  updateClock();
  setInterval(updateClock, 1000);

  // Start SBB analog clock
  startSbbAnalogClock();
}

// ============================================
// CLOCK
// ============================================
function updateClock() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function startSbbAnalogClock() {
  if (!sbbHourHand || !sbbMinuteHand || !sbbSecondHand || !sbbSecondDisc) return;

  const render = () => {
    const now = new Date();

    // Fractions for smooth motion
    const ms = now.getMilliseconds();
    const secondsReal = now.getSeconds() + ms / 1000;

    // Swiss railway clock behavior:
    // second hand rotates in ~58.5s, then waits at 12 until the minute impulse.
    const ROTATION_SECONDS = 58.5;
    const secondProgress = Math.min(secondsReal, ROTATION_SECONDS);
    const secondDeg = (secondProgress / ROTATION_SECONDS) * 360;
    const secondsPausedAtTop = secondsReal >= ROTATION_SECONDS;

    // Minute jump happens during the pause at the top.
    // We emulate it by advancing minute/hour when the seconds hand is paused.
    let minuteInt = now.getMinutes();
    let hourInt = now.getHours();
    if (secondsPausedAtTop) {
      minuteInt += 1;
      if (minuteInt >= 60) {
        minuteInt = 0;
        hourInt += 1;
      }
    }

    const minutes = minuteInt + (secondsPausedAtTop ? 0 : secondsReal / 60);
    const hours = (hourInt % 12) + minutes / 60;

    const hourDeg = hours * 30;
    const minuteDeg = minutes * 6;

    sbbHourHand.setAttribute('transform', `rotate(${hourDeg})`);
    sbbMinuteHand.setAttribute('transform', `rotate(${minuteDeg})`);
    // If paused, pin at 12 o'clock (0deg)
    const secondDisplayDeg = secondsPausedAtTop ? 0 : secondDeg;
    sbbSecondHand.setAttribute('transform', `rotate(${secondDisplayDeg})`);
    sbbSecondDisc.setAttribute('transform', `rotate(${secondDisplayDeg})`);

    requestAnimationFrame(render);
  };

  requestAnimationFrame(render);
}

// ============================================
// SEARCH & SUGGESTIONS
// ============================================
function handleInputChange(e) {
  const query = e.target.value.trim();
  clearTimeout(searchTimeout);

  // Cancel any in-flight suggestion request so results don't flash.
  if (suggestionsController) {
    suggestionsController.abort();
    suggestionsController = null;
  }
  
  if (query.length < 2) {
    hideSuggestions();
    return;
  }

  const mySeq = ++suggestionsSeq;
  searchTimeout = setTimeout(async () => {
    suggestionsController = new AbortController();
    try {
      const stations = await searchStations(query, { signal: suggestionsController.signal });
      if (mySeq !== suggestionsSeq) return;
      showSuggestions(stations);
    } catch (err) {
      if (err && err.message === 'Abgebrochen') return;
      console.error('Search error:', err);
    }
  }, 250);
}

function handleInputKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    hideSuggestions();
    handleSearch();
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
}

function showSuggestions(stations) {
  if (stations.length === 0) {
    hideSuggestions();
    return;
  }

  suggestions.innerHTML = stations.map(station => `
    <div class="suggestion-item" data-id="${escapeAttr(station.id)}" data-name="${escapeAttr(station.name)}">
      ${escapeHtml(station.name)}
    </div>
  `).join('');

  suggestions.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      selectStation({
        id: item.dataset.id,
        name: item.dataset.name
      });
    });
  });

  suggestions.classList.remove('hidden');
}

function hideSuggestions() {
  suggestions.classList.add('hidden');
}

// ============================================
// STATION SELECTION
// ============================================
async function selectStation(station) {
  currentStation = station;
  stationInput.value = station.name;
  hideSuggestions();
  await loadDepartures();
}

async function handleSearch() {
  const query = stationInput.value.trim();
  if (!query) return;

  showLoading();
  hideError();
  hideEmptyState();

  try {
    const stations = await searchStations(query);
    if (stations.length === 0) {
      showError('Keine Haltestelle gefunden');
      return;
    }
    await selectStation(stations[0]);
  } catch (err) {
    showError(err.message);
  }
}

// ============================================
// GEOLOCATION
// ============================================
async function handleLocationClick() {
  if (!navigator.geolocation) {
    showError('Standort wird nicht unterstützt');
    return;
  }

  // Geolocation requires a secure context (HTTPS) in modern browsers.
  // GitHub Pages is HTTPS, but local file:// previews are not.
  if (!window.isSecureContext) {
    showError('Standort nur über HTTPS verfügbar');
    return;
  }

  showLoading();
  hideError();
  hideEmptyState();
  showBoard();

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: GEOLOCATION_MAX_AGE_MS
      });
    });

    const { latitude, longitude } = position.coords;
    const station = await findNearestStation(latitude, longitude);
    await selectStation(station);
  } catch (err) {
    let message = 'Standort nicht verfügbar';
    if (err.code === 1) message = 'Standortzugriff verweigert';
    else if (err.code === 3) message = 'Zeitüberschreitung';
    showError(message);
    hideBoard();
    showEmptyState();
  }
}

// ============================================
// DEPARTURES
// ============================================
async function loadDepartures() {
  if (!currentStation) return;

  // Cancel any in-flight departures request so station changes feel instant.
  if (departuresController) {
    departuresController.abort();
    departuresController = null;
  }
  const mySeq = ++departuresSeq;
  departuresController = new AbortController();

  showLoading();
  hideError();
  showBoard();

  try {
    const departures = await fetchDepartures(
      currentStation.id || currentStation.name,
      8,
      { signal: departuresController.signal }
    );
    if (mySeq !== departuresSeq) return;
    // Filter out past departures
    const now = new Date();
    currentDepartures = departures.filter(dep => dep.departureTime >= now);
    
    hideLoading();
    renderDepartures(currentDepartures);

    // Auto-refresh every 30 seconds
    clearInterval(refreshInterval);
    refreshInterval = setInterval(refreshDepartures, 30000);

    // Update countdowns every second
    clearInterval(countdownInterval);
    countdownInterval = setInterval(updateCountdowns, 1000);
  } catch (err) {
    if (err && err.message === 'Abgebrochen') return;
    hideLoading();
    showError(err.message);
  }
}

async function refreshDepartures() {
  if (!currentStation) return;

  try {
    const departures = await fetchDepartures(currentStation.id || currentStation.name);
    // Filter out past departures
    const now = new Date();
    currentDepartures = departures.filter(dep => dep.departureTime >= now);
    renderDepartures(currentDepartures);
  } catch (err) {
    console.error('Refresh error:', err);
  }
}

function handleRetry() {
  if (currentStation) {
    loadDepartures();
  } else {
    handleSearch();
  }
}

// ============================================
// RENDERING
// ============================================

// SVG icons for imminent arrivals (Tramli-style)
const TRAM_ICON = `<svg viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="12" rx="2" fill="currentColor"/><rect x="4" y="6" width="6" height="5" rx="1" fill="#0a0a0a"/><rect x="14" y="6" width="6" height="5" rx="1" fill="#0a0a0a"/><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="18" r="2" fill="currentColor"/><rect x="10" y="1" width="4" height="3" fill="currentColor"/></svg>`;

const BUS_ICON = `<svg viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="3" width="22" height="13" rx="3" fill="currentColor"/><rect x="3" y="5" width="7" height="5" rx="1" fill="#0a0a0a"/><rect x="14" y="5" width="7" height="5" rx="1" fill="#0a0a0a"/><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="18" r="2" fill="currentColor"/></svg>`;

const TRAIN_ICON = `<svg viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="2" width="18" height="14" rx="2" fill="currentColor"/><rect x="5" y="4" width="5" height="4" rx="1" fill="#0a0a0a"/><rect x="14" y="4" width="5" height="4" rx="1" fill="#0a0a0a"/><circle cx="7" cy="18" r="2" fill="currentColor"/><circle cx="17" cy="18" r="2" fill="currentColor"/><rect x="10" y="10" width="4" height="3" rx="1" fill="#0a0a0a"/></svg>`;

function renderDepartures(departures) {
  if (departures.length === 0) {
    departuresContainer.innerHTML = '<div class="no-departures">Keine Abfahrten</div>';
    return;
  }

  departuresContainer.innerHTML = departures.map((dep, index) => {
    const timeDisplay = formatTimeDisplay(dep.departureTime, dep.category);

    return `
      <div class="departure-row" style="animation-delay: ${index * 30}ms">
        <div class="line-number">${escapeHtml(dep.line)}</div>
        <div class="destination">${escapeHtml(dep.destination)}</div>
        <div class="time-display">${timeDisplay}</div>
      </div>
    `;
  }).join('');
}

function updateCountdowns() {
  if (!currentDepartures.length) return;

  // Filter out any departures that have become past
  const now = new Date();
  const stillFuture = currentDepartures.filter(dep => dep.departureTime >= now);
  
  // Re-render if departures have been removed
  if (stillFuture.length !== currentDepartures.length) {
    currentDepartures = stillFuture;
    renderDepartures(currentDepartures);
    return;
  }

  const rows = departuresContainer.querySelectorAll('.departure-row');
  rows.forEach((row, index) => {
    if (index >= currentDepartures.length) return;
    
    const dep = currentDepartures[index];
    const timeEl = row.querySelector('.time-display');
    if (!timeEl) return;

    timeEl.innerHTML = formatTimeDisplay(dep.departureTime, dep.category);
  });
}

// ============================================
// UI STATE MANAGEMENT
// ============================================
function showLoading() {
  loading.classList.remove('hidden');
  setBusy(true);
}

function hideLoading() {
  loading.classList.add('hidden');
  setBusy(false);
}

function showError(message) {
  hideLoading();
  hideBoard();
  showEmptyState();
  errorMessage.textContent = message;
  error.classList.remove('hidden');
  setBusy(false);
}

function hideError() {
  error.classList.add('hidden');
}

function setBusy(isBusy) {
  stationInput.disabled = !!isBusy;
  searchBtn.disabled = !!isBusy;
  locationBtn.disabled = !!isBusy;
  retryBtn.disabled = !!isBusy;
}

function showBoard() {
  boardWrapper.classList.remove('hidden');
  hideEmptyState();
}

function hideBoard() {
  boardWrapper.classList.add('hidden');
}

function showEmptyState() {
  emptyState.classList.remove('hidden');
}

function hideEmptyState() {
  emptyState.classList.add('hidden');
}

// ============================================
// FORMATTING HELPERS
// ============================================

// Format time display - shows icon for imminent, minutes otherwise
function formatTimeDisplay(date, category) {
  const now = new Date();
  const diffMs = date - now;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 0) return '--';
  
  // Show vehicle icon for imminent arrivals (0-1 min)
  if (diffMins <= 1) {
    return `<div class="vehicle-icon">${getVehicleIcon(category)}</div>`;
  }
  
  // Show minutes with apostrophe
  if (diffMins < 60) return `${diffMins}'`;
  
  // Show hours:minutes for longer waits
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}`;
}

// Get appropriate vehicle icon based on category
function getVehicleIcon(category) {
  const cat = (category || '').toUpperCase();
  
  // Tram categories
  if (cat === 'T' || cat === 'TRAM' || cat === 'NFT') return TRAM_ICON;
  
  // Bus categories
  if (cat === 'B' || cat === 'BUS' || cat === 'NFB' || cat === 'NFO' || cat === 'KB' || cat === 'TROLLEY') return BUS_ICON;
  
  // Train/S-Bahn categories
  if (cat === 'S' || cat === 'IC' || cat === 'ICE' || cat === 'EC' || cat === 'IR' || cat === 'RE' || cat === 'R') return TRAIN_ICON;
  
  // Default to tram icon
  return TRAM_ICON;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function escapeAttr(text) {
  return (text || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
