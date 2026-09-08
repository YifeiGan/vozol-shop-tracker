export const GEOCODE_VERSION = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shopHasCoords(shop) {
  const lat = Number(shop?.lat);
  const lng = Number(shop?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

function streetLine(address) {
  return String(address || '').split(',')[0].trim();
}

function zipFrom(address) {
  const m = String(address || '').match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : '';
}

const CITY_ALIASES = {
  'st. petersburg': 'St Petersburg',
  'saint petersburg': 'St Petersburg',
  'st petersburg': 'St Petersburg',
  'st pete': 'St Petersburg',
  'st. pete': 'St Petersburg',
  'st pete beach': 'St Pete Beach',
  'st. pete beach': 'St Pete Beach',
  'saint pete beach': 'St Pete Beach',
  'st cloud': 'St Cloud',
  'st. cloud': 'St Cloud',
  'saint cloud': 'St Cloud',
  "town n country": "Town 'N' Country",
  "town 'n' country": "Town 'N' Country",
  'dr phillips': 'Dr. Phillips',
  'dr. phillips': 'Dr. Phillips',
  'ft worth': 'Fort Worth',
  'ft. worth': 'Fort Worth',
  'sugarland': 'Sugar Land',
  'highlands ranch': 'Highlands Ranch',
  'castle rock': 'Castle Rock',
  'greenwood village': 'Greenwood Village',
  'commerce city': 'Commerce City',
  'wheat ridge': 'Wheat Ridge',
  'lone tree': 'Lone Tree',
};

const STATE_META = {
  FL: {
    names: ['Florida'],
    bounds: { lat: [24.4, 31.1], lng: [-87.7, -79.9] },
  },
  TX: {
    names: ['Texas'],
    bounds: { lat: [25.8, 36.6], lng: [-106.7, -93.4] },
  },
  CO: {
    names: ['Colorado'],
    bounds: { lat: [36.9, 41.1], lng: [-109.1, -102.0] },
  },
  MI: {
    names: ['Michigan'],
    bounds: { lat: [41.6, 48.4], lng: [-90.5, -82.1] },
  },
  IL: {
    names: ['Illinois'],
    bounds: { lat: [36.9, 42.6], lng: [-91.6, -87.0] },
  },
  OH: {
    names: ['Ohio'],
    bounds: { lat: [38.3, 42.4], lng: [-84.9, -80.4] },
  },
  WI: {
    names: ['Wisconsin'],
    bounds: { lat: [42.4, 47.4], lng: [-93.0, -86.2] },
  },
  IN: {
    names: ['Indiana'],
    bounds: { lat: [37.7, 41.9], lng: [-88.2, -84.7] },
  },
  MN: {
    names: ['Minnesota'],
    bounds: { lat: [43.4, 49.5], lng: [-97.3, -89.4] },
  },
  GL: {
    names: ['Great Lakes'],
    bounds: { lat: [37.0, 49.5], lng: [-97.5, -74.0] },
    skipAdmin: true,
  },
};
const STATE_ABBRS = Object.keys(STATE_META).filter((abbr) => abbr !== 'GL');
const STATE_ABBR_RE = new RegExp(`\\b(${STATE_ABBRS.join('|')})\\b`, 'i');
const STATE_WORD_RE = new RegExp(
  `\\b(${STATE_ABBRS.concat(STATE_ABBRS.flatMap((abbr) => STATE_META[abbr].names)).join('|')})\\b`,
  'i',
);
const STATE_BEFORE_ZIP_RE = new RegExp(`\\s+(${STATE_ABBRS.join('|')})\\s+\\d{5}(?:-\\d{4})?.*$`, 'i');
const CITY_BEFORE_STATE_ZIP_RE = new RegExp(
  `\\s+([A-Za-z][\\w\\s.'-]+?)\\s+(${STATE_ABBRS.join('|')})\\s*,?\\s*\\d{5}(?:-\\d{4})?\\b`,
  'i',
);
const INLINE_CITY_IN_STATE_PART_RE = new RegExp(`^(.+?)\\s+(${STATE_ABBRS.join('|')})\\b`, 'i');

function statePattern(state) {
  const abbr = STATE_META[state] ? state : 'FL';
  const meta = STATE_META[abbr];
  const words = [abbr, ...meta.names].map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${words.join('|')})\\b`, 'i');
}

function stateFromAddress(address) {
  const raw = String(address || '');
  for (const abbr of STATE_ABBRS) {
    if (statePattern(abbr).test(raw)) return abbr;
  }
  return '';
}

export function resolveState(shop, options = {}) {
  const fromText = stateFromAddress(shop?.address) || stateFromAddress(shop?.city);
  if (fromText) return fromText;
  const explicit = String(options.state || '').trim().toUpperCase();
  if (explicit && explicit !== 'GL' && STATE_META[explicit]) return explicit;
  const team = String(shop?.team_id || options.teamId || '').trim().toLowerCase();
  if (team === 'denver' || team.includes('denver') || team.includes('colorado')) return 'CO';
  if (team === 'texas' || team.includes('texas')) return 'TX';
  if (
    team === 'florida' || team.includes('florida')
    || team === 'tampa' || team.includes('tampa')
    || team === 'orlando' || team.includes('orlando')
  ) return 'FL';
  if (team === 'great_lakes' || team.includes('lakes') || team.includes('great lakes') || explicit === 'GL') {
    return 'GL';
  }
  return 'FL';
}

function inState(lat, lng, state) {
  const bounds = (STATE_META[state] || STATE_META.FL).bounds;
  return lat >= bounds.lat[0] && lat <= bounds.lat[1] && lng >= bounds.lng[0] && lng <= bounds.lng[1];
}

function normalizeCityToken(value, knownCities = []) {
  const raw = String(value || '').trim().replace(STATE_BEFORE_ZIP_RE, '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  if (CITY_ALIASES[key]) return CITY_ALIASES[key];
  const hit = knownCities.find((city) => city.toLowerCase() === key);
  if (hit) return hit;
  const fuzzy = knownCities.find((city) => key.includes(city.toLowerCase()) || city.toLowerCase().includes(key));
  return fuzzy || raw;
}

function cityFromGoogleResult(result, knownCities = []) {
  const components = result?.address_components || [];
  const get = (type) => components.find((c) => c.types?.includes(type))?.long_name || '';
  const candidate = get('locality')
    || get('postal_town')
    || get('sublocality')
    || get('administrative_area_level_3')
    || '';
  return normalizeCityToken(candidate, knownCities);
}

function cityFromNominatimHit(hit, knownCities = []) {
  const addr = hit?.address || {};
  const candidate = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || '';
  return normalizeCityToken(candidate, knownCities);
}

function cityRegionBeforeState(address) {
  const raw = String(address || '').trim();
  if (!raw) return '';

  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const statePartIdx = parts.findIndex((part) => STATE_WORD_RE.test(part));
  if (statePartIdx > 0) {
    const beforeState = parts[statePartIdx - 1];
    if (/^\d/.test(beforeState) && STATE_ABBR_RE.test(parts[statePartIdx])) {
      const inline = parts[statePartIdx].match(INLINE_CITY_IN_STATE_PART_RE);
      if (inline?.[1]) return inline[1].trim();
    }
    return beforeState;
  }

  const inline = raw.match(CITY_BEFORE_STATE_ZIP_RE);
  if (inline) return inline[1].trim();

  return '';
}

function matchKnownCity(region, knownCities) {
  const target = String(region || '').trim();
  if (!target) return '';
  const lower = target.toLowerCase();
  const sorted = [...knownCities].sort((a, b) => b.length - a.length);
  for (const city of sorted) {
    const cityLower = city.toLowerCase();
    const re = new RegExp(`\\b${cityLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(lower)) return city;
  }
  return normalizeCityToken(target, knownCities);
}

