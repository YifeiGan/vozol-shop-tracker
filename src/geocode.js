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
};

function normalizeCityToken(value, knownCities = []) {
  const raw = String(value || '').trim().replace(/\s+FL\s+\d{5}(?:-\d{4})?.*$/i, '').trim();
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

function cityRegionBeforeFlorida(address) {
  const raw = String(address || '').trim();
  if (!raw) return '';

  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const flPartIdx = parts.findIndex((part) => /\bFL\b/i.test(part));
  if (flPartIdx > 0) {
    const beforeFl = parts[flPartIdx - 1];
    if (/^\d/.test(beforeFl) && /\bFL\b/i.test(parts[flPartIdx])) {
      const inline = parts[flPartIdx].match(/^(.+?)\s+FL\b/i);
      if (inline?.[1]) return inline[1].trim();
    }
    return beforeFl;
  }

  const inline = raw.match(/\s+([A-Za-z][\w\s.'-]+?)\s+FL\s*,?\s*\d{5}(?:-\d{4})?\b/i);
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

  const region = cityRegionBeforeFlorida(raw);
  if (region) {
    const fromRegion = matchKnownCity(region, knownCities);
    if (fromRegion) return fromRegion;
  }

  if (/\bFL\b/i.test(raw) && knownCities.length) {
    const fromFull = matchKnownCity(raw, knownCities);
    if (fromFull && fromFull !== raw) return fromFull;
  }

  return fallback;
}

export function geocodeQuery(shop) {
  const address = String(shop?.address || '').trim();
  if (!address) return '';
  const street = streetLine(address);
  const zip = zipFrom(address);
  const city = String(shop?.city || '').trim();
  if (street && zip) return `${street}, ${zip}`;
  if (street && city) return `${street}, ${city}, FL`;
  return address;
}

export function needsGeocode(shop) {
  const query = geocodeQuery(shop);
  if (!query) return false;
  const currentVersion = Number(shop.geocode_version) === GEOCODE_VERSION;
  if (shopHasCoords(shop) && shop.geocode_query === query && currentVersion) return false;
  if (shop.geocode_failed && shop.geocode_query === query && currentVersion) return false;
  return true;
}

function inFlorida(lat, lng) {
  return lat >= 24.4 && lat <= 31.1 && lng >= -87.7 && lng <= -79.9;
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

async function geocodeGoogle(shop, knownCities = []) {
  const key = import.meta.env.VITE_FIREBASE_API_KEY;
  if (!key) return null;
  const address = String(shop?.address || '').trim();
  const city = String(shop?.city || '').trim();
  if (!address) return null;
  const parts = [address];
  if (city && !address.toLowerCase().includes(city.toLowerCase())) parts.push(city);
  if (!/\bfl\b|\bflorida\b/i.test(parts.join(' '))) parts.push('FL');
  const params = new URLSearchParams({
    address: parts.join(', '),
    components: 'country:US|administrative_area:FL',
    key,
  });
  const data = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  if (data?.status !== 'OK' || !Array.isArray(data.results) || !data.results.length) return null;
  const zip = zipFrom(address);
  const result = (zip && data.results.find((item) => String(item.formatted_address || '').includes(zip)))
    || data.results[0];
  const lat = Number(result?.geometry?.location?.lat);
  const lng = Number(result?.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inFlorida(lat, lng)) return null;
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

function parseHit(hit, knownCities = []) {
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inFlorida(lat, lng)) return null;
  return {
    lat,
    lng,
    city: cityFromNominatimHit(hit, knownCities),
  };
}

function pickNominatimHit(hits, shop, knownCities = []) {
  const zip = zipFrom(shop?.address);
  const list = Array.isArray(hits) ? hits : [];
  if (zip) {
    const byZip = list.find((hit) => hitBlob(hit).includes(zip));
    if (byZip) return parseHit(byZip, knownCities);
    return parseHit(list[0], knownCities);
  }
  return parseHit(list[0], knownCities);
}

async function geocodeNominatim(shop, knownCities = []) {
  const queries = [...new Set([geocodeQuery(shop), String(shop?.address || '').trim()].filter(Boolean))];
  for (const q of queries) {
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '5',
      addressdetails: '1',
      countrycodes: 'us',
      q,
    });
    const hits = await fetchJson(`https://nominatim.openstreetmap.org/search?${params}`);
    const coords = pickNominatimHit(hits, shop, knownCities);
    if (coords) return coords;
    await sleep(1100);
  }
  return null;
}

export async function geocodeAddress(query, shop, options = {}) {
  const knownCities = options.knownCities || [];
  const target = shop || { address: query, city: '' };
  if (!geocodeQuery(target) && !String(query || '').trim()) return null;
  return (await geocodeGoogle(target, knownCities)) || (await geocodeNominatim(target, knownCities));
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
