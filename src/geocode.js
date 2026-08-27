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

async function geocodeGoogle(shop) {
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
  return { lat, lng };
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

function parseHit(hit) {
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inFlorida(lat, lng)) return null;
  return { lat, lng };
}

function pickNominatimHit(hits, shop) {
  const zip = zipFrom(shop?.address);
  const list = Array.isArray(hits) ? hits : [];
  if (zip) {
    const byZip = list.find((hit) => hitBlob(hit).includes(zip));
    if (byZip) return parseHit(byZip);
    return parseHit(list[0]);
  }
  return parseHit(list[0]);
}

async function geocodeNominatim(shop) {
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
    const coords = pickNominatimHit(hits, shop);
    if (coords) return coords;
    await sleep(1100);
  }
  return null;
}

export async function geocodeAddress(query, shop) {
  const target = shop || { address: query, city: '' };
  if (!geocodeQuery(target) && !String(query || '').trim()) return null;
  return (await geocodeGoogle(target)) || (await geocodeNominatim(target));
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