export function detectCityFromAddress(address, { fallback = '', knownCities = [] } = {}) {
  const raw = String(address || '').trim();
  if (!raw) return fallback;

  const region = cityRegionBeforeState(raw);
  if (region) {
    const fromRegion = matchKnownCity(region, knownCities);
    if (fromRegion) return fromRegion;
  }

  if (knownCities.length) {
    const fromFull = matchKnownCity(raw, knownCities);
    if (fromFull && fromFull !== raw) return fromFull;
  }

  return fallback;
}

export function geocodeQuery(shop, options = {}) {
  const address = String(shop?.address || '').trim();
  if (!address) return '';
  const street = streetLine(address);
  const zip = zipFrom(address);
  const city = String(shop?.city || '').trim();
  const state = resolveState(shop, options);
  if (street && zip) return `${street}, ${zip}`;
  if (street && city) return `${street}, ${city}, ${state}`;
  return address;
}

export function needsGeocode(shop, options = {}) {
  const query = geocodeQuery(shop, options);
  if (!query) return false;
  const currentVersion = Number(shop.geocode_version) === GEOCODE_VERSION;
  if (shopHasCoords(shop) && shop.geocode_query === query && currentVersion) return false;
  if (shop.geocode_failed && shop.geocode_query === query && currentVersion) return false;
  return true;
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeGoogle(shop, knownCities = [], options = {}) {
  const key = import.meta.env.VITE_FIREBASE_API_KEY;
  if (!key) return null;
  const address = String(shop?.address || '').trim();
  const city = String(shop?.city || '').trim();
  if (!address) return null;
  const state = resolveState(shop, options);
  const parts = [address];
  if (city && !address.toLowerCase().includes(city.toLowerCase())) parts.push(city);
  if (state !== 'GL' && !statePattern(state).test(parts.join(' '))) parts.push(state);
  const components = state === 'GL' || STATE_META[state]?.skipAdmin
    ? 'country:US'
    : `country:US|administrative_area:${state}`;
  const params = new URLSearchParams({
    address: parts.join(', '),
    components,
    key,
  });
  const data = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  if (data?.status !== 'OK' || !Array.isArray(data.results) || !data.results.length) return null;
  const zip = zipFrom(address);
  const result = (zip && data.results.find((item) => String(item.formatted_address || '').includes(zip)))
    || data.results[0];
  const lat = Number(result?.geometry?.location?.lat);
  const lng = Number(result?.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inState(lat, lng, state)) return null;
  return {
    lat,
    lng,
    city: cityFromGoogleResult(result, knownCities),
  };
}

function hitBlob(hit) {
  const addr = hit?.address || {};
  return [
    hit?.display_name,
    addr.postcode,
    addr.city,
    addr.town,
    addr.village,
    addr.hamlet,
    addr.suburb,
    addr.state,
  ].filter(Boolean).join(' ').toLowerCase();
}

function parseHit(hit, knownCities = [], state = 'FL') {
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inState(lat, lng, state)) return null;
  return {
    lat,
    lng,
    city: cityFromNominatimHit(hit, knownCities),
  };
}

function pickNominatimHit(hits, shop, knownCities = [], state = 'FL') {
  const zip = zipFrom(shop?.address);
  const list = Array.isArray(hits) ? hits : [];
  if (zip) {
    const byZip = list.find((hit) => hitBlob(hit).includes(zip));
    if (byZip) return parseHit(byZip, knownCities, state);
    return parseHit(list[0], knownCities, state);
  }
  return parseHit(list[0], knownCities, state);
}

async function geocodeNominatim(shop, knownCities = [], options = {}) {
  const queries = [...new Set([geocodeQuery(shop, options), String(shop?.address || '').trim()].filter(Boolean))];
  const state = resolveState(shop, options);
  for (const q of queries) {
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '5',
      addressdetails: '1',
      countrycodes: 'us',
      q,
    });
    const hits = await fetchJson(`https://nominatim.openstreetmap.org/search?${params}`);
    const coords = pickNominatimHit(hits, shop, knownCities, state);
    if (coords) return coords;
    await sleep(1100);
  }
  return null;
}

export async function geocodeAddress(query, shop, options = {}) {
  const knownCities = options.knownCities || [];
  const target = shop || { address: query, city: '' };
  if (!geocodeQuery(target, options) && !String(query || '').trim()) return null;
  return (await geocodeGoogle(target, knownCities, options)) || (await geocodeNominatim(target, knownCities, options));
}

export async function geocodeShops(shops, onEach) {
  const pending = shops.filter(needsGeocode);
  for (const shop of pending) {
    const query = geocodeQuery(shop);
    let coords = null;
    try {
      coords = await geocodeAddress(query, shop);
    } catch {
      coords = null;
    }
    await onEach(shop, coords, query);
    await sleep(400);
  }
}
