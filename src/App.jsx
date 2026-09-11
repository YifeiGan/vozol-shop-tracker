import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Plus, X, ExternalLink, LogOut, Save, Users, Clipboard, Copy, Star, Map, List, Eye, EyeOff, LayoutDashboard, SlidersHorizontal, Download, ChevronDown,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, configured, db, googleProvider } from './firebase';
import { detectCityFromAddress, geocodeAddress, geocodeQuery, GEOCODE_VERSION, needsGeocode, shopHasCoords } from './geocode';

const ShopMap = React.lazy(() => import('./ShopMap'));

const FLORIDA_CITIES = ['Tampa', 'Orlando'];
const TAMPA_AREA_CITIES = [
  'Tampa', 'Clearwater', 'St Petersburg', 'Largo', 'Dunedin', 'Pinellas Park',
  'Oldsmar', 'Palm Harbor', 'Tarpon Springs', 'Safety Harbor', 'Seminole',
  'Indian Rocks Beach', 'Belleair Bluffs', 'Clearwater Beach', 'St Pete Beach',
  'New Port Richey', 'Port Richey', 'Holiday', 'Madeira Beach', 'Treasure Island',
];
const ORLANDO_AREA_CITIES = [
  'Orlando', 'Winter Park', 'Kissimmee', 'Sanford', 'Altamonte Springs',
  'Lake Mary', 'Apopka', 'Oviedo', 'Winter Garden', 'Windermere',
  'Ocoee', 'Clermont', 'St Cloud', 'Casselberry', 'Maitland',
  'Longwood', 'Winter Springs', 'Celebration', 'Dr. Phillips', 'Lake Buena Vista',
  'Davenport', 'Poinciana',
];
const FLORIDA_AREAS = [
  { id: 'tampa', label: 'Tampa', cities: TAMPA_AREA_CITIES },
  { id: 'orlando', label: 'Orlando', cities: ORLANDO_AREA_CITIES },
];
const TEXAS_CITIES = [
  'Houston', 'Katy', 'Sugar Land', 'The Woodlands', 'Pearland', 'Cypress', 'Spring',
  'Pasadena', 'League City', 'Humble', 'Conroe', 'Galveston',
  'Dallas', 'Fort Worth', 'Arlington', 'Plano', 'Irving', 'Garland', 'Frisco',
  'McKinney', 'Denton', 'Richardson', 'Mesquite', 'Grand Prairie', 'Carrollton',
  'Allen', 'Lewisville',
  'Austin', 'Round Rock', 'Cedar Park', 'Pflugerville', 'Georgetown', 'San Marcos',
  'San Antonio', 'New Braunfels',
  'El Paso', 'Corpus Christi', 'Lubbock', 'Laredo', 'McAllen', 'Waco',
  'Amarillo', 'Midland', 'Odessa', 'College Station', 'Tyler', 'Beaumont',
  'Brownsville', 'Killeen', 'Abilene',
];
const DENVER_CITIES = [
  'Denver', 'Aurora', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Centennial',
  'Boulder', 'Broomfield', 'Commerce City', 'Englewood', 'Littleton', 'Parker',
  'Castle Rock', 'Highlands Ranch', 'Wheat Ridge', 'Northglenn', 'Golden',
  'Greenwood Village', 'Lone Tree', 'Louisville', 'Lafayette', 'Erie', 'Brighton',
  'Superior', 'Federal Heights', 'Sheridan', 'Glendale',
];
const GREAT_LAKES_CITIES = [
  'Chicago', 'Naperville', 'Aurora', 'Elgin', 'Joliet',
  'Detroit', 'Grand Rapids', 'Ann Arbor', 'Lansing', 'Flint', 'Kalamazoo',
  'Cleveland', 'Columbus', 'Toledo', 'Cincinnati', 'Akron',
  'Milwaukee', 'Madison', 'Green Bay',
  'Indianapolis', 'Fort Wayne', 'South Bend',
  'Minneapolis', 'St Paul', 'Duluth',
  'Buffalo', 'Rochester',
];
const TEAM_CITIES = {
  florida: FLORIDA_CITIES,
  texas: TEXAS_CITIES,
  denver: DENVER_CITIES,
  great_lakes: GREAT_LAKES_CITIES,
};
const TEAM_ORDER = ['florida', 'texas', 'denver', 'great_lakes'];
const TEAM_LABEL = {
  florida: 'Florida',
  texas: 'Texas',
  denver: 'Denver',
  great_lakes: 'The Great Lakes',
};
const TEAM_STATE = { florida: 'FL', texas: 'TX', denver: 'CO', great_lakes: 'GL' };
const TEAM_DEFAULT_CITY = { florida: 'Tampa', texas: 'Houston', denver: 'Denver', great_lakes: 'Chicago' };
const TEAM_MAP_VIEW = {
  florida: { center: [28.0, -82.0], zoom: 7 },
  texas: { center: [31.0, -99.9], zoom: 6 },
  denver: { center: [39.7392, -104.9903], zoom: 11 },
  great_lakes: { center: [42.3, -86.0], zoom: 5 },
};
const TEAM_SUBTITLE = TEAM_ORDER.map((id) => TEAM_LABEL[id]).join(' · ');
const STATE_IN_ADDRESS_RE = /\b(FL|TX|CO|MI|IL|OH|WI|IN|MN|Florida|Texas|Colorado|Michigan|Illinois|Ohio|Wisconsin|Indiana|Minnesota)\b/i;

function teamChoiceHint() {
  const labels = TEAM_ORDER.map((id) => TEAM_LABEL[id]).filter(Boolean);
  if (labels.length <= 1) return labels[0] || '地区';
  return `${labels.slice(0, -1).join('、')} 或 ${labels[labels.length - 1]}`;
}

function normalizeTeamId(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (key === 'florida' || key === 'fl' || key.includes('florida') || key.includes('tampa') || key.includes('orlando')) return 'florida';
  if (key === 'texas' || key === 'tx' || key.includes('texas')) return 'texas';
  if (key === 'denver' || key === 'co' || key.includes('denver') || key.includes('colorado')) return 'denver';
  if (key === 'great lakes' || key === 'great_lakes' || key === 'gl' || key.includes('lakes')) return 'great_lakes';
  return '';
}

function cityToFloridaArea(city) {
  const c = String(city || '').trim().toLowerCase();
  if (!c) return '';
  if (TAMPA_AREA_CITIES.some((name) => name.toLowerCase() === c)) return 'tampa';
  if (ORLANDO_AREA_CITIES.some((name) => name.toLowerCase() === c)) return 'orlando';
  return '';
}

function normalizeAreaId(value, city) {
  const key = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (key === 'tampa' || key.includes('tampa')) return 'tampa';
  if (key === 'orlando' || key.includes('orlando')) return 'orlando';
  return cityToFloridaArea(city);
}

function dashboardSectionsFor(regionId) {
  if (regionId === 'florida') return FLORIDA_AREAS;
  const label = TEAM_LABEL[regionId];
  if (!label) return [];
  return [{ id: regionId, label, cities: TEAM_CITIES[regionId] || [] }];
}

function shopAreaId(shop, members = []) {
  const stored = String(shop?.area_id || '').trim().toLowerCase();
  if (stored === 'tampa' || stored === 'orlando') return stored;
  const fromCity = cityToFloridaArea(shop?.city);
  if (fromCity) return fromCity;
  const fromTeam = normalizeAreaId(shop?.team_id);
  if (fromTeam) return fromTeam;
  const owner = members.find((m) => m.id === shop?.assigned_to);
  return owner?.area_id || '';
}

function memberAreaId(member, shops = []) {
  if (member?.area_id === 'tampa' || member?.area_id === 'orlando') return member.area_id;
  const theirs = shops.filter((s) => s.assigned_to === member?.id);
  let tampa = 0;
  let orlando = 0;
  theirs.forEach((s) => {
    const area = shopAreaId(s, [member]);
    if (area === 'tampa') tampa += 1;
    if (area === 'orlando') orlando += 1;
  });
  if (tampa === 0 && orlando === 0) return '';
  return tampa >= orlando ? 'tampa' : 'orlando';
}

function areaLabelOf(areaId) {
  return FLORIDA_AREAS.find((area) => area.id === areaId)?.label || '';
}
const STATUS = {
  visited: '已卖进',
  follow_up: '需跟进',
  no_interest: '无意向/暂缓',
};
const WILLINGNESS_OPTIONS = ['高', '中', '低'];
function defaultCity(teamId) {
  return TEAM_DEFAULT_CITY[normalizeTeamId(teamId)] || TEAM_DEFAULT_CITY.florida;
}

function teamStateOf(teamId) {
  return TEAM_STATE[normalizeTeamId(teamId)] || TEAM_STATE.florida;
}

function teamCityPool(teamId) {
  return TEAM_CITIES[normalizeTeamId(teamId)] || TEAM_CITIES.florida;
}

function teamMapViewOf(teamId) {
  return TEAM_MAP_VIEW[normalizeTeamId(teamId)] || TEAM_MAP_VIEW.florida;
}

function mapsSearchHref(shop, teamId) {
  const name = String(shop?.name || '').trim();
  const address = String(shop?.address || '').trim();
  const city = String(shop?.city || '').trim();
  const blob = `${name} ${address} ${city}`;
  const state = teamStateOf(teamId);
  if (!state || state === 'GL') {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(blob.trim())}`;
  }
  const hasState = STATE_IN_ADDRESS_RE.test(blob);
  const query = (hasState ? blob : `${blob} ${state}`).trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function emptyShop(teamId) {
  return {
    name: '', address: '', city: '', phone: '', tier: '', status: 'not_visited', willingness: '',
    team_id: normalizeTeamId(teamId) || '',
    is_chain: false, chain_name: '', chain_total_stores: '', chain_a_plus_count: '', staff_contact: '', owner_name: '',
    owner_schedule: '', contact_role: '', store_number: '', restock_status: '', distributor: '',
    test_case_placed: false, sample_placed: false, display_card_placed: false,
    test_case_placed_on: '', sample_placed_on: '', display_card_placed_on: '',
    test_case_today: false, sample_today: false, display_card_today: false,
    units_kit_today: '', units_pod_today: '',
    traffic_note: '', traffic_notes: [], brands_note: '', next_plan: '',
    popup_notes: [], popup_date: todayDateKey(), popup_flow: '', popup_vape_buyers: '', popup_vozol_buyers: '',
    popup_kit_sold: '', popup_pod_sold: '',
    next_plan_date: '', next_plan_time: '', source_url: '', starred: false,
  };
}
const MAX_TRAFFIC_NOTES = 3;
const MAX_POPUP_NOTES = 2;
const POPUP_FIELDS = [
  { key: 'flow', draftKey: 'popup_flow', label: '1、人流情况' },
  { key: 'vape_buyers', draftKey: 'popup_vape_buyers', label: '2、买电子烟人数' },
  { key: 'vozol_buyers', draftKey: 'popup_vozol_buyers', label: '3、买 VOZOL 人数' },
  { key: 'kit_sold', draftKey: 'popup_kit_sold', label: '4、活动卖出支数-KIT' },
  { key: 'pod_sold', draftKey: 'popup_pod_sold', label: '5、活动卖出支数-POD' },
];

function formatNextPlan(shop) {
  if (isNextPlanOverdue(shop)) return '';
  const date = (shop?.next_plan_date || '').trim();
  if (!date) return '';
  const time = (shop?.next_plan_time || '').trim();
  return time ? `${date} ${time}` : date;
}

function isNextPlanOverdue(shop, today = todayDateKey()) {
  const date = String(shop?.next_plan_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !today) return false;
  return date < today;
}

const CLEARED_NEXT_PLAN = {
  next_plan_date: '',
  next_plan_time: '',
  next_plan: '',
};

function parsePlanTime(timeStr) {
  const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour: '', minute: '' };
  return {
    hour: String(Number(m[1])).padStart(2, '0'),
    minute: m[2],
  };
}

function combinePlanTime(hour, minute) {
  if (!hour) return '';
  return `${hour}:${minute || '00'}`;
}

const PLAN_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const PLAN_MINUTES = ['00', '15', '30', '45'];
const TIER_RANK = { S: 0, 'A+': 1, A: 2, B: 3, '': 4 };
const SORT_OPTIONS = [
  { value: 'starred', label: '星标店铺' },
  { value: 'updated_at', label: '更新时间' },
  { value: 'created_at', label: '创建时间' },
  { value: 'next_follow_up', label: '下次跟进' },
  { value: 'tier', label: '分级' },
];
const MAPPING_TARGET = 150;
const CHAIN_MIN_STORES = 5;
const COOPERATION = {
  all: '合作意愿',
  willing: '有意向',
  sold_in: '已卖进',
  follow_up: '需跟进',
  no_interest: '无意向',
};

const MIN_PASSWORD_LENGTH = 8;

function passwordIssues(password) {
  const issues = [];
  if (password.length < MIN_PASSWORD_LENGTH) issues.push(`至少 ${MIN_PASSWORD_LENGTH} 位`);
  if (!/[A-Za-z]/.test(password)) issues.push('需包含字母');
  if (!/[0-9]/.test(password)) issues.push('需包含数字');
  return issues;
}

function authMessage(err, mode = 'login') {
  const code = err?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return mode === 'account' ? '当前密码不正确' : '邮箱或密码不正确';
  }
  if (code.includes('requires-recent-login')) return '请输入当前密码后再修改';
  if (code.includes('email-already-in-use')) return '这个邮箱已经注册过，请直接登录';
  if (code.includes('invalid-email')) return '邮箱格式不正确';
  if (code.includes('weak-password')) return `密码太弱，请使用至少 ${MIN_PASSWORD_LENGTH} 位，并包含字母和数字`;
  if (code.includes('operation-not-allowed')) return '邮箱密码登录尚未开启，请在 Firebase Authentication 里打开 Email/Password';
  if (code.includes('popup-closed')) return '已取消 Google 登录';
  if (code.includes('popup-blocked')) return '浏览器拦截了弹窗，请允许后重试';
  if (code.includes('too-many-requests')) return '尝试次数过多，请稍后再试';
  return err?.message || (mode === 'signup' ? '创建账号失败' : '登录失败');
}

function timeValue(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

function nextFollowUpValue(shop) {
  if (isNextPlanOverdue(shop)) return Number.MAX_SAFE_INTEGER;
  const date = (shop?.next_plan_date || '').trim();
  if (!date) return Number.MAX_SAFE_INTEGER;
  const time = (shop?.next_plan_time || '00:00').trim();
  const ts = Date.parse(`${date}T${time}`);
  return Number.isNaN(ts) ? (Date.parse(date) || Number.MAX_SAFE_INTEGER) : ts;
}

function tierRank(tier) {
  return TIER_RANK[tier ?? ''] ?? 4;
}

function todayDateKey(date = new Date()) {
  if (typeof date === 'string') {
    const trimmed = date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  }
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shopUpdatedDateKey(shop) {
  return localDateKeyFromTimestamp(shop?.updated_at);
}

function shopCreatedDateKey(shop) {
  return localDateKeyFromTimestamp(shop?.created_at);
}

function isNewVisitToday(shop, today = todayDateKey()) {
  const created = shopCreatedDateKey(shop);
  if (created) return created === today;
  const notes = normalizeTrafficNotes(shop);
  return !notes.some((n) => n.date && n.date !== today);
}

function legacyNoteDate(shop) {
  return shopUpdatedDateKey(shop) || todayDateKey();
}

function formatNoteStamp(note) {
  const dateLabel = String(note?.date || '').trim().replace(/-/g, '/');
  const ms = timeValue(note?.at);
  if (ms) {
    const d = new Date(ms);
    if (!note?.date || todayDateKey(d) === note.date) {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const fallback = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
      return `${dateLabel || fallback} ${hh}:${mm}`;
    }
  }
  return dateLabel;
}

function normalizeTrafficNotes(shop) {
  const raw = shop?.traffic_notes;
  if (Array.isArray(raw) && raw.length) {
    return raw
      .map((n) => ({
        date: n.date || localDateKeyFromTimestamp(n.at) || '',
        text: String(n.text || '').trim(),
        at: timeValue(n.at),
      }))
      .filter((n) => n.text)
      .sort((a, b) => {
        const byDate = String(b.date).localeCompare(String(a.date));
        return byDate || (timeValue(b.at) - timeValue(a.at));
      })
      .filter((n, i, arr) => arr.findIndex((x) => x.text === n.text) === i)
      .slice(0, MAX_TRAFFIC_NOTES);
  }
  const text = String(shop?.traffic_note || '').trim();
  if (!text) return [];
  return [{
    date: legacyNoteDate(shop),
    text,
    at: timeValue(shop?.updated_at),
  }];
}

function todayNoteText(notes, today = todayDateKey()) {
  return notes.find((n) => n.date === today)?.text || '';
}

function historyNotes(notes, today = todayDateKey()) {
  const todayText = notes.find((n) => n.date === today)?.text || '';
  return notes
    .filter((n) => n.date !== today && (!todayText || n.text !== todayText))
    .slice(0, MAX_TRAFFIC_NOTES);
}

function mergeTrafficNotes(existingNotes, todayText) {
  const today = todayDateKey();
  const text = String(todayText || '').trim();
  const withoutToday = existingNotes.filter((n) => n.date !== today && n.text !== text);
  if (!text) return withoutToday.slice(0, MAX_TRAFFIC_NOTES);
  const prevToday = existingNotes.find((n) => n.date === today);
  const at = prevToday && prevToday.text === text ? (prevToday.at || Date.now()) : Date.now();
  return [{ date: today, text, at }, ...withoutToday].slice(0, MAX_TRAFFIC_NOTES);
}

function serializeTrafficNotes(notes) {
  return notes.slice(0, MAX_TRAFFIC_NOTES).map((n) => ({
    date: n.date,
    text: n.text,
    at: timeValue(n.at) || Date.now(),
  }));
}

function emptyPopupEntry() {
  return { flow: '', vape_buyers: '', vozol_buyers: '', kit_sold: '', pod_sold: '' };
}

function popupHasContent(entry) {
  return POPUP_FIELDS.some((field) => String(entry?.[field.key] || '').trim());
}

function normalizePopupNotes(shop) {
  const raw = shop?.popup_notes;
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw
    .map((n) => ({
      date: n.date || localDateKeyFromTimestamp(n.at) || '',
      flow: String(n.flow || '').trim(),
      vape_buyers: String(n.vape_buyers || '').trim(),
      vozol_buyers: String(n.vozol_buyers || '').trim(),
      kit_sold: String(n.kit_sold || '').trim(),
      pod_sold: String(n.pod_sold || '').trim(),
      at: timeValue(n.at),
    }))
    .filter(popupHasContent)
    .sort((a, b) => {
      const byDate = String(b.date).localeCompare(String(a.date));
      return byDate || (timeValue(b.at) - timeValue(a.at));
    })
    .slice(0, MAX_POPUP_NOTES);
}

function todayPopupEntry(notes, today = todayDateKey()) {
  return notes.find((n) => n.date === today) || emptyPopupEntry();
}

function popupDraftFields(entry) {
  return {
    popup_flow: entry?.flow || '',
    popup_vape_buyers: entry?.vape_buyers || '',
    popup_vozol_buyers: entry?.vozol_buyers || '',
    popup_kit_sold: entry?.kit_sold || '',
    popup_pod_sold: entry?.pod_sold || '',
  };
}

function applyPopupDate(draft, nextDate) {
  const today = todayDateKey();
  const date = String(nextDate || '').trim() || today;
  const existing = date === today
    ? todayPopupEntry(normalizePopupNotes(draft), today)
    : emptyPopupEntry();
  return {
    ...draft,
    popup_date: date,
    ...popupDraftFields(existing),
  };
}

function mergePopupNotes(existingNotes, entry, dateKey) {
  const date = String(dateKey || '').trim();
  if (!date) return existingNotes.slice(0, MAX_POPUP_NOTES);
  const next = {
    flow: String(entry?.flow || '').trim(),
    vape_buyers: String(entry?.vape_buyers || '').trim(),
    vozol_buyers: String(entry?.vozol_buyers || '').trim(),
    kit_sold: String(entry?.kit_sold || '').trim(),
    pod_sold: String(entry?.pod_sold || '').trim(),
  };
  const withoutDate = existingNotes.filter((n) => n.date !== date);
  const today = todayDateKey();
  if (!popupHasContent(next)) {
    if (date === today) return withoutDate.slice(0, MAX_POPUP_NOTES);
    return existingNotes.slice(0, MAX_POPUP_NOTES);
  }
  const prev = existingNotes.find((n) => n.date === date);
  const same = prev
    && prev.flow === next.flow
    && prev.vape_buyers === next.vape_buyers
    && prev.vozol_buyers === next.vozol_buyers
    && prev.kit_sold === next.kit_sold
    && prev.pod_sold === next.pod_sold;
  const at = same ? (prev.at || Date.now()) : Date.now();
  return [{ date, ...next, at }, ...withoutDate]
    .sort((a, b) => {
      const byDate = String(b.date).localeCompare(String(a.date));
      return byDate || (timeValue(b.at) - timeValue(a.at));
    })
    .slice(0, MAX_POPUP_NOTES);
}

function serializePopupNotes(notes) {
  return notes.slice(0, MAX_POPUP_NOTES).map((n) => ({
    date: n.date,
    flow: n.flow,
    vape_buyers: n.vape_buyers,
    vozol_buyers: n.vozol_buyers,
    kit_sold: n.kit_sold,
    pod_sold: n.pod_sold,
    at: timeValue(n.at) || Date.now(),
  }));
}

function formatPopupNoteText(entry) {
  if (!popupHasContent(entry)) return '';
  return POPUP_FIELDS
    .map((field) => `${field.label}：${String(entry?.[field.key] || '').trim()}`)
    .join('\n');
}

function placementOn(shop, kind) {
  return String(shop?.[`${kind}_placed_on`] || '').trim();
}

function isPlaced(shop, kind) {
  return Boolean(placementOn(shop, kind) || shop?.[`${kind}_placed`]);
}

function formatMonthDay(dateKey) {
  const m = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${Number(m[2])}月${Number(m[3])}日`;
}

function nextPlacement(prevShop, todayYes, kind) {
  const today = todayDateKey();
  const prevOn = placementOn(prevShop, kind);
  const prevPlaced = isPlaced(prevShop, kind);
  if (todayYes) return { placed: true, on: today };
  if (prevOn === today) return { placed: false, on: '' };
  return { placed: prevPlaced, on: prevOn };
}

function placedToday(shop, kind, today = todayDateKey()) {
  return placementOn(shop, kind) === today;
}

function placementHintDate(draft, kind) {
  const today = todayDateKey();
  const stored = placementOn(draft, kind);
  const todayYes = Boolean(draft?.[`${kind}_today`]);
  if (todayYes) return today;
  if (stored && stored !== today) return stored;
  return '';
}

function placementHint(draft, kind) {
  const dateText = formatMonthDay(placementHintDate(draft, kind));
  if (dateText) return `${dateText}已放`;
  if (isPlaced(draft, kind) && !draft?.[`${kind}_today`]) return '已放';
  return '';
}

function localDateKeyFromTimestamp(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  }
  if (typeof value.toDate === 'function') return todayDateKey(value.toDate());
  if (value instanceof Date) return todayDateKey(value);
  if (typeof value === 'number') return todayDateKey(new Date(value));
  if (typeof value === 'string') return todayDateKey(new Date(value));
  return '';
}

function isTierS(tier) {
  return tier === 'S';
}

function isTierAAPlus(tier) {
  return tier === 'A+' || tier === 'A';
}

function isTierSAPlus(tier) {
  return tier === 'S' || tier === 'A+';
}

function isTierAB(tier) {
  return tier === 'A' || tier === 'B';
}

function filterShopsByTier(shopList, tierFilter) {
  if (tierFilter === 'S') return shopList.filter((s) => isTierS(s.tier));
  if (tierFilter === 'aa') return shopList.filter((s) => isTierAAPlus(s.tier));
  return shopList;
}

function popupSessionsInRange(shop, start, end) {
  return normalizePopupNotes(shop)
    .filter((n) => popupHasContent(n) && isDateInRange(n.date, start, end))
    .length;
}

function popupVozolSalesInRange(shop, start, end) {
  return normalizePopupNotes(shop)
    .filter((n) => isDateInRange(n.date, start, end))
    .reduce((sum, n) => sum + (Number(n.vozol_buyers) || 0), 0);
}

function popupSoldInRange(shop, start, end, field) {
  return normalizePopupNotes(shop)
    .filter((n) => isDateInRange(n.date, start, end))
    .reduce((sum, n) => {
      const kitRaw = String(n.kit_sold ?? '').trim();
      const podRaw = String(n.pod_sold ?? '').trim();
      if (field === 'pod') return sum + (Number(podRaw) || 0);
      if (kitRaw !== '') return sum + (Number(kitRaw) || 0);
      if (podRaw === '') return sum + (Number(n.vozol_buyers) || 0);
      return sum;
    }, 0);
}

function computeTierMetrics(shopList, start, end) {
  return {
    storeCount: shopList.length,
    totalUnits: shopList.reduce((sum, s) => sum + unitsInRange(s, start, end), 0),
    testCaseCount: shopList.filter((s) => placementInRange(s, 'test_case', start, end)).length,
    sampleCount: shopList.filter((s) => placementInRange(s, 'sample', start, end)).length,
    popupSessions: shopList.reduce((sum, s) => sum + popupSessionsInRange(s, start, end), 0),
    popupVozolSales: shopList.reduce((sum, s) => sum + popupVozolSalesInRange(s, start, end), 0),
  };
}

function computeTierBreakdown(shopList, start, end) {
  return {
    s: computeTierMetrics(shopList.filter((s) => isTierS(s.tier)), start, end),
    aa: computeTierMetrics(shopList.filter((s) => isTierAAPlus(s.tier)), start, end),
  };
}

function isTierAPlus(tier) {
  return isTierS(tier) || isTierAAPlus(tier);
}

function isChainShop(shop) {
  return Boolean(shop?.is_chain) && Number(shop.chain_total_stores) >= CHAIN_MIN_STORES;
}

function calendarDateKey(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return localDateKeyFromTimestamp(value);
}

function isDateInRange(dateKey, start, end) {
  const date = calendarDateKey(dateKey);
  const from = calendarDateKey(start);
  const to = calendarDateKey(end);
  if (!date || !from || !to) return false;
  return date >= from && date <= to;
}

function monthStartKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function pct(count, total) {
  if (!total) return '0%';
  return `${Math.round((count / total) * 1000) / 10}%`;
}

function normalizeUnitsLog(shop) {
  const raw = shop?.units_log;
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw
    .map((e) => {
      const date = calendarDateKey(e.date) || String(e.date || '').trim();
      const hasSplit = (e.kit != null && e.kit !== '') || (e.pod != null && e.pod !== '');
      const kit = Number(e.kit);
      const pod = Number(e.pod);
      const units = Number(e.units) || 0;
      const kitN = Number.isFinite(kit) ? kit : 0;
      const podN = Number.isFinite(pod) ? pod : 0;
      return {
        date,
        kit: hasSplit ? kitN : units,
        pod: hasSplit ? podN : 0,
        units: hasSplit ? kitN + podN : units,
      };
    })
    .filter((e) => e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function todayUnitsValue(log, today = todayDateKey(), field = 'units') {
  const entry = normalizeUnitsLog({ units_log: log }).find((e) => e.date === today);
  if (!entry) return '';
  const value = Number(entry[field]) || 0;
  return value ? String(value) : '';
}

function mergeUnitsLog(existingLog, kitText, podText) {
  const today = todayDateKey();
  const kitRaw = String(kitText ?? '').trim();
  const podRaw = String(podText ?? '').trim();
  const withoutToday = normalizeUnitsLog({ units_log: existingLog }).filter((e) => e.date !== today);
  if (!kitRaw && !podRaw) return withoutToday;
  const kit = kitRaw === '' ? 0 : Number(kitRaw);
  const pod = podRaw === '' ? 0 : Number(podRaw);
  if (Number.isNaN(kit) || Number.isNaN(pod) || kit < 0 || pod < 0) return withoutToday;
  return [{ date: today, units: kit + pod, kit, pod }, ...withoutToday].slice(0, 365);
}

function draftUnitsLogEntries(draft) {
  return mergeUnitsLog(draft?.units_log, draft?.units_kit_today, draft?.units_pod_today)
    .filter((e) => (Number(e.kit) || 0) > 0 || (Number(e.pod) || 0) > 0 || (Number(e.units) || 0) > 0);
}

function canEditUnitsLog(profile, user, shop, members = []) {
  if (!profile || !shop) return false;
  const uid = user?.uid || profile.id;
  if (!uid) return false;
  const ownerId = shop.path_owner || shop.assigned_to || '';
  const assigneeId = shop.assigned_to || ownerId;
  if (!ownerId && !assigneeId) return true;
  if (profile.role === 'manager') {
    const shopTeam = shopTeamOf(shop, members) || normalizeTeamId(shop.team_id);
    return Boolean(shopTeam) && shopTeam === normalizeTeamId(profile.team_id);
  }
  return uid === ownerId || uid === assigneeId;
}

function withSyncedTodayUnits(draft, log) {
  const today = todayDateKey();
  const todayEntry = normalizeUnitsLog({ units_log: log }).find((e) => e.date === today);
  return {
    ...draft,
    units_log: normalizeUnitsLog({ units_log: log }),
    units_kit_today: todayEntry && (Number(todayEntry.kit) || 0) ? String(todayEntry.kit) : '',
    units_pod_today: todayEntry && (Number(todayEntry.pod) || 0) ? String(todayEntry.pod) : '',
  };
}

function applyUnitsLogEntry(draft, oldDate, next) {
  const today = todayDateKey();
  const nextDate = calendarDateKey(next?.date) || oldDate;
  const kitRaw = String(next?.kit ?? '').trim();
  const podRaw = String(next?.pod ?? '').trim();
  const kit = kitRaw === '' ? 0 : Number(kitRaw);
  const pod = podRaw === '' ? 0 : Number(podRaw);
  let log = draftUnitsLogEntries(draft).filter((e) => e.date !== oldDate && e.date !== nextDate);
  if (!Number.isNaN(kit) && !Number.isNaN(pod) && kit >= 0 && pod >= 0 && (kit > 0 || pod > 0) && nextDate) {
    log = [{ date: nextDate, kit, pod, units: kit + pod }, ...log]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 365);
  }
  const synced = withSyncedTodayUnits(draft, log);
  if (oldDate === today || nextDate === today) return synced;
  return { ...draft, units_log: synced.units_log };
}

function unitsInRange(shop, start, end, field = 'units') {
  return normalizeUnitsLog(shop)
    .filter((e) => isDateInRange(e.date, start, end))
    .reduce((sum, e) => sum + (Number(e[field]) || 0), 0);
}

function shopActivityDateKeys(shop) {
  const dates = new Set();
  const add = (value) => {
    const key = calendarDateKey(value);
    if (key) dates.add(key);
  };
  normalizeTrafficNotes(shop).forEach((n) => {
    if (n.text && n.date) add(n.date);
  });
  normalizePopupNotes(shop).forEach((n) => {
    if (popupHasContent(n) && n.date) add(n.date);
  });
  normalizeUnitsLog(shop).forEach((e) => {
    if (e.date) add(e.date);
  });
  ['sample', 'test_case'].forEach((kind) => {
    add(placementOn(shop, kind));
  });
  add(shop?.wholesale_found_on);
  return dates;
}

function shopWorkedInRange(shop, start, end) {
  for (const date of shopActivityDateKeys(shop)) {
    if (isDateInRange(date, start, end)) return true;
  }
  return false;
}

function shopActiveInRange(shop, start, end) {
  return shopWorkedInRange(shop, start, end);
}

function hasHistoryBefore(shop, dateKey) {
  if (!dateKey) return false;
  for (const date of shopActivityDateKeys(shop)) {
    if (date && date < dateKey) return true;
  }
  return false;
}

function shopVisitedInRange(shop, start, end) {
  return shopActiveInRange(shop, start, end);
}

function placementInRange(shop, kind, start, end) {
  const on = placementOn(shop, kind);
  return on ? isDateInRange(on, start, end) : false;
}

function matchesCooperationFilter(status, filter) {
  if (filter === 'all') return true;
  if (filter === 'willing') return status === 'visited' || status === 'follow_up';
  if (filter === 'sold_in') return status === 'visited';
  return status === filter;
}

function mappingTargetFor(headcount) {
  return Math.max(0, Number(headcount) || 0) * MAPPING_TARGET;
}

function computeAreaMetrics(shopList, start, end, headcount = 1) {
  const total = shopList.length;
  const visitedCount = shopList.filter((s) => shopVisitedInRange(s, start, end)).length;
  const mappedCount = visitedCount;
  const mappingTarget = mappingTargetFor(headcount);
  const aPlusCount = shopList.filter((s) => isTierAPlus(s.tier)).length;
  const soldInCount = shopList.filter((s) => s.status === 'visited').length;
  const sampleCount = shopList.filter((s) => placementInRange(s, 'sample', start, end)).length;
  const testCaseCount = shopList.filter((s) => placementInRange(s, 'test_case', start, end)).length;
  const totalUnits = shopList.reduce((sum, s) => sum + unitsInRange(s, start, end), 0);
  const popupSessions = shopList.reduce((sum, s) => sum + popupSessionsInRange(s, start, end), 0);
  const popupVozolSales = shopList.reduce((sum, s) => sum + popupVozolSalesInRange(s, start, end), 0);
  return {
    total,
    visitedCount,
    mappedCount,
    mappingTarget,
    mappedPct: pct(mappedCount, mappingTarget),
    aPlusCount,
    aPlusPct: pct(aPlusCount, total),
    sampleCount,
    testCaseCount,
    soldInCount,
    soldInPct: pct(soldInCount, total),
    totalUnits,
    popupSessions,
    popupVozolSales,
  };
}

const DAILY_METRIC_ROWS = [
  { key: 'visited', label: '跑店数量' },
  { key: 'revisit', label: '回访店铺数量' },
  { key: 'saVisited', label: '访店S/A+' },
  { key: 'saTestCase', label: '试抽盒投放' },
  { key: 'saSample', label: '样机投放' },
  { key: 'saDisplayCard', label: '硬台卡投放', blank: true },
  { key: 'saSoldIn', label: '自己卖进店铺数' },
  { key: 'saKit', label: '卖进数量-KIT' },
  { key: 'saPod', label: '卖进数量-POD' },
  { key: 'saPopup', label: '活动场次' },
  { key: 'saPopupKit', label: '活动卖出支数-KIT' },
  { key: 'saPopupPod', label: '活动卖出支数-POD' },
  { key: 'saContact', label: '决策人联系方式' },
  { key: 'abVisited', label: '访店A/B店铺' },
  { key: 'abTestCase', label: '试抽盒投放' },
  { key: 'abSample', label: '样机投放' },
  { key: 'abDisplayCard', label: '硬台卡投放', blank: true },
  { key: 'abSoldIn', label: '卖进店铺数' },
  { key: 'abKit', label: '卖进数量-KIT' },
  { key: 'abPod', label: '卖进数量-POD' },
  { key: 'abPopup', label: '活动场次' },
  { key: 'abPopupKit', label: '活动卖出支数-KIT' },
  { key: 'abPopupPod', label: '活动卖出支数-POD' },
  { key: 'abContact', label: '决策人联系方式' },
];

function computeGroupDayMetrics(shopList, start, end) {
  const worked = shopList.filter((s) => shopWorkedInRange(s, start, end));
  const soldIn = worked.filter((s) => unitsInRange(s, start, end) > 0).length;
  return {
    visited: worked.length,
    testCase: worked.filter((s) => placementInRange(s, 'test_case', start, end)).length,
    sample: worked.filter((s) => placementInRange(s, 'sample', start, end)).length,
    displayCard: worked.filter((s) => placementInRange(s, 'display_card', start, end)).length,
    soldIn,
    kit: worked.reduce((sum, s) => sum + unitsInRange(s, start, end, 'kit'), 0),
    pod: worked.reduce((sum, s) => sum + unitsInRange(s, start, end, 'pod'), 0),
    popup: worked.reduce((sum, s) => sum + popupSessionsInRange(s, start, end), 0),
    popupKit: worked.reduce((sum, s) => sum + popupSoldInRange(s, start, end, 'kit'), 0),
    popupPod: worked.reduce((sum, s) => sum + popupSoldInRange(s, start, end, 'pod'), 0),
    contact: worked.filter((s) => String(s.owner_name || '').trim() || String(s.phone || '').trim()).length,
  };
}

function computeDailyReportMetrics(shopList, start, end) {
  const worked = shopList.filter((s) => shopWorkedInRange(s, start, end));
  const revisit = worked.filter((s) => hasHistoryBefore(s, start)).length;
  const sa = computeGroupDayMetrics(shopList.filter((s) => isTierSAPlus(s.tier)), start, end);
  const ab = computeGroupDayMetrics(shopList.filter((s) => isTierAB(s.tier)), start, end);
  return {
    visited: worked.length,
    revisit,
    saVisited: sa.visited,
    saTestCase: sa.testCase,
    saSample: sa.sample,
    saDisplayCard: '',
    saSoldIn: sa.soldIn,
    saKit: sa.kit,
    saPod: sa.pod,
    saPopup: sa.popup,
    saPopupKit: sa.popupKit,
    saPopupPod: sa.popupPod,
    saContact: sa.contact,
    abVisited: ab.visited,
    abTestCase: ab.testCase,
    abSample: ab.sample,
    abDisplayCard: '',
    abSoldIn: ab.soldIn,
    abKit: ab.kit,
    abPod: ab.pod,
    abPopup: ab.popup,
    abPopupKit: ab.popupKit,
    abPopupPod: ab.popupPod,
    abContact: ab.contact,
  };
}

function memberName(member) {
  return member?.full_name || member?.email || member?.id || '';
}

function teamLabelOf(teamId) {
  const id = normalizeTeamId(teamId);
  return TEAM_LABEL[id] || '';
}

function shopTeamOf(shop, members) {
  const fromShop = normalizeTeamId(shop?.team_id);
  if (fromShop) return fromShop;
  const owner = members.find((m) => m.id === shop?.assigned_to);
  return normalizeTeamId(owner?.team_id);
}

function todayTouchedCount(shopList) {
  const today = todayDateKey();
  return shopList.filter((s) => shopActiveInRange(s, today, today)).length;
}

function groupMembersByTeam(members, profile, shops = []) {
  const sales = members.filter((m) => m.active && m.role !== 'manager');
  const regionId = profile?.role === 'manager' ? normalizeTeamId(profile.team_id) : '';
  const scoped = regionId ? sales.filter((m) => normalizeTeamId(m.team_id) === regionId) : sales;
  if (regionId === 'florida') {
    return FLORIDA_AREAS
      .map((area) => ({
        teamId: area.id,
        label: area.label,
        members: scoped.filter((m) => memberAreaId(m, shops) === area.id),
      }))
      .filter((g) => g.members.length);
  }
  if (regionId) {
    return [{
      teamId: regionId,
      label: TEAM_LABEL[regionId],
      members: scoped,
    }].filter((g) => g.members.length);
  }
  return TEAM_ORDER
    .map((teamId) => ({
      teamId,
      label: TEAM_LABEL[teamId],
      members: scoped.filter((m) => normalizeTeamId(m.team_id) === teamId),
    }))
    .filter((g) => g.members.length);
}

function applyShopFilters(list, { search, fTier, fStatus, fStarred, fCity, fSample, fTestCase, fAssignee, fCooperation, fSoldIn }) {
  const q = search.toLowerCase().trim();
  return list.filter((s) => {
    if (fTier !== 'all') {
      if (fTier === 'none' && s.tier) return false;
      if (fTier !== 'none' && s.tier !== fTier) return false;
    }
    if (fStatus !== 'all' && s.status !== fStatus) return false;
    if (fCooperation !== 'all' && !matchesCooperationFilter(s.status, fCooperation)) return false;
    if (fSoldIn === 'yes' && s.status !== 'visited') return false;
    if (fSoldIn === 'no' && s.status === 'visited') return false;
    if (fStarred === 'yes' && !s.starred) return false;
    if (fStarred === 'no' && s.starred) return false;
    if (fCity !== 'all' && s.city !== fCity) return false;
    if (fSample === 'yes' && !isPlaced(s, 'sample')) return false;
    if (fSample === 'no' && isPlaced(s, 'sample')) return false;
    if (fTestCase === 'yes' && !isPlaced(s, 'test_case')) return false;
    if (fTestCase === 'no' && isPlaced(s, 'test_case')) return false;
    if (fAssignee !== 'all' && (s.assigned_to || '') !== fAssignee) return false;
    if (q && ![s.name, s.address, s.city, s.owner_name, s.phone, s.staff_contact].some((v) => (v || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function hasTrafficNoteOn(shop, dateKey) {
  return normalizeTrafficNotes(shop).some((n) => n.date === dateKey && n.text);
}

function buildDailyReportText(shopList, start = todayDateKey(), end = start) {
  const worked = shopList.filter((s) => shopWorkedInRange(s, start, end));
  const newShops = worked.filter((s) => !hasHistoryBefore(s, start));
  const revisit = worked.filter((s) => hasHistoryBefore(s, start)).length;
  const newAPlus = newShops.filter((s) => isTierAPlus(s.tier)).length;
  const sampleCount = shopList.filter((s) => placementInRange(s, 'sample', start, end)).length;
  const testCaseCount = shopList.filter((s) => placementInRange(s, 'test_case', start, end)).length;
  const kit = shopList.reduce((sum, s) => sum + unitsInRange(s, start, end, 'kit'), 0);
  const pod = shopList.reduce((sum, s) => sum + unitsInRange(s, start, end, 'pod'), 0);
  const dateLine = start === end ? `日期：${start}` : `日期：${start} 至 ${end}`;
  return [
    dateLine,
    `新店：${newShops.length}`,
    `新店中 A 级及以上：${newAPlus}`,
    `回访：${revisit}`,
    `样机投放数量：${sampleCount}`,
    `试抽盒投放数量：${testCaseCount}`,
    `卖进 KIT：${kit}`,
    `卖进 POD：${pod}`,
    '遇到的问题',
    '',
  ].join('\n');
}

const CSV_EXPORT_HEADERS = [
  '人员',
  '店铺名称',
  '地址',
  '店铺类型',
  'VISIT DATE 最近3次日期',
  '店铺数量（连锁店标注店铺数量，单店填1）',
  '评级/Ranking（S,A+,A,B)s>60pcs/daily,A+>40pcs daily,A>30pcs/dailyB<30PCS/DAILY',
  '老板/采购/Decision maker',
  '电话/Phone',
  '卖进情况（已卖进/待跟进/拒绝/寄售）',
  '合作意愿（愿意拿货-极高，有兴趣进一步了解/愿意放试抽盒-高，只要样机-中，没兴趣-低）',
  '店铺基础信息',
  '是否留样机',
  '是否放试抽盒',
  '主要拿货二级/Main distros to Purchase',
  'POP UP Situation\u00a0\n1、flow of people\n2、How many people buy vapes\n3、How many people buy VOZOL products（带日期，保留最近两次记录）',
];
const SELL_STATUS_CSV = {
  visited: '已卖进',
  follow_up: '待跟进',
  no_interest: '拒绝',
  not_visited: '',
};

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function formatCsvVisitDate(dateKey) {
  const m = String(dateKey || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return '';
  return `${Number(m[1])}/${Number(m[2])}/${Number(m[3])}`;
}

function exportStoreCount(shop) {
  const chainCount = Number(shop?.chain_total_stores);
  if (Number.isFinite(chainCount) && chainCount > 0) return String(chainCount);
  const m = String(shop?.store_number || '').match(/(\d+)/);
  if (m) return m[1];
  return '1';
}

function exportSellStatus(shop) {
  const restock = String(shop?.restock_status || '').trim();
  if (['已卖进', '待跟进', '拒绝', '寄售'].includes(restock)) return restock;
  return SELL_STATUS_CSV[shop?.status] || '';
}

function cooperationLevel(shop) {
  const restock = String(shop?.restock_status || '').trim();
  if (shop?.status === 'no_interest' || restock === '拒绝') return '低';
  if (shop?.status === 'visited' || restock === '已卖进') return '极高';
  if (isPlaced(shop, 'test_case')) return '高';
  if (isPlaced(shop, 'sample')) return '中';
  return '中';
}

function exportCooperation(shop) {
  return cooperationLevel(shop);
}

function exportVisitDateCell(shop) {
  const dates = [];
  const push = (key) => {
    const formatted = formatCsvVisitDate(key);
    if (formatted && !dates.includes(formatted)) dates.push(formatted);
  };
  normalizeTrafficNotes(shop).forEach((n) => push(n.date));
  push(shopUpdatedDateKey(shop));
  push(shopCreatedDateKey(shop));
  return dates.slice(0, 3).join(', ');
}

function exportShopInfo(shop) {
  return normalizeTrafficNotes(shop).map((n) => n.text).join('\n');
}

function exportPopupNotes(shop) {
  return normalizePopupNotes(shop)
    .slice(0, MAX_POPUP_NOTES)
    .map((n) => {
      const date = formatCsvVisitDate(n.date);
      const body = formatPopupNoteText(n);
      return date ? `${date}\n${body}` : body;
    })
    .join('\n\n');
}

function shopToCsvRow(shop, personName) {
  return [
    personName || '',
    shop.name || '',
    shop.address || '',
    shop.shop_type || 'smoke shop',
    exportVisitDateCell(shop),
    exportStoreCount(shop),
    shop.tier || '',
    shop.owner_name || '',
    shop.phone || '',
    exportSellStatus(shop),
    exportCooperation(shop),
    exportShopInfo(shop),
    isPlaced(shop, 'sample') ? '是' : '否',
    isPlaced(shop, 'test_case') ? '试抽盒' : '否',
    shop.distributor || '',
    exportPopupNotes(shop),
  ];
}

function buildShopsCsv(shopList, personName) {
  const lines = [
    CSV_EXPORT_HEADERS.map(csvEscape).join(','),
    ...shopList.map((shop) => shopToCsvRow(shop, personName).map(csvEscape).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

function sanitizeFilename(name) {
  return String(name || 'export').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'export';
}

function downloadTextFile(filename, content) {
  const blob = new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dailyPersonLabel(person, people) {
  const dup = people.filter((p) => p.name === person.name).length > 1;
  if (dup && person.teamLabel) return `${person.name}（${person.teamLabel}）`;
  return person.name;
}

function buildDailyPeopleColumns(shops, members, startKey, endKey, profile) {
  const start = calendarDateKey(startKey);
  const end = calendarDateKey(endKey);
  if (!start || !end || start > end) return [];
  return buildPeopleMetricColumns(shops, members, profile, (shopList) => (
    computeDailyReportMetrics(shopList, start, end)
  ));
}

function dailyMetricCell(metrics, row) {
  if (row?.blank || row?.key === 'saDisplayCard' || row?.key === 'abDisplayCard') return '';
  const key = typeof row === 'string' ? row : row?.key;
  return metrics?.[key] ?? 0;
}

function buildDailySummaryCsv(columns, startKey, endKey) {
  const rangeLabel = startKey === endKey ? startKey : `${startKey} 至 ${endKey}`;
  const header = ['指标', ...columns.map((col) => col.name)].map(csvEscape).join(',');
  const rows = DAILY_METRIC_ROWS.map((row) => (
    [row.label, ...columns.map((col) => dailyMetricCell(col.metrics, row))].map(csvEscape).join(',')
  ));
  return [`日期,${csvEscape(rangeLabel)}`, header, ...rows].join('\r\n') + '\r\n';
}

const CUMULATIVE_METRIC_ROWS = [
  { key: 'totalShops', label: '总店铺数' },
  { key: 'soldInShops', label: '总卖进店铺数量' },
  { key: 'entryRate', label: '进店率' },
  { key: 'sCount', label: 'S级店铺数' },
  { key: 'sSoldIn', label: 'S级店铺卖进' },
  { key: 'aPlusCount', label: 'A+级店铺数' },
  { key: 'aPlusSoldIn', label: 'A+级店铺卖进' },
  { key: 'abCount', label: 'A/B级店铺数' },
  { key: 'abSoldIn', label: 'A/B级店铺卖进' },
];

function shopSoldInCumulative(shop) {
  if (shop?.status === 'visited') return true;
  if (shop?.wholesale_in_store || calendarDateKey(shop?.wholesale_found_on)) return true;
  return normalizeUnitsLog(shop).some((e) => (Number(e.units) || 0) > 0);
}

function isTierAPlusOnly(tier) {
  return tier === 'A+';
}

function computeCumulativeReportMetrics(shopList) {
  const totalShops = shopList.length;
  const soldInShops = shopList.filter(shopSoldInCumulative).length;
  const sShops = shopList.filter((s) => isTierS(s.tier));
  const aPlusShops = shopList.filter((s) => isTierAPlusOnly(s.tier));
  const abShops = shopList.filter((s) => isTierAB(s.tier));
  return {
    totalShops,
    soldInShops,
    entryRate: pct(soldInShops, totalShops),
    sCount: sShops.length,
    sSoldIn: sShops.filter(shopSoldInCumulative).length,
    aPlusCount: aPlusShops.length,
    aPlusSoldIn: aPlusShops.filter(shopSoldInCumulative).length,
    abCount: abShops.length,
    abSoldIn: abShops.filter(shopSoldInCumulative).length,
  };
}

function buildPeopleMetricColumns(shops, members, profile, metricsForShops) {
  const sales = profile?.role === 'manager'
    ? members.filter((m) => m.active && m.role !== 'manager' && normalizeTeamId(m.team_id) === normalizeTeamId(profile.team_id))
    : members.filter((m) => m.id === profile?.id);
  const listed = new Set();
  const people = [];
  const pushMember = (m) => {
    if (!m?.id || listed.has(m.id)) return;
    listed.add(m.id);
    const teamId = normalizeTeamId(m.team_id);
    const areaId = memberAreaId(m, shops);
    people.push({
      id: m.id,
      name: memberName(m),
      teamId,
      teamLabel: areaLabelOf(areaId) || teamLabelOf(teamId),
      metrics: metricsForShops(shops.filter((s) => s.assigned_to === m.id)),
    });
  };
  const regionId = normalizeTeamId(profile?.team_id);
  if (regionId === 'florida') {
    FLORIDA_AREAS.forEach((area) => {
      sales.filter((m) => memberAreaId(m, shops) === area.id).forEach(pushMember);
    });
  }
  sales.forEach(pushMember);
  return people.map((person) => ({
    id: person.id,
    name: dailyPersonLabel(person, people),
    metrics: person.metrics,
  }));
}

function buildCumulativePeopleColumns(shops, members, profile) {
  return buildPeopleMetricColumns(shops, members, profile, computeCumulativeReportMetrics);
}

function buildCumulativeSummaryCsv(columns) {
  const header = ['指标', ...columns.map((col) => col.name)].map(csvEscape).join(',');
  const rows = CUMULATIVE_METRIC_ROWS.map((row) => (
    [row.label, ...columns.map((col) => dailyMetricCell(col.metrics, row))].map(csvEscape).join(',')
  ));
  return [`范围,从开始至今`, header, ...rows].join('\r\n') + '\r\n';
}

function sortShops(list, sortBy) {
  const items = [...list];
  switch (sortBy) {
    case 'created_at':
      return items.sort((a, b) => timeValue(b.created_at) - timeValue(a.created_at));
    case 'next_follow_up':
      return items.sort((a, b) => {
        const diff = nextFollowUpValue(a) - nextFollowUpValue(b);
        return diff || (a.name || '').localeCompare(b.name || '');
      });
    case 'tier':
      return items.sort((a, b) => {
        const diff = tierRank(a.tier) - tierRank(b.tier);
        return diff || (a.name || '').localeCompare(b.name || '');
      });
    case 'starred':
      return items.sort((a, b) => {
        const diff = Number(b.starred) - Number(a.starred);
        return diff || timeValue(b.updated_at) - timeValue(a.updated_at);
      });
    case 'updated_at':
    default:
      return items.sort((a, b) => timeValue(b.updated_at) - timeValue(a.updated_at));
  }
}

function withoutUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function readErrorMessage(error) {
  const code = error?.code || '';
  if (code.includes('permission-denied')) {
    return 'Firestore 拒绝写入档案。请刷新后再试；若仍失败，确认已把仓库里的 firestore.rules 发布到规则页。';
  }
  if (code.includes('unavailable') || code.includes('not-found')) {
    return '连不上 Firestore。请在 Firebase 控制台创建 Firestore 数据库后再刷新。';
  }
  return error?.message || '加载失败';
}

function shopsCollection(userId) {
  return collection(db, 'profiles', userId, 'shops');
}

function shopDoc(userId, shopId) {
  return doc(db, 'profiles', userId, 'shops', shopId);
}

function shopFromSnap(item) {
  const data = item.data();
  const pathOwner = item.ref.parent?.parent?.id || data.assigned_to;
  return {
    id: item.id,
    ...data,
    path_owner: pathOwner,
    assigned_to: pathOwner || data.assigned_to,
    team_id: normalizeTeamId(data.team_id) || String(data.team_id || '').trim(),
    area_id: normalizeAreaId(data.area_id || data.team_id, data.city),
  };
}

let pendingSignupName = '';
let pendingSignupTeam = '';

function authEmailOf(user) {
  return user.email
    || user.providerData?.find((p) => p.email)?.email
    || '';
}

async function ensureProfile(user) {
  const ref = doc(db, 'profiles', user.uid);
  const email = authEmailOf(user);
  const fullName = (pendingSignupName || user.displayName || email.split('@')[0] || '未命名').trim();
  const teamId = normalizeTeamId(pendingSignupTeam);
  pendingSignupName = '';
  pendingSignupTeam = '';

  let snap;
  try {
    snap = await getDoc(ref);
  } catch {
    snap = null;
  }
  if (snap?.exists()) {
    const data = snap.data();
    return { ...data, id: snap.id, team_id: normalizeTeamId(data.team_id) || data.team_id, area_id: normalizeAreaId(data.area_id || data.team_id, data.city) };
  }

  if (!teamId) return { needsRegion: true };

  try {
    await user.getIdToken(true);
  } catch {
    // token refresh is best-effort; profile create no longer depends on token email
  }

  const profile = {
    full_name: fullName || '未命名',
    email,
    role: 'sales',
    team_id: teamId,
    active: true,
  };
  await setDoc(ref, profile);
  return { id: user.uid, ...profile };
}

async function migrateLegacyShops(currentUser, profile, members) {
  let snap;
  try {
    const shopQuery = profile.role === 'manager'
      ? collection(db, 'shops')
      : query(collection(db, 'shops'), where('assigned_to', '==', currentUser.uid));
    snap = await getDocs(shopQuery);
  } catch {
    return;
  }
  if (snap.empty) return;

  const memberIds = new Set(members.map((m) => m.id));
  memberIds.add(currentUser.uid);

  await Promise.all(snap.docs.map(async (item) => {
    const data = item.data();
    let ownerId = data.assigned_to;
    if (!ownerId || !memberIds.has(ownerId)) ownerId = currentUser.uid;
    if (profile.role !== 'manager') ownerId = currentUser.uid;

    const destRef = shopDoc(ownerId, item.id);
    try {
      const destSnap = await getDoc(destRef);
      const visitsSnap = await getDocs(collection(item.ref, 'visits'));
      const batch = writeBatch(db);
      if (!destSnap.exists()) {
        batch.set(destRef, {
          ...data,
          assigned_to: ownerId,
          team_id: data.team_id || profile.team_id,
        });
        visitsSnap.docs.forEach((visit) => {
          batch.set(doc(destRef, 'visits', visit.id), visit.data());
        });
      }
      visitsSnap.docs.forEach((visit) => batch.delete(visit.ref));
      batch.delete(item.ref);
      await batch.commit();
    } catch (error) {
      console.warn('migrate shop failed', item.id, error);
    }
  }));
}

async function fetchTeamData(currentUser) {
  const p = await withTimeout(
    ensureProfile(currentUser),
    20000,
    '读取账号超时。请刷新页面，或检查网络是否拦截了 Firestore。',
  );
  if (p.needsRegion) return { needsRegion: true, profile: null, shops: [], members: [] };
  let members = [];
  if (p.role === 'manager') {
    let memberSnap;
    try {
      memberSnap = await getDocs(collection(db, 'profiles'));
    } catch {
      memberSnap = await getDocs(query(collection(db, 'profiles'), where('team_id', '==', p.team_id)));
    }
    members = memberSnap.docs
      .map((item) => {
        const data = item.data();
        return { id: item.id, ...data, team_id: normalizeTeamId(data.team_id) || data.team_id, area_id: normalizeAreaId(data.area_id || data.team_id, data.city) };
      })
      .sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''));
  }

  await migrateLegacyShops(currentUser, p, members);

  const ownerIds = p.role === 'manager'
    ? [...new Set([currentUser.uid, ...members.map((m) => m.id)])]
    : [currentUser.uid];
  const shopSnaps = await withTimeout(
    Promise.all(ownerIds.map(async (id) => {
      try {
        return await getDocs(shopsCollection(id));
      } catch {
        return { docs: [] };
      }
    })),
    20000,
    '读取门店超时。多半是浏览器连不上 Firestore，请硬刷新后再试；若仍失败，换 Chrome 打开同一网址。',
  );
  const shops = shopSnaps.flatMap((shopSnap) => shopSnap.docs.map(shopFromSnap));
  return { profile: p, shops, members };
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.8-6.7 7.5l6.3 5.3C37.3 38.3 44 33 44 24c0-1.3-.1-2.5-.4-3.5z" />
    </svg>
  );
}

function Login() {
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';
  const pwdIssues = signup ? passwordIssues(password) : [];

  const switchMode = (next) => {
    setMode(next);
    setErr('');
    setConfirm('');
    setTeamId('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (signup) {
      const name = fullName.trim();
      if (!name) {
        setErr('请填写姓名');
        return;
      }
      if (!normalizeTeamId(teamId)) {
        setErr('请选择地区');
        return;
      }
      if (pwdIssues.length) {
        setErr(`密码${pwdIssues.join('，')}`);
        return;
      }
      if (password !== confirm) {
        setErr('两次输入的密码不一致');
        return;
      }
    }
    setBusy(true);
    try {
      if (signup) {
        pendingSignupName = fullName.trim();
        pendingSignupTeam = normalizeTeamId(teamId);
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: fullName.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (error) {
      pendingSignupName = '';
      pendingSignupTeam = '';
      setErr(authMessage(error, mode));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setErr('');
    if (signup && !normalizeTeamId(teamId)) {
      setErr('请先选择地区');
      return;
    }
    setBusy(true);
    try {
      if (signup) {
        pendingSignupName = fullName.trim();
        pendingSignupTeam = normalizeTeamId(teamId);
      }
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      pendingSignupName = '';
      pendingSignupTeam = '';
      if (error?.code === 'auth/account-exists-with-different-credential') {
        const existing = error.customData?.email;
        setErr(existing
          ? `这个 Google 账号（${existing}）已经用邮箱密码注册过，请改用邮箱登录。`
          : '这个 Google 账号已经用邮箱密码注册过，请改用邮箱登录。');
      } else {
        setErr(authMessage(error, mode));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="panel" onSubmit={submit}>
        <h1>门店拜访清单</h1>
        <p>{TEAM_SUBTITLE} · {signup ? '创建账号' : 'Firebase 云端版'}</p>
        {!signup && (
          <>
            <button className="google" type="button" onClick={google} disabled={busy}>
              <GoogleMark /> 使用 Google 账号登录
            </button>
            <div className="or">或使用邮箱密码</div>
          </>
        )}
        {signup && (
          <>
            <label>
              姓名
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
              />
            </label>
            <label>
              地区
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
                <option value="">请选择</option>
                {TEAM_ORDER.map((id) => (
                  <option key={id} value={id}>{TEAM_LABEL[id]}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          邮箱
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
          />
        </label>
        <label>
          密码
          <PasswordField
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'}
            minLength={signup ? MIN_PASSWORD_LENGTH : undefined}
            required
          />
        </label>
        {signup && (
          <>
            <div className={password && pwdIssues.length ? 'hint bad' : 'hint'}>
              至少 {MIN_PASSWORD_LENGTH} 位，需同时包含字母和数字
            </div>
            <label>
              确认密码
              <PasswordField
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </label>
          </>
        )}
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy}>
          {busy ? (signup ? '创建中…' : '登录中…') : (signup ? '创建账号' : '登录')}
        </button>
        {signup && (
          <>
            <div className="or">或</div>
            <button className="google" type="button" onClick={google} disabled={busy}>
              <GoogleMark /> 使用 Google 账号创建
            </button>
          </>
        )}
        <button className="auth-switch" type="button" onClick={() => switchMode(signup ? 'login' : 'signup')}>
          {signup ? '已有账号？去登录' : '没有账号？创建账号'}
        </button>
      </form>
    </main>
  );
}

function RegionGate({ user, onDone }) {
  const [teamId, setTeamId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const team = normalizeTeamId(teamId);
    if (!team) {
      setErr('请选择地区');
      return;
    }
    setErr('');
    setBusy(true);
    pendingSignupTeam = team;
    pendingSignupName = user.displayName || '';
    try {
      const data = await fetchTeamData(user);
      if (data.needsRegion) {
        setErr('请选择地区后再继续');
        return;
      }
      onDone(data);
    } catch (error) {
      pendingSignupTeam = '';
      setErr(readErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="panel" onSubmit={submit}>
        <h1>选择地区</h1>
        <p>首次登录请选择 {teamChoiceHint()}</p>
        <label>
          地区
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
            <option value="">请选择</option>
            {TEAM_ORDER.map((id) => (
              <option key={id} value={id}>{TEAM_LABEL[id]}</option>
            ))}
          </select>
        </label>
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy}>
          {busy ? '保存中…' : '继续'}
        </button>
        <button className="auth-switch" type="button" onClick={() => signOut(auth)}>退出登录</button>
      </form>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [shops, setShops] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [fTier, setFTier] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [fCooperation, setFCooperation] = useState('all');
  const [fSoldIn, setFSoldIn] = useState('all');
  const [fStarred, setFStarred] = useState('all');
  const [fCity, setFCity] = useState('all');
  const [fSample, setFSample] = useState('all');
  const [fTestCase, setFTestCase] = useState('all');
  const [fAssignee, setFAssignee] = useState('all');
  const [focusedMemberId, setFocusedMemberId] = useState('');
  const [dashFrom, setDashFrom] = useState(() => monthStartKey());
  const [dashTo, setDashTo] = useState(() => todayDateKey());
  const [dashTierFilter, setDashTierFilter] = useState('all');
  const [dashTab, setDashTab] = useState('stats');
  const [dailyFrom, setDailyFrom] = useState(() => todayDateKey());
  const [dailyTo, setDailyTo] = useState(() => todayDateKey());
  const [dailyReportText, setDailyReportText] = useState('');
  const [dailyCopied, setDailyCopied] = useState(false);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reportText, setReportText] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('list');
  const [hoveredShopId, setHoveredShopId] = useState(null);
  const [geocodeNote, setGeocodeNote] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [dailyReportOpen, setDailyReportOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState('today');
  const [exportDate, setExportDate] = useState(() => todayDateKey());
  const [needsRegion, setNeedsRegion] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [unitsLogOpen, setUnitsLogOpen] = useState(false);

  useEffect(() => {
    if (!configured || !auth) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, async (next) => {
      setUser(next);
      if (!next) {
        setProfile(null);
        setShops([]);
        setMembers([]);
        setNeedsRegion(false);
        setLoadError('');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError('');
      try {
        const data = await fetchTeamData(next);
        if (cancelled) return;
        if (data.needsRegion) {
          setNeedsRegion(true);
          setProfile(null);
          setShops([]);
          setMembers([]);
        } else {
          setNeedsRegion(false);
          setProfile(data.profile);
          setShops(data.shops);
          setMembers(data.members);
        }
      } catch (error) {
        if (cancelled) return;
        setLoadError(readErrorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, (error) => {
      setLoadError(readErrorMessage(error));
      setLoading(false);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const shopsRef = useRef(shops);
  shopsRef.current = shops;

  useEffect(() => {
    if (!user || !shops.length) {
      setGeocodeNote('');
      return undefined;
    }
    let cancelled = false;
    const attempted = new Set();
    (async () => {
      while (!cancelled) {
        const pending = shopsRef.current.filter((s) => {
          if (attempted.has(s.id)) return false;
          const { state } = resolveCityContext(s);
          return needsGeocode(s, { state });
        });
        if (!pending.length) {
          if (!cancelled) setGeocodeNote('');
          break;
        }
        setGeocodeNote(`正在按地址重新定位 ${pending.length} 家…`);
        const shop = pending[0];
        attempted.add(shop.id);
        const { pool, state } = resolveCityContext(shop);
        let coords = null;
        try {
          coords = await geocodeAddress(geocodeQuery(shop, { state }), shop, { knownCities: pool, state });
        } catch {
          coords = null;
        }
        if (cancelled) return;
        const queryText = geocodeQuery(shop, { state });
        const patch = coords
          ? {
            lat: coords.lat,
            lng: coords.lng,
            ...(coords.city ? { city: coords.city } : {}),
            geocode_query: queryText,
            geocode_failed: false,
            geocode_version: GEOCODE_VERSION,
          }
          : {
            lat: null,
            lng: null,
            geocode_query: queryText,
            geocode_failed: true,
            geocode_version: GEOCODE_VERSION,
          };
        try {
          if (shop.path_owner || shop.assigned_to) {
            await updateDoc(shopDoc(shop.path_owner || shop.assigned_to, shop.id), patch);
          }
        } catch {
          // still cache locally so this session does not retry forever
        }
        if (!cancelled) {
          setShops((prev) => prev.map((s) => (s.id === shop.id ? { ...s, ...patch } : s)));
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, shops.length]);

  useEffect(() => {
    if (!user) return undefined;
    const today = todayDateKey();
    const overdue = shops.filter((s) => isNextPlanOverdue(s, today));
    if (!overdue.length) return undefined;
    let cancelled = false;
    setShops((prev) => prev.map((s) => (
      isNextPlanOverdue(s, today) ? { ...s, ...CLEARED_NEXT_PLAN } : s
    )));
    setDraft((d) => (d && isNextPlanOverdue(d, today) ? { ...d, ...CLEARED_NEXT_PLAN } : d));
    (async () => {
      const chunkSize = 400;
      for (let i = 0; i < overdue.length; i += chunkSize) {
        if (cancelled) return;
        const chunk = overdue.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        let writes = 0;
        chunk.forEach((shop) => {
          const owner = shop.path_owner || shop.assigned_to;
          if (!owner) return;
          batch.update(shopDoc(owner, shop.id), CLEARED_NEXT_PLAN);
          writes += 1;
        });
        if (!writes) continue;
        try {
          await batch.commit();
        } catch {
          // local state already cleared
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, shops]);

  async function loadAll(currentUser = user) {
    if (!currentUser) return;
    setLoading(true);
    setLoadError('');
    try {
      const data = await fetchTeamData(currentUser);
      if (data.needsRegion) {
        setNeedsRegion(true);
        setProfile(null);
        setShops([]);
        setMembers([]);
      } else {
        setNeedsRegion(false);
        setProfile(data.profile);
        setShops(data.shops);
        setMembers(data.members);
      }
    } catch (error) {
      setLoadError(readErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function openShop(shop) {
    const notes = normalizeTrafficNotes(shop);
    const popups = normalizePopupNotes(shop);
    const todayPopup = todayPopupEntry(popups);
    const today = todayDateKey();
    setSelected(shop.id);
    setDraft({
      ...shop,
      chain_total_stores: shop.chain_total_stores ?? '',
      chain_a_plus_count: shop.chain_a_plus_count ?? '',
      is_chain: Boolean(shop.is_chain),
      next_plan_date: shop.next_plan_date || '',
      next_plan_time: shop.next_plan_time || '',
      starred: Boolean(shop.starred),
      test_case_placed: isPlaced(shop, 'test_case'),
      sample_placed: isPlaced(shop, 'sample'),
      display_card_placed: isPlaced(shop, 'display_card'),
      test_case_placed_on: placementOn(shop, 'test_case'),
      sample_placed_on: placementOn(shop, 'sample'),
      display_card_placed_on: placementOn(shop, 'display_card'),
      test_case_today: placedToday(shop, 'test_case', today),
      sample_today: placedToday(shop, 'sample', today),
      display_card_today: placedToday(shop, 'display_card', today),
      traffic_notes: notes,
      traffic_note: todayNoteText(notes),
      popup_notes: popups,
      popup_date: today,
      popup_flow: todayPopup.flow,
      popup_vape_buyers: todayPopup.vape_buyers,
      popup_vozol_buyers: todayPopup.vozol_buyers,
      popup_kit_sold: todayPopup.kit_sold,
      popup_pod_sold: todayPopup.pod_sold,
      units_log: normalizeUnitsLog(shop),
      units_kit_today: todayUnitsValue(normalizeUnitsLog(shop), today, 'kit'),
      units_pod_today: todayUnitsValue(normalizeUnitsLog(shop), today, 'pod'),
    });
    setReportText('');
    setCopied(false);
    setPopupOpen(false);
    setUnitsLogOpen(false);
  }

  async function toggleStar(shop, e) {
    e?.stopPropagation?.();
    const next = !shop.starred;
    try {
      await updateDoc(shopDoc(shop.path_owner || shop.assigned_to || profile.id, shop.id), {
        starred: next,
        updated_at: serverTimestamp(),
      });
      setShops((prev) => prev.map((s) => (s.id === shop.id ? { ...s, starred: next, updated_at: new Date() } : s)));
      if (selected === shop.id && draft) setDraft({ ...draft, starred: next });
    } catch (error) {
      alert(error.message);
    }
  }

  function resolveCityContext(draftLike) {
    let teamId = profile?.team_id;
    if (profile?.role === 'manager') {
      const assignee = draftLike?.assigned_to || focusedMemberId || profile.id;
      const member = members.find((m) => m.id === assignee);
      if (member?.team_id) teamId = member.team_id;
    }
    return {
      pool: teamCityPool(teamId),
      fallback: defaultCity(teamId),
      state: teamStateOf(teamId),
    };
  }

  function assignShopTo(draftLike, assigneeId) {
    const nextTeam = normalizeTeamId(members.find((m) => m.id === assigneeId)?.team_id)
      || normalizeTeamId(draftLike.team_id)
      || normalizeTeamId(profile?.team_id);
    const pool = teamCityPool(nextTeam);
    const fallback = pool.includes(draftLike.city) ? draftLike.city : defaultCity(nextTeam);
    const city = detectCityFromAddress(draftLike.address, { knownCities: pool, fallback });
    return { ...draftLike, assigned_to: assigneeId, team_id: nextTeam, city };
  }

  function openNew() {
    const shop = emptyShop(profile?.team_id);
    if (profile?.role === 'manager') {
      const member = members.find((m) => m.id === (focusedMemberId || profile.id));
      shop.assigned_to = member?.id || profile.id;
      if (member?.team_id) shop.team_id = normalizeTeamId(member.team_id) || shop.team_id;
    }
    setSelected('new');
    setDraft(shop);
    setReportText('');
    setCopied(false);
    setPopupOpen(false);
    setUnitsLogOpen(false);
  }

  async function saveShop() {
    if (!draft.name.trim() || saving) return;
    const chainStores = Number(draft.chain_total_stores);
    const chainAPlus = Number(draft.chain_a_plus_count);
    if (draft.is_chain) {
      if (!Number.isFinite(chainStores) || chainStores < CHAIN_MIN_STORES) {
        alert(`连锁店至少 ${CHAIN_MIN_STORES} 家`);
        return;
      }
      if (!Number.isFinite(chainAPlus) || chainAPlus < 0 || chainAPlus > chainStores) {
        alert('A 级店铺数量需在 0 到连锁店总数之间');
        return;
      }
    }
    const nextPlanText = formatNextPlan(draft);
    const prevShop = selected === 'new' ? draft : (shops.find((s) => s.id === selected) || draft);
    const existingNotes = normalizeTrafficNotes(prevShop);
    const nextNotes = serializeTrafficNotes(mergeTrafficNotes(existingNotes, draft.traffic_note));
    const existingPopups = normalizePopupNotes(prevShop);
    const nextPopups = serializePopupNotes(mergePopupNotes(existingPopups, {
      flow: draft.popup_flow,
      vape_buyers: draft.popup_vape_buyers,
      vozol_buyers: draft.popup_vozol_buyers,
      kit_sold: draft.popup_kit_sold,
      pod_sold: draft.popup_pod_sold,
    }, draft.popup_date || todayDateKey()));
    const testNext = nextPlacement(prevShop, draft.test_case_today, 'test_case');
    const sampleNext = nextPlacement(prevShop, draft.sample_today, 'sample');
    const cardNext = nextPlacement(prevShop, draft.display_card_today, 'display_card');
    const nextUnitsLog = mergeUnitsLog(normalizeUnitsLog(draft), draft.units_kit_today, draft.units_pod_today);
    const payload = withoutUndefined({
      ...draft,
      name: draft.name.trim(),
      is_chain: Boolean(draft.is_chain),
      chain_total_stores: draft.is_chain ? chainStores : null,
      chain_a_plus_count: draft.is_chain ? chainAPlus : null,
      next_plan_date: isNextPlanOverdue(draft) ? '' : (draft.next_plan_date || ''),
      next_plan_time: isNextPlanOverdue(draft) || !draft.next_plan_date ? '' : (draft.next_plan_time || ''),
      next_plan: nextPlanText,
      traffic_notes: nextNotes,
      traffic_note: nextNotes[0]?.text || '',
      popup_notes: nextPopups,
      units_log: nextUnitsLog,
      test_case_placed: testNext.placed,
      test_case_placed_on: testNext.on,
      sample_placed: sampleNext.placed,
      sample_placed_on: sampleNext.on,
      display_card_placed: cardNext.placed,
      display_card_placed_on: cardNext.on,
    });
    delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;
    delete payload.test_case_today;
    delete payload.sample_today;
    delete payload.display_card_today;
    delete payload.wholesale_today;
    delete payload.wholesale_found_on;
    delete payload.wholesale_in_store;
    delete payload.units_today;
    delete payload.units_kit_today;
    delete payload.units_pod_today;
    delete payload.popup_flow;
    delete payload.popup_vape_buyers;
    delete payload.popup_vozol_buyers;
    delete payload.popup_kit_sold;
    delete payload.popup_pod_sold;
    delete payload.popup_date;
    const { pool, fallback, state } = resolveCityContext(payload);
    payload.city = detectCityFromAddress(payload.address, {
      knownCities: pool,
      fallback: String(payload.city || '').trim() || fallback,
    });
    setSaving(true);
    try {
      const geoQuery = geocodeQuery(payload, { state });
      const prevGeoShop = selected === 'new' ? null : shops.find((s) => s.id === selected);
      if (!geoQuery) {
        payload.lat = null;
        payload.lng = null;
        payload.geocode_query = '';
        payload.geocode_failed = false;
        payload.geocode_version = GEOCODE_VERSION;
      } else if (selected === 'new' || geoQuery !== geocodeQuery(prevGeoShop || {}, { state }) || prevGeoShop?.geocode_version !== GEOCODE_VERSION) {
        const coords = await geocodeAddress(geoQuery, payload, { knownCities: pool, state });
        if (coords) {
          payload.lat = coords.lat;
          payload.lng = coords.lng;
          payload.geocode_query = geoQuery;
          payload.geocode_failed = false;
          payload.geocode_version = GEOCODE_VERSION;
          if (coords.city) payload.city = coords.city;
        }
      }
      const isManagerUser = profile.role === 'manager';
      const ownerId = user?.uid || profile.id;
      const assigneeId = isManagerUser ? (draft.assigned_to || profile.id) : ownerId;
      const assigneeTeam = normalizeTeamId(members.find((m) => m.id === assigneeId)?.team_id)
        || normalizeTeamId(profile.team_id)
        || 'florida';
      payload.assigned_to = assigneeId;
      payload.team_id = assigneeTeam;
      if (assigneeTeam === 'florida') {
        payload.area_id = cityToFloridaArea(payload.city)
          || normalizeAreaId(members.find((m) => m.id === assigneeId)?.area_id)
          || '';
      }
      if (selected === 'new') {
        const ref = await addDoc(shopsCollection(ownerId), {
          ...payload,
          assigned_to: ownerId,
          team_id: assigneeTeam,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
        setShops((prev) => [{ id: ref.id, ...payload, assigned_to: ownerId, team_id: assigneeTeam, path_owner: ownerId, created_at: new Date(), updated_at: new Date() }, ...prev]);
      } else {
        const current = shops.find((s) => s.id === selected);
        const pathOwner = isManagerUser
          ? (current?.path_owner || current?.assigned_to || profile.id)
          : ownerId;
        const newOwner = isManagerUser ? (payload.assigned_to || pathOwner) : ownerId;
        payload.assigned_to = newOwner;
        payload.team_id = isManagerUser
          ? (normalizeTeamId(members.find((m) => m.id === newOwner)?.team_id) || normalizeTeamId(current?.team_id) || assigneeTeam)
          : (normalizeTeamId(current?.team_id) || assigneeTeam);
        if (payload.team_id === 'florida') {
          payload.area_id = cityToFloridaArea(payload.city)
            || normalizeAreaId(members.find((m) => m.id === payload.assigned_to)?.area_id)
            || current?.area_id
            || '';
        }
        if (isManagerUser && newOwner !== pathOwner) {
          const oldRef = shopDoc(pathOwner, selected);
          const newRef = shopDoc(newOwner, selected);
          const visitsSnap = await getDocs(collection(oldRef, 'visits'));
          const batch = writeBatch(db);
          batch.set(newRef, {
            ...payload,
            created_at: current?.created_at || serverTimestamp(),
            updated_at: serverTimestamp(),
          });
          visitsSnap.docs.forEach((visit) => {
            batch.set(doc(newRef, 'visits', visit.id), visit.data());
            batch.delete(visit.ref);
          });
          batch.delete(oldRef);
          await batch.commit();
        } else {
          await updateDoc(shopDoc(pathOwner, selected), {
            ...payload,
            updated_at: serverTimestamp(),
          });
        }
        const todayUnitsEntry = nextUnitsLog.find((e) => e.date === todayDateKey());
        if (todayUnitsEntry) {
          try {
            await setDoc(doc(shopDoc(newOwner, selected), 'visits', todayUnitsEntry.date), {
              date: todayUnitsEntry.date,
              units: todayUnitsEntry.units,
              kit: todayUnitsEntry.kit,
              pod: todayUnitsEntry.pod,
              updated_at: serverTimestamp(),
            }, { merge: true });
          } catch {
            // visit write is best-effort
          }
        }
        setShops((prev) => {
          const next = { ...draft, ...payload, id: selected, assigned_to: newOwner, updated_at: new Date() };
          return [next, ...prev.filter((s) => s.id !== selected)];
        });
      }
      setSelected(null);
      setDraft(null);
    } catch (error) {
      const code = error?.code || '';
      alert(code.includes('permission-denied')
        ? '没有保存权限。请刷新后再试一次。'
        : (error.message || '保存失败'));
    } finally {
      setSaving(false);
    }
  }

  function buildReport() {
    if (!draft) return;
    const lines = [
      ['店铺名称', draft.name],
      ['城市', draft.city],
      ['是否连锁店', draft.is_chain ? '是' : '否'],
      ['连锁店数量', draft.is_chain ? draft.chain_total_stores : ''],
      ['其中 A 级店铺', draft.is_chain ? draft.chain_a_plus_count : ''],
      ['地址', draft.address],
      ['评级', draft.tier || '未分级'],
      ['拜访状态', STATUS[draft.status] || draft.status],
      ['意愿', draft.willingness],
      ['老板', draft.owner_name],
      ['联系方式', draft.phone],
      ['店员', draft.staff_contact],
      ['老板到店规律', draft.owner_schedule],
      ['主要拿货二级批发商', draft.distributor],
      ['是否放 Test Case', draft.test_case_today ? '是' : '否'],
      ['是否放 sample', draft.sample_today ? '是' : '否'],
      ['是否放硬台卡', draft.display_card_today ? '是' : '否'],
      ['今日卖进 KIT', draft.units_kit_today || ''],
      ['今日卖进 POD', draft.units_pod_today || ''],
      ['热卖品牌明细', draft.brands_note],
      ['备注', draft.traffic_note],
      ['POP UP 情况', formatPopupNoteText({
        flow: draft.popup_flow,
        vape_buyers: draft.popup_vape_buyers,
        vozol_buyers: draft.popup_vozol_buyers,
        kit_sold: draft.popup_kit_sold,
        pod_sold: draft.popup_pod_sold,
      })],
      ['下次拜访计划', formatNextPlan(draft)],
    ]
      .map(([label, value]) => {
        const text = String(value ?? '').trim();
        return text ? `${label}：${text}` : null;
      })
      .filter(Boolean);
    setReportText(lines.join('\n'));
    setCopied(false);
  }

  async function copyReport() {
    if (!reportText) return;
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('复制失败，请手动选择文本复制');
    }
  }

  function clearFilters() {
    setFTier('all');
    setFStatus('all');
    setFCooperation('all');
    setFSoldIn('all');
    setFStarred('all');
    setFCity('all');
    setFSample('all');
    setFTestCase('all');
    setFAssignee('all');
  }

  function generateDailyReport() {
    setDailyReportText(buildDailyReportText(shops));
    setDailyCopied(false);
  }

  function openDailyReport() {
    setDailyReportText((prev) => prev || buildDailyReportText(shops));
    setDailyCopied(false);
    setDailyReportOpen(true);
  }

  async function copyDailyReport() {
    if (!dailyReportText) return;
    try {
      await navigator.clipboard.writeText(dailyReportText);
      setDailyCopied(true);
      setTimeout(() => setDailyCopied(false), 1500);
    } catch {
      alert('复制失败，请手动选择文本复制');
    }
  }

  const myShops = useMemo(() => {
    if (profile?.role === 'manager') {
      const region = normalizeTeamId(profile.team_id);
      return shops.filter((s) => shopTeamOf(s, members) === region);
    }
    return shops.filter((s) => s.assigned_to === profile?.id);
  }, [shops, members, profile]);

  const filtered = useMemo(() => {
    const matched = applyShopFilters(myShops, {
      search, fTier, fStatus, fStarred, fCity, fSample, fTestCase, fAssignee, fCooperation, fSoldIn,
    });
    return sortShops(matched, sortBy);
  }, [myShops, search, sortBy, fTier, fStatus, fStarred, fCity, fSample, fTestCase, fAssignee, fCooperation, fSoldIn]);

  const visibleShops = useMemo(() => {
    if (view === 'list' && profile?.role === 'manager' && focusedMemberId) {
      return filtered.filter((s) => (s.assigned_to || '') === focusedMemberId);
    }
    return filtered;
  }, [view, profile, focusedMemberId, filtered]);

  const memberGroups = useMemo(() => groupMembersByTeam(members, profile, myShops), [members, profile, myShops]);
  const focusedMember = useMemo(
    () => members.find((m) => m.id === focusedMemberId) || null,
    [members, focusedMemberId],
  );
  const exportOwner = profile?.role === 'manager' ? focusedMember : profile;
  const showExport = Boolean(exportOwner) && (profile?.role !== 'manager' || view === 'list');
  const exportDateKey = exportMode === 'all' ? '' : (exportMode === 'date' ? exportDate : todayDateKey());
  const exportShopList = useMemo(() => {
    if (!exportOwner?.id) return [];
    if (exportMode === 'date' && !exportDate) return [];
    if (exportDateKey) {
      return visibleShops.filter((s) => shopVisitedInRange(s, exportDateKey, exportDateKey));
    }
    return visibleShops;
  }, [visibleShops, exportOwner, exportDateKey, exportMode, exportDate]);

  const teamCities = useMemo(() => (
    [...new Set(myShops.map((s) => s.city).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  ), [myShops]);

  const dashboardRows = useMemo(() => {
    const start = dashFrom;
    const end = dashTo;
    if (!start || !end || start > end) return { mine: null, regions: [] };

    if (profile?.role === 'manager') {
      const regionId = normalizeTeamId(profile.team_id);
      const sales = members.filter((m) => m.active && m.role !== 'manager' && normalizeTeamId(m.team_id) === regionId);
      const regions = dashboardSectionsFor(regionId).map((section) => {
        const allRegionShops = myShops.filter((s) => {
          if (section.id === 'tampa' || section.id === 'orlando') {
            return shopAreaId(s, members) === section.id;
          }
          return true;
        });
        const regionShops = filterShopsByTier(allRegionShops, dashTierFilter);
        const regionMembers = sales.filter((m) => {
          if (section.id === 'tampa' || section.id === 'orlando') {
            return memberAreaId(m, myShops) === section.id;
          }
          return true;
        });
        return {
          teamId: section.id,
          label: section.label,
          metrics: computeAreaMetrics(regionShops, start, end, regionMembers.length),
          tierBreakdown: computeTierBreakdown(allRegionShops, start, end),
          rows: regionMembers.map((m) => ({
            id: m.id,
            name: memberName(m),
            ...computeAreaMetrics(
              filterShopsByTier(myShops.filter((s) => s.assigned_to === m.id), dashTierFilter),
              start,
              end,
              1,
            ),
          })),
        };
      });
      return { mine: null, regions };
    }

    const mine = computeAreaMetrics(myShops, start, end);
    return { mine, regions: [] };
  }, [shops, members, profile, myShops, dashFrom, dashTo, dashTierFilter]);

  const focusedMetrics = useMemo(() => {
    if (!focusedMember) return null;
    const start = dashFrom;
    const end = dashTo;
    if (!start || !end || start > end) return null;
    return computeAreaMetrics(shops.filter((s) => s.assigned_to === focusedMember.id), start, end);
  }, [focusedMember, shops, dashFrom, dashTo]);

  const dailyPeopleColumns = useMemo(
    () => buildDailyPeopleColumns(myShops, members, dailyFrom, dailyTo, profile),
    [myShops, members, dailyFrom, dailyTo, profile],
  );

  const cumulativePeopleColumns = useMemo(
    () => buildCumulativePeopleColumns(myShops, members, profile),
    [myShops, members, profile],
  );

  const draftNoteHistory = draft ? historyNotes(normalizeTrafficNotes(draft)) : [];
  const draftUnitsHistory = draft ? draftUnitsLogEntries(draft) : [];
  const canEditDraftUnits = draft ? canEditUnitsLog(profile, user, draft, members) : false;
  const mappedCount = visibleShops.filter(shopHasCoords).length;
  const unmappedCount = visibleShops.filter((s) => geocodeQuery(s) && !shopHasCoords(s)).length;
  const noAddressCount = visibleShops.filter((s) => !geocodeQuery(s)).length;

  const activeFilterCount = [
    fTier !== 'all',
    fStatus !== 'all',
    fCooperation !== 'all',
    fSoldIn !== 'all',
    fStarred !== 'all',
    fCity !== 'all',
    fSample !== 'all',
    fTestCase !== 'all',
    profile?.role === 'manager' && fAssignee !== 'all',
  ].filter(Boolean).length;

  function openExport() {
    setExportMode('today');
    setExportDate(todayDateKey());
    setExportOpen(true);
  }

  function confirmExport() {
    if (!exportOwner?.id) return;
    const person = memberName(exportOwner);
    const stamp = exportDateKey || '全部';
    const filename = `${sanitizeFilename(person)}_${stamp}.csv`;
    downloadTextFile(filename, buildShopsCsv(exportShopList, person));
    setExportOpen(false);
  }

  const filterBar = (
    <section className="filters">
      <button
        type="button"
        className={activeFilterCount ? 'filter-launch on' : 'filter-launch'}
        onClick={() => setFiltersOpen(true)}
      >
        <SlidersHorizontal size={15} />
        筛选{activeFilterCount ? ` · ${activeFilterCount}` : ''}
      </button>
      <div className="filters-actions">
        {showExport && (
          <button type="button" className="export-csv" onClick={openExport}>
            <Download size={15} />导出 CSV
          </button>
        )}
        <button className="primary add-shop" type="button" onClick={openNew}>
          <Plus size={15} />添加店铺
        </button>
      </div>
    </section>
  );

  const countRow = (
    <div className="count-row">
      <div className="count">
        共 {visibleShops.length} 家店铺
        {view === 'map' && ` · 地图上 ${mappedCount} 家`}
        {view === 'map' && unmappedCount ? ` · ${unmappedCount} 家地址未定位` : ''}
        {view === 'map' && noAddressCount ? ` · ${noAddressCount} 家没有地址` : ''}
        {geocodeNote ? ` · ${geocodeNote}` : ''}
      </div>
      <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="排序方式">
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );

  const shopListPane = (
    <div className="shop-list-pane">
      {view === 'map' && countRow}
      <section>
        {view === 'list' && visibleShops.length === 0 && (
          <p className="list-empty">
            {profile?.role === 'manager' && focusedMember
              ? `${memberName(focusedMember)} 还没有店铺`
              : '暂无匹配的店铺'}
          </p>
        )}
        {visibleShops.map((s) => (
          <article
            className={[
              'card',
              s.starred ? 'starred' : '',
              hoveredShopId === s.id ? 'pin-active' : '',
            ].filter(Boolean).join(' ')}
            key={s.id}
            onClick={() => openShop(s)}
            onMouseEnter={() => setHoveredShopId(s.id)}
            onMouseLeave={() => setHoveredShopId(null)}
          >
            <div className="cardtop">
              <div className="cardtitle">
                <button
                  type="button"
                  className={s.starred ? 'star-btn active' : 'star-btn'}
                  aria-label={s.starred ? '取消星标' : '加星标'}
                  onClick={(e) => toggleStar(s, e)}
                >
                  <Star size={16} fill={s.starred ? 'currentColor' : 'none'} />
                </button>
                <div>
                  <strong>{s.name}</strong>
                  <small>{s.city}{s.address ? ` · ${s.address}` : ' · 地址待补充'}</small>
                </div>
              </div>
              <div className="card-tags">
                <span className="chip">{s.tier || '未分级'}</span>
                {STATUS[s.status] && <span className="chip">{STATUS[s.status]}</span>}
                {s.willingness && <span className="chip">意愿 {s.willingness}</span>}
                {isChainShop(s) && (
                  <span className="chip">连锁 {s.chain_total_stores} 家{Number(s.chain_a_plus_count) ? ` · A级 ${s.chain_a_plus_count}` : ''}</span>
                )}
              </div>
            </div>
            <div className="meta">
              {s.starred && <span className="star-tag">重点关注</span>}
              {view === 'list' && profile?.role === 'manager' && !focusedMemberId && s.assigned_to && (
                <span>{memberName(members.find((m) => m.id === s.assigned_to)) || '未分配'}</span>
              )}
              {s.owner_name && <span>老板 {s.owner_name}</span>}
              {s.phone && <span>{s.phone}</span>}
              {s.distributor && <span>批发商 {s.distributor}</span>}
              {isPlaced(s, 'test_case') && (
                <span>已放 Test Case{formatMonthDay(placementOn(s, 'test_case')) ? ` · ${formatMonthDay(placementOn(s, 'test_case'))}` : ''}</span>
              )}
              {isPlaced(s, 'sample') && (
                <span>已放 sample{formatMonthDay(placementOn(s, 'sample')) ? ` · ${formatMonthDay(placementOn(s, 'sample'))}` : ''}</span>
              )}
              {view === 'map' && s.address && !shopHasCoords(s) && (
                <span>{s.geocode_failed ? '地址未能定位' : '定位中…'}</span>
              )}
            </div>
            {normalizeTrafficNotes(s).map((n, i) => (
              <p className="remark" key={`${n.date}-${i}`}>
                {formatNoteStamp(n) && <span className="remark-time">{formatNoteStamp(n)}</span>}
                {n.text}
              </p>
            ))}
            {normalizePopupNotes(s).map((n, i) => (
              <p className="remark popup-remark" key={`popup-${n.date}-${i}`}>
                {formatNoteStamp(n) && <span className="remark-time">{formatNoteStamp(n)} · POP UP</span>}
                {formatPopupNoteText(n)}
              </p>
            ))}
            {s.brands_note && <p>{s.brands_note}</p>}
            {formatNextPlan(s) && <p className="next">下次：{formatNextPlan(s)}</p>}
            {!formatNextPlan(s) && s.next_plan && !isNextPlanOverdue(s) && <p className="next">下次：{s.next_plan}</p>}
          </article>
        ))}
      </section>
    </div>
  );

  if (!configured) {
    return (
      <main className="login">
        <div className="panel">
          <h1>还差环境变量</h1>
          <p>
            把 <code>.env.example</code> 复制成 <code>.env</code>，填入 Firebase 网页应用配置，然后重新运行 <code>npm run dev</code>。
          </p>
        </div>
      </main>
    );
  }
  if (loading) return <div className="loading">加载中…</div>;
  if (loadError && !profile) {
    return (
      <main className="login">
        <div className="panel">
          <h1>加载失败</h1>
          <p>{loadError}</p>
          <button className="primary" type="button" onClick={() => loadAll(user)} disabled={!user}>重试</button>
          {user && (
            <button className="google" type="button" onClick={() => signOut(auth)}>退出登录</button>
          )}
        </div>
      </main>
    );
  }
  if (!user) return <Login />;
  if (needsRegion) {
    return (
      <RegionGate
        user={user}
        onDone={(data) => {
          setNeedsRegion(false);
          setProfile(data.profile);
          setShops(data.shops);
          setMembers(data.members);
        }}
      />
    );
  }
  if (!profile) return <div className="loading">加载中…</div>;

  return (
    <main className={view === 'map' ? 'app map-mode' : view === 'dashboard' ? 'app dashboard-mode' : 'app'}>
      <header className="app-top">
        <div className="app-brand">
          <h1>门店拜访清单</h1>
          <span>
            {teamLabelOf(profile?.team_id) || 'Florida'}
          </span>
        </div>
        <nav className="app-tabs" aria-label="页面切换">
          <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            <List size={15} />列表
          </button>
          <button type="button" className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
            <Map size={15} />地图
          </button>
          <button type="button" className={view === 'dashboard' ? 'on' : ''} onClick={() => setView('dashboard')}>
            <LayoutDashboard size={15} />看板
          </button>
        </nav>
        <div className="user">
          <Users size={15} />
          <button type="button" className="name-btn" onClick={() => setAccountOpen(true)}>
            {profile?.full_name || user.email}
          </button>
          <b>{profile?.role === 'manager' ? 'Manager' : 'Sales'}</b>
          <button type="button" onClick={() => signOut(auth)}><LogOut size={15} />退出</button>
        </div>
      </header>
      {loadError && <div className="error app-top-error">{loadError}</div>}
      {view === 'list' && (
        <div className="app-layout">
          <aside className="app-rail">
            <section className="toolbar">
              <div className="search">
                <Search size={15} />
                <input placeholder="搜索店名 / 地址 / 城市 / 联系人" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </section>
            {profile?.role === 'manager' ? (
              <section className="member-roster">
                <h2>团队成员</h2>
                <button
                  type="button"
                  className={!focusedMemberId ? 'member-item on' : 'member-item'}
                  onClick={() => setFocusedMemberId('')}
                >
                  <span>全部成员</span>
                  <small>{myShops.length} 家</small>
                </button>
                {memberGroups.map((g) => (
                  <div className="member-group" key={g.teamId || 'none'}>
                    <h3>{g.label}</h3>
                    {g.members.map((m) => {
                      const theirShops = shops.filter((s) => s.assigned_to === m.id);
                      const todayCount = todayTouchedCount(theirShops);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={focusedMemberId === m.id ? 'member-item on' : 'member-item'}
                          onClick={() => {
                            setFocusedMemberId(m.id);
                            setFAssignee('all');
                          }}
                        >
                          <span>{memberName(m)}</span>
                          <small>
                            {theirShops.length} 家
                            {todayCount ? ` · 今日 ${todayCount}` : ''}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </section>
            ) : (
              <>
                <section className="daily-report">
                  <button type="button" onClick={generateDailyReport}>
                    <Clipboard size={15} />生成今日汇报
                  </button>
                  <textarea
                    value={dailyReportText}
                    onChange={(e) => setDailyReportText(e.target.value)}
                    placeholder="点上方「生成今日汇报」填入今日数据，也可直接在此输入、复制"
                    rows={10}
                  />
                  <button type="button" onClick={copyDailyReport} disabled={!dailyReportText}>
                    <Copy size={14} />{dailyCopied ? '已复制' : '复制汇报'}
                  </button>
                </section>
                <button className="primary daily-report-launch" type="button" onClick={openDailyReport}>
                  <Clipboard size={15} />生成今日汇报
                </button>
              </>
            )}
          </aside>
          <div className="app-content">
            {filterBar}
            {focusedMember && focusedMetrics && (
              <PersonDashboardStrip
                name={memberName(focusedMember)}
                teamLabel={teamLabelOf(focusedMember.team_id)}
                dashFrom={dashFrom}
                dashTo={dashTo}
                onFromChange={setDashFrom}
                onToChange={setDashTo}
                metrics={focusedMetrics}
              />
            )}
            {countRow}
            <div className="shop-list-wrap">
              {shopListPane}
            </div>
          </div>
        </div>
      )}
      {view === 'map' && (
        <div className="map-page">
          <section className="toolbar">
            <div className="search">
              <Search size={15} />
              <input placeholder="搜索店名 / 地址 / 城市 / 联系人" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </section>
          {filterBar}
          {profile?.role === 'manager' && (
            <div className="manager-note">Manager 模式：当前可查看团队全部门店 · {members.length} 个账号</div>
          )}
          <div className="shop-split">
            {shopListPane}
            <div className="shop-map-pane">
              <React.Suspense fallback={<div className="shop-map-fallback">地图加载中…</div>}>
                <ShopMap
                  shops={filtered}
                  hoveredId={hoveredShopId}
                  statusLabels={STATUS}
                  onHover={setHoveredShopId}
                  onOpen={openShop}
                  fallbackCenter={teamMapViewOf(profile?.team_id).center}
                  fallbackZoom={teamMapViewOf(profile?.team_id).zoom}
                />
              </React.Suspense>
            </div>
          </div>
        </div>
      )}
      {view === 'dashboard' && (
        <div className="dashboard-page">
          {profile?.role === 'manager' ? (
            <nav className="app-tabs dashboard-subtabs" aria-label="看板切换">
              <button type="button" className={dashTab === 'stats' ? 'on' : ''} onClick={() => setDashTab('stats')}>
                看板统计
              </button>
              <button type="button" className={dashTab === 'daily' ? 'on' : ''} onClick={() => setDashTab('daily')}>
                日总结
              </button>
              <button type="button" className={dashTab === 'cumulative' ? 'on' : ''} onClick={() => setDashTab('cumulative')}>
                累积总结
              </button>
            </nav>
          ) : null}
          {profile?.role === 'manager' && dashTab === 'daily' ? (
            <DailySummaryPanel
              fromKey={dailyFrom}
              toKey={dailyTo}
              onFromChange={setDailyFrom}
              onToChange={setDailyTo}
              columns={dailyPeopleColumns}
              onExport={() => {
                const start = calendarDateKey(dailyFrom);
                const end = calendarDateKey(dailyTo);
                if (!start || !end || start > end || !dailyPeopleColumns.length) return;
                const name = start === end ? `日总结_${start}.csv` : `日总结_${start}_${end}.csv`;
                downloadTextFile(name, buildDailySummaryCsv(dailyPeopleColumns, start, end));
              }}
            />
          ) : profile?.role === 'manager' && dashTab === 'cumulative' ? (
            <CumulativeSummaryPanel
              columns={cumulativePeopleColumns}
              onExport={() => {
                if (!cumulativePeopleColumns.length) return;
                downloadTextFile('累积总结_从开始至今.csv', buildCumulativeSummaryCsv(cumulativePeopleColumns));
              }}
            />
          ) : (
            <DashboardPanel
              profile={profile}
              dashFrom={dashFrom}
              dashTo={dashTo}
              dashTierFilter={dashTierFilter}
              onTierFilterChange={setDashTierFilter}
              onFromChange={setDashFrom}
              onToChange={setDashTo}
              dashboardRows={dashboardRows}
            />
          )}
        </div>
      )}
      {draft && (
        <div className="modal" onMouseDown={() => { setDraft(null); setSelected(null); }}>
          <div className="editor" onMouseDown={(e) => e.stopPropagation()}>
            <div className="editorhead">
              <h2>{selected === 'new' ? '添加店铺' : '编辑店铺'}</h2>
              <div className="editorhead-actions">
                <button
                  type="button"
                  className={draft.starred ? 'star-btn editor-star active' : 'star-btn editor-star'}
                  aria-pressed={draft.starred}
                  aria-label={draft.starred ? '取消星标' : '加星标'}
                  title="星标（定期重点关注）"
                  onClick={() => setDraft({ ...draft, starred: !draft.starred })}
                >
                  <Star size={22} fill={draft.starred ? 'currentColor' : 'none'} />
                </button>
                <button type="button" onClick={() => setDraft(null)}><X size={18} /></button>
              </div>
            </div>
            {draft.status === 'visited' && (
              <div className="soldin-log">
                <div className="soldin-log-title">卖进记录</div>
                {draftUnitsHistory.length ? (
                  <>
                    <table className="soldin-log-table">
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>KIT</th>
                          <th>POD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(unitsLogOpen ? draftUnitsHistory : draftUnitsHistory.slice(0, 3)).map((entry) => (
                          <tr key={entry.date}>
                            <td>
                              {canEditDraftUnits ? (
                                <input
                                  type="date"
                                  className="soldin-log-input"
                                  value={entry.date}
                                  onChange={(e) => setDraft(applyUnitsLogEntry(draft, entry.date, {
                                    date: e.target.value,
                                    kit: entry.kit,
                                    pod: entry.pod,
                                  }))}
                                />
                              ) : (
                                formatMonthDay(entry.date) || entry.date
                              )}
                            </td>
                            <td>
                              {canEditDraftUnits ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  className="soldin-log-input soldin-log-num"
                                  value={Number(entry.kit) || 0}
                                  onChange={(e) => setDraft(applyUnitsLogEntry(draft, entry.date, {
                                    date: entry.date,
                                    kit: e.target.value,
                                    pod: entry.pod,
                                  }))}
                                />
                              ) : (
                                Number(entry.kit) || 0
                              )}
                            </td>
                            <td>
                              {canEditDraftUnits ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  className="soldin-log-input soldin-log-num"
                                  value={Number(entry.pod) || 0}
                                  onChange={(e) => setDraft(applyUnitsLogEntry(draft, entry.date, {
                                    date: entry.date,
                                    kit: entry.kit,
                                    pod: e.target.value,
                                  }))}
                                />
                              ) : (
                                Number(entry.pod) || 0
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {draftUnitsHistory.length > 3 && (
                      <button
                        type="button"
                        className={unitsLogOpen ? 'soldin-log-toggle open' : 'soldin-log-toggle'}
                        aria-expanded={unitsLogOpen}
                        onClick={() => setUnitsLogOpen((v) => !v)}
                      >
                        <span>{unitsLogOpen ? '收起' : `还有 ${draftUnitsHistory.length - 3} 条`}</span>
                        <ChevronDown size={16} />
                      </button>
                    )}
                    {!canEditDraftUnits && (
                      <p className="soldin-log-hint">仅店铺负责人或本区经理可修改卖进记录</p>
                    )}
                  </>
                ) : (
                  <p className="soldin-log-empty">暂无卖进记录</p>
                )}
              </div>
            )}
            <div className="grid">
              <Field label="店铺名称"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <div className="field wide">
                <span>地址</span>
                <input
                  value={draft.address}
                  onChange={(e) => {
                    const address = e.target.value;
                    const { pool, fallback } = resolveCityContext(draft);
                    setDraft({
                      ...draft,
                      address,
                      city: detectCityFromAddress(address, {
                        knownCities: pool,
                        fallback: draft.city || fallback,
                      }),
                    });
                  }}
                  placeholder="填写完整地址（城市会自动解析）"
                />
              </div>
              <div className="field wide">
                <span>是否连锁店</span>
                <CircleChoice
                  value={Boolean(draft.is_chain)}
                  onChange={(yes) => setDraft({
                    ...draft,
                    is_chain: yes,
                    chain_total_stores: yes
                      ? (draft.chain_total_stores === '' || draft.chain_total_stores == null ? String(CHAIN_MIN_STORES) : draft.chain_total_stores)
                      : draft.chain_total_stores,
                    chain_a_plus_count: yes
                      ? (draft.chain_a_plus_count === '' || draft.chain_a_plus_count == null ? '0' : draft.chain_a_plus_count)
                      : draft.chain_a_plus_count,
                  })}
                />
              </div>
              {draft.is_chain && (
                <>
                  <Field label={`连锁店数量（至少 ${CHAIN_MIN_STORES} 家）`}>
                    <input
                      type="number"
                      min={CHAIN_MIN_STORES}
                      step="1"
                      placeholder={`至少 ${CHAIN_MIN_STORES} 家`}
                      value={draft.chain_total_stores}
                      onChange={(e) => setDraft({ ...draft, chain_total_stores: e.target.value })}
                    />
                  </Field>
                  <Field label="其中 A 级店铺">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="A / A+ / S 有几家"
                      value={draft.chain_a_plus_count}
                      onChange={(e) => setDraft({ ...draft, chain_a_plus_count: e.target.value })}
                    />
                  </Field>
                </>
              )}

              <div className="field-row field-row-3">
                <Field label="评级">
                  <select value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })}>
                    {['', 'S', 'A+', 'A', 'B'].map((x) => <option key={x} value={x}>{x || '未分级'}</option>)}
                  </select>
                </Field>
                <Field label="拜访状态">
                  <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                    {!STATUS[draft.status] && <option value={draft.status || 'not_visited'}>未选择</option>}
                    {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="意愿">
                  <select value={draft.willingness || ''} onChange={(e) => setDraft({ ...draft, willingness: e.target.value })}>
                    <option value="">未选</option>
                    {WILLINGNESS_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </Field>
              </div>
              <div className="field-row field-row-tight">
                <Field label="老板"><input value={draft.owner_name} onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })} /></Field>
                <Field label="联系方式"><input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="电话、邮箱等" /></Field>
              </div>
              <Field label="员工联系人"><input value={draft.staff_contact} onChange={(e) => setDraft({ ...draft, staff_contact: e.target.value })} /></Field>
              <Field label="老板到店规律"><input value={draft.owner_schedule} onChange={(e) => setDraft({ ...draft, owner_schedule: e.target.value })} /></Field>
              <Field label="主要拿货二级批发商"><input value={draft.distributor} onChange={(e) => setDraft({ ...draft, distributor: e.target.value })} /></Field>
              <PlacementField
                label="是否放 Test Case"
                kind="test_case"
                draft={draft}
                onChange={(todayYes) => setDraft({ ...draft, test_case_today: todayYes })}
              />
              <PlacementField
                label="是否放 sample"
                kind="sample"
                draft={draft}
                onChange={(todayYes) => setDraft({ ...draft, sample_today: todayYes })}
              />
              <PlacementField
                label="是否放硬台卡"
                kind="display_card"
                draft={draft}
                onChange={(todayYes) => setDraft({ ...draft, display_card_today: todayYes })}
              />
              {profile?.role === 'manager' && (
                <Field label="负责人">
                  <select
                    value={draft.assigned_to || profile.id}
                    onChange={(e) => setDraft(assignShopTo(draft, e.target.value))}
                  >
                    {memberGroups.map((g) => (
                      <optgroup key={g.teamId || 'none'} label={g.label}>
                        {g.members.map((m) => (
                          <option value={m.id} key={m.id}>{memberName(m)} · {m.role}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
              )}
              <Field wide label="热卖品牌明细"><textarea value={draft.brands_note} onChange={(e) => setDraft({ ...draft, brands_note: e.target.value })} /></Field>
              <div className="field wide units-today-field">
                <span>今日卖进</span>
                <div className="units-pair">
                  <div className="units-pair-item">
                    <span>KIT</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="支数"
                      disabled={!canEditDraftUnits}
                      value={draft.units_kit_today || ''}
                      onChange={(e) => {
                        const units_kit_today = e.target.value;
                        setDraft({
                          ...draft,
                          units_kit_today,
                          units_log: mergeUnitsLog(draft.units_log, units_kit_today, draft.units_pod_today),
                        });
                      }}
                    />
                  </div>
                  <div className="units-pair-item">
                    <span>POD</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="支数"
                      disabled={!canEditDraftUnits}
                      value={draft.units_pod_today || ''}
                      onChange={(e) => {
                        const units_pod_today = e.target.value;
                        setDraft({
                          ...draft,
                          units_pod_today,
                          units_log: mergeUnitsLog(draft.units_log, draft.units_kit_today, units_pod_today),
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="field wide">
                <span>备注</span>
                {draftNoteHistory.length > 0 && (
                  <div className="note-history">
                    {draftNoteHistory.map((n, i) => (
                      <div className="note-history-item" key={`${n.date}-${i}`}>
                        <time dateTime={n.date}>{formatNoteStamp(n)}</time>
                        <p>{n.text}</p>
                      </div>
                    ))}
                  </div>
                )}
                {draftNoteHistory.length > 0 && <div className="note-today-hint">今天</div>}
                <textarea
                  value={draft.traffic_note}
                  placeholder={draftNoteHistory.length ? '填写今天的备注' : ''}
                  onChange={(e) => setDraft({ ...draft, traffic_note: e.target.value })}
                />
              </div>
              <div className="field wide popup-field">
                <button
                  type="button"
                  className={popupOpen ? 'popup-toggle open' : 'popup-toggle'}
                  aria-expanded={popupOpen}
                  onClick={() => setPopupOpen((v) => !v)}
                >
                  <span>Pop up</span>
                  <ChevronDown size={18} />
                </button>
                {popupOpen && (
                  <>
                    <div className="popup-head">
                      <span>日期</span>
                      <input
                        type="date"
                        value={draft.popup_date || todayDateKey()}
                        onChange={(e) => setDraft(applyPopupDate(draft, e.target.value))}
                        aria-label="Pop up 日期"
                      />
                    </div>
                    <div className="popup-grid">
                      {POPUP_FIELDS.map((field) => (
                        <label key={field.key}>
                          {field.label}
                          <input
                            value={draft[field.draftKey] || ''}
                            onChange={(e) => setDraft({ ...draft, [field.draftKey]: e.target.value })}
                          />
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="field">
                <span>下次拜访日期（可选）</span>
                <div className="date-row">
                  <input
                    type="date"
                    min={todayDateKey()}
                    value={draft.next_plan_date || ''}
                    onChange={(e) => setDraft({
                      ...draft,
                      next_plan_date: e.target.value,
                      next_plan_time: e.target.value ? draft.next_plan_time : '',
                    })}
                  />
                  <button
                    type="button"
                    className="clear-date"
                    disabled={!draft.next_plan_date && !draft.next_plan_time}
                    onClick={() => setDraft({ ...draft, next_plan_date: '', next_plan_time: '' })}
                  >
                    清空
                  </button>
                </div>
              </div>
              <Field label="下次拜访时间（可选）">
                <div className="time-row">
                  <select
                    value={parsePlanTime(draft.next_plan_time).hour}
                    disabled={!draft.next_plan_date}
                    onChange={(e) => setDraft({
                      ...draft,
                      next_plan_time: combinePlanTime(e.target.value, parsePlanTime(draft.next_plan_time).minute),
                    })}
                  >
                    <option value="">时</option>
                    {PLAN_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <select
                    value={parsePlanTime(draft.next_plan_time).minute}
                    disabled={!draft.next_plan_date}
                    onChange={(e) => setDraft({
                      ...draft,
                      next_plan_time: combinePlanTime(parsePlanTime(draft.next_plan_time).hour, e.target.value),
                    })}
                  >
                    <option value="">分</option>
                    {PLAN_MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </Field>
            </div>
            <div className="visitbox">
              <div className="visitbox-head">
                <h3>门店信息文本</h3>
                <button type="button" className="visitbox-btn" onClick={buildReport}>
                  <Clipboard size={14} />一键生成
                </button>
              </div>
              {reportText && (
                <>
                  <textarea className="visitbox-text" readOnly value={reportText} />
                  <div className="visitbox-actions">
                    <button type="button" className="visitbox-btn" onClick={copyReport}>
                      <Copy size={14} />{copied ? '已复制' : '复制文本'}
                    </button>
                  </div>
                </>
              )}
            </div>
            <footer>
              <button className="primary" type="button" onClick={saveShop} disabled={saving}>
                <Save size={15} />{saving ? '保存中…' : '保存门店'}
              </button>
              {draft.address && (
                <a
                  href={mapsSearchHref(
                    draft,
                    members.find((m) => m.id === (draft.assigned_to || profile?.id))?.team_id
                    || profile?.team_id,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} />谷歌地图
                </a>
              )}
            </footer>
          </div>
        </div>
      )}
      {filtersOpen && (
        <div className="modal" onMouseDown={() => setFiltersOpen(false)}>
          <div className="editor filter-editor" onMouseDown={(e) => e.stopPropagation()}>
            <div className="editorhead">
              <h2>筛选店铺</h2>
              <button type="button" onClick={() => setFiltersOpen(false)}><X size={18} /></button>
            </div>
            <div className="grid filter-panel">
              <Field label="分级">
                <select value={fTier} onChange={(e) => setFTier(e.target.value)}>
                  <option value="all">全部</option>
                  <option value="S">S</option>
                  <option value="A+">A+</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="none">未分级</option>
                </select>
              </Field>
              <Field label="拜访状态">
                <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                  <option value="all">全部</option>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="合作意愿">
                <select value={fCooperation} onChange={(e) => setFCooperation(e.target.value)}>
                  {Object.entries(COOPERATION).map(([k, v]) => (
                    <option key={k} value={k}>{k === 'all' ? '全部' : v}</option>
                  ))}
                </select>
              </Field>
              <Field label="卖进">
                <select value={fSoldIn} onChange={(e) => setFSoldIn(e.target.value)}>
                  <option value="all">全部</option>
                  <option value="yes">已卖进</option>
                  <option value="no">未卖进</option>
                </select>
              </Field>
              <Field label="星标">
                <select value={fStarred} onChange={(e) => setFStarred(e.target.value)}>
                  <option value="all">全部</option>
                  <option value="yes">星标店铺</option>
                  <option value="no">非星标</option>
                </select>
              </Field>
              <Field label="城市">
                <select value={fCity} onChange={(e) => setFCity(e.target.value)}>
                  <option value="all">全部</option>
                  {teamCities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="样机">
                <select value={fSample} onChange={(e) => setFSample(e.target.value)}>
                  <option value="all">全部</option>
                  <option value="yes">已放样机</option>
                  <option value="no">未放样机</option>
                </select>
              </Field>
              <Field label="试抽盒">
                <select value={fTestCase} onChange={(e) => setFTestCase(e.target.value)}>
                  <option value="all">全部</option>
                  <option value="yes">已放试抽盒</option>
                  <option value="no">未放试抽盒</option>
                </select>
              </Field>
              {profile?.role === 'manager' && !focusedMemberId && (
                <Field label="负责人">
                  <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
                    <option value="all">全部</option>
                    {memberGroups.map((g) => (
                      <optgroup key={g.teamId || 'none'} label={g.label}>
                        {g.members.map((m) => (
                          <option key={m.id} value={m.id}>{memberName(m)}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <footer>
              <button type="button" onClick={clearFilters}>清除筛选</button>
              <button className="primary" type="button" onClick={() => setFiltersOpen(false)}>完成</button>
            </footer>
          </div>
        </div>
      )}
      {dailyReportOpen && (
        <div className="modal" onMouseDown={() => setDailyReportOpen(false)}>
          <div className="editor daily-report-editor" onMouseDown={(e) => e.stopPropagation()}>
            <div className="editorhead">
              <h2>今日汇报</h2>
              <button type="button" onClick={() => setDailyReportOpen(false)}><X size={18} /></button>
            </div>
            <div className="daily-report daily-report-modal-body">
              <button type="button" onClick={generateDailyReport}>
                <Clipboard size={15} />重新生成
              </button>
              <textarea
                value={dailyReportText}
                onChange={(e) => setDailyReportText(e.target.value)}
                placeholder="点上方「重新生成」填入今日数据，也可直接在此输入、复制"
                rows={12}
              />
              <button type="button" onClick={copyDailyReport} disabled={!dailyReportText}>
                <Copy size={14} />{dailyCopied ? '已复制' : '复制汇报'}
              </button>
            </div>
          </div>
        </div>
      )}
      {exportOpen && (
        <div className="modal" onMouseDown={() => setExportOpen(false)}>
          <div className="editor export-editor" onMouseDown={(e) => e.stopPropagation()}>
            <div className="editorhead">
              <h2>导出 CSV</h2>
              <button type="button" onClick={() => setExportOpen(false)}><X size={18} /></button>
            </div>
            <p className="export-hint">
              导出 {memberName(exportOwner) || '当前销售'} 的门店数据
              {activeFilterCount ? '（已应用当前筛选条件）' : ''}
            </p>
            <div className="export-modes" role="radiogroup" aria-label="导出范围">
              {[
                { id: 'today', label: '今天' },
                { id: 'all', label: '全部数据' },
                { id: 'date', label: '指定日期' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={exportMode === opt.id}
                  className={exportMode === opt.id ? 'on' : ''}
                  onClick={() => setExportMode(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {exportMode === 'date' && (
              <label className="export-date">
                日期
                <input
                  type="date"
                  value={exportDate}
                  onChange={(e) => setExportDate(e.target.value)}
                />
              </label>
            )}
            <p className="export-count">
              {exportMode === 'date' && !exportDate
                ? '请选择日期'
                : `将导出 ${exportShopList.length} 家店铺`}
            </p>
            <footer>
              <button type="button" onClick={() => setExportOpen(false)}>取消</button>
              <button
                className="primary"
                type="button"
                disabled={!exportShopList.length}
                onClick={confirmExport}
              >
                <Download size={15} />导出
              </button>
            </footer>
          </div>
        </div>
      )}
      {accountOpen && (
        <AccountEditor
          user={user}
          profile={profile}
          onClose={() => setAccountOpen(false)}
          onSaved={(patch) => setProfile((prev) => ({ ...prev, ...patch }))}
        />
      )}
    </main>
  );
}

function DashboardPanel({
  profile, dashFrom, dashTo, dashTierFilter, onTierFilterChange, onFromChange, onToChange, dashboardRows,
}) {
  const { mine, regions } = dashboardRows;
  const invalidRange = !dashFrom || !dashTo || dashFrom > dashTo;
  const isManager = profile?.role === 'manager';

  return (
    <section className="dashboard">
      <div className="dashboard-head">
        <div>
          <h2>{isManager ? '地区看板' : '我的区域看板'}</h2>
        </div>
        <div className="dashboard-controls">
          {isManager && (
            <label className="dashboard-tier-filter">
              分级筛选
              <select value={dashTierFilter} onChange={(e) => onTierFilterChange(e.target.value)}>
                <option value="all">全部</option>
                <option value="S">S 级</option>
                <option value="aa">A / A+ 级</option>
              </select>
            </label>
          )}
          <div className="dashboard-range">
            <label>
              开始
              <input type="date" value={dashFrom} onChange={(e) => onFromChange(e.target.value)} />
            </label>
            <label>
              结束
              <input type="date" value={dashTo} onChange={(e) => onToChange(e.target.value)} />
            </label>
          </div>
        </div>
      </div>
      {invalidRange ? (
        <p className="dashboard-empty">请选择有效的时间段</p>
      ) : isManager ? (
        regions.length ? regions.map((region) => (
          <div className="dashboard-region" key={region.teamId || region.label}>
            <h3 className="dashboard-section-title">{region.label}</h3>
            <AreaMetricsGrid metrics={region.metrics} className="metrics-grid team-summary" />
            {dashTierFilter === 'all' && region.tierBreakdown && (
              <div className="tier-breakdown">
                <TierMetricsPanel title="S 级" metrics={region.tierBreakdown.s} />
                <TierMetricsPanel title="A / A+ 级" metrics={region.tierBreakdown.aa} />
              </div>
            )}
            {region.rows.length > 0 && (
              <>
                <h4 className="dashboard-subtitle">各负责人明细</h4>
                <MemberMetricsTable rows={region.rows} total={region.metrics} totalLabel={`${region.label}合计`} />
              </>
            )}
          </div>
        )) : (
          <p className="dashboard-empty">暂无地区数据</p>
        )
      ) : mine ? (
        <AreaMetricsGrid metrics={mine} hint={`${dashFrom} 至 ${dashTo}`} visitedLabel="负责区域跑店数" />
      ) : null}
    </section>
  );
}

function PersonDashboardStrip({ name, teamLabel, dashFrom, dashTo, onFromChange, onToChange, metrics }) {
  return (
    <section className="person-dash">
      <div className="person-dash-head">
        <div>
          <h3>{name}</h3>
          <p>{teamLabel || ''}</p>
        </div>
        <div className="dashboard-range">
          <label>
            开始
            <input type="date" value={dashFrom} onChange={(e) => onFromChange(e.target.value)} />
          </label>
          <label>
            结束
            <input type="date" value={dashTo} onChange={(e) => onToChange(e.target.value)} />
          </label>
        </div>
      </div>
      <AreaMetricsGrid metrics={metrics} visitedLabel="跑店数" />
    </section>
  );
}

function DailySummaryPanel({ fromKey, toKey, onFromChange, onToChange, columns, onExport }) {
  const today = todayDateKey();
  const start = calendarDateKey(fromKey);
  const end = calendarDateKey(toKey);
  const invalidRange = !start || !end || start > end;
  const isToday = start === today && end === today;
  return (
    <section className="dashboard daily-summary">
      <div className="dashboard-head">
        <div>
          <h2>日总结</h2>
        </div>
        <div className="dashboard-controls">
          <div className="dashboard-range">
            <label>
              开始
              <input type="date" value={start || ''} onChange={(e) => onFromChange(e.target.value)} />
            </label>
            <label>
              结束
              <input type="date" value={end || ''} onChange={(e) => onToChange(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            className={isToday ? 'dash-today-btn on' : 'dash-today-btn'}
            onClick={() => {
              onFromChange(today);
              onToChange(today);
            }}
          >
            今天
          </button>
          <button type="button" className="export-csv" onClick={onExport} disabled={invalidRange || !columns.length}>
            <Download size={15} />导出 CSV
          </button>
        </div>
      </div>
      {invalidRange ? (
        <p className="dashboard-empty">请选择有效的时间段</p>
      ) : columns.length ? (
        <MetricReportTable columns={columns} rows={DAILY_METRIC_ROWS} />
      ) : (
        <p className="dashboard-empty">暂无成员数据</p>
      )}
    </section>
  );
}

function CumulativeSummaryPanel({ columns, onExport }) {
  return (
    <section className="dashboard daily-summary">
      <div className="dashboard-head">
        <div>
          <h2>累积总结</h2>
        </div>
        <div className="dashboard-controls">
          <button type="button" className="export-csv" onClick={onExport} disabled={!columns.length}>
            <Download size={15} />导出 CSV
          </button>
        </div>
      </div>
      {columns.length ? (
        <MetricReportTable columns={columns} rows={CUMULATIVE_METRIC_ROWS} />
      ) : (
        <p className="dashboard-empty">暂无成员数据</p>
      )}
    </section>
  );
}

function MetricReportTable({ columns, rows }) {
  return (
    <div className="dashboard-table-wrap">
      <table className="dashboard-table daily-report-table">
        <thead>
          <tr>
            <th>指标</th>
            {columns.map((col) => (
              <th key={col.id}>{col.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {columns.map((col) => (
                <td key={col.id}>{dailyMetricCell(col.metrics, row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TierMetricsPanel({ title, metrics }) {
  return (
    <div className="tier-metrics">
      <h4 className="tier-metrics-title">{title}</h4>
      <div className="metrics-grid tier-metrics-grid">
        <MetricCard label="门店数" value={metrics.storeCount} />
        <MetricCard label="卖进数量" value={metrics.totalUnits} />
        <MetricCard label="试抽盒投放" value={metrics.testCaseCount} />
        <MetricCard label="样机投放" value={metrics.sampleCount} />
        <MetricCard label="Pop up 场次" value={metrics.popupSessions} />
        <MetricCard label="Pop up 卖出" value={metrics.popupVozolSales} />
      </div>
    </div>
  );
}

function AreaMetricsGrid({ metrics, className, hint, visitedLabel = '跑店数' }) {
  return (
    <div className={className || 'metrics-grid'}>
      <MetricCard label={visitedLabel} value={metrics.visitedCount} hint={hint} />
      <MetricCard label="Mapping 完成" value={`${metrics.mappedCount} / ${metrics.mappingTarget ?? MAPPING_TARGET}`} sub={metrics.mappedPct} />
      <MetricCard label="A 级及以上" value={`${metrics.aPlusCount} / ${metrics.total}`} sub={metrics.aPlusPct} />
      <MetricCard label="样机投放" value={metrics.sampleCount} />
      <MetricCard label="试抽盒投放" value={metrics.testCaseCount} />
      <MetricCard label="卖进门店" value={`${metrics.soldInCount} / ${metrics.total}`} sub={metrics.soldInPct} />
      <MetricCard label="卖进总支数" value={metrics.totalUnits} highlight />
    </div>
  );
}

function MemberMetricsTable({ rows, total, totalLabel }) {
  return (
    <div className="dashboard-table-wrap">
      <table className="dashboard-table">
        <thead>
          <tr>
            <th>负责人</th>
            <th>跑店数</th>
            <th>Mapping</th>
            <th>A级+</th>
            <th>样机</th>
            <th>试抽盒</th>
            <th>卖进门店</th>
            <th>卖进支数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.visitedCount}</td>
              <td>{row.mappedCount} ({row.mappedPct})</td>
              <td>{row.aPlusCount} ({row.aPlusPct})</td>
              <td>{row.sampleCount}</td>
              <td>{row.testCaseCount}</td>
              <td>{row.soldInCount} ({row.soldInPct})</td>
              <td>{row.totalUnits}</td>
            </tr>
          ))}
          {total && (
            <tr className="total-row">
              <td>{totalLabel || '合计'}</td>
              <td>{total.visitedCount}</td>
              <td>{total.mappedCount} ({total.mappedPct})</td>
              <td>{total.aPlusCount} ({total.aPlusPct})</td>
              <td>{total.sampleCount}</td>
              <td>{total.testCaseCount}</td>
              <td>{total.soldInCount} ({total.soldInPct})</td>
              <td>{total.totalUnits}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({ label, value, sub, hint, highlight }) {
  return (
    <div className={highlight ? 'metric-card highlight' : 'metric-card'}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {sub && <span className="metric-sub">{sub}</span>}
      {hint && <span className="metric-hint">{hint}</span>}
    </div>
  );
}

function AccountEditor({ user, profile, onClose, onSaved }) {
  const hasPassword = Boolean(user?.providerData?.some((p) => p.providerId === 'password'));
  const [name, setName] = useState(profile?.full_name || user?.displayName || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    const nextName = name.trim();
    if (!nextName) {
      setErr('请填写姓名');
      return;
    }
    const changingPassword = Boolean(currentPassword || newPassword || confirm);
    if (changingPassword) {
      if (!hasPassword) {
        setErr('此账号通过 Google 登录，密码请在 Google 账号中修改');
        return;
      }
      if (!currentPassword) {
        setErr('请输入当前密码');
        return;
      }
      if (!newPassword) {
        setErr('请填写新密码');
        return;
      }
      const issues = passwordIssues(newPassword);
      if (issues.length) {
        setErr(`新密码${issues.join('，')}`);
        return;
      }
      if (newPassword !== confirm) {
        setErr('两次输入的新密码不一致');
        return;
      }
      if (newPassword === currentPassword) {
        setErr('新密码不能与当前密码相同');
        return;
      }
    }
    setErr('');
    setSaving(true);
    try {
      if (nextName !== (profile?.full_name || '')) {
        await updateProfile(user, { displayName: nextName });
        await updateDoc(doc(db, 'profiles', user.uid), { full_name: nextName });
        onSaved({ full_name: nextName });
      }
      if (changingPassword) {
        const cred = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, cred);
        await updatePassword(user, newPassword);
      }
      onClose();
    } catch (error) {
      setErr(authMessage(error, 'account'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="editor account-editor" onMouseDown={(e) => e.stopPropagation()}>
        <div className="editorhead">
          <h2>编辑账号</h2>
          <button type="button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="grid">
          <Field wide label="姓名">
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          {hasPassword ? (
            <>
              <Field wide label="当前密码">
                <PasswordField
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
              <Field wide label="新密码">
                <PasswordField
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                />
              </Field>
              <Field wide label="确认新密码">
                <PasswordField
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                />
              </Field>
              <p className={newPassword && passwordIssues(newPassword).length ? 'hint bad' : 'hint'}>
                不改密码请留空。新密码至少 {MIN_PASSWORD_LENGTH} 位，需包含字母和数字
              </p>
            </>
          ) : (
            <p className="hint">此账号通过 Google 登录，密码请在 Google 账号中修改。</p>
          )}
        </div>
        {err && <div className="error">{err}</div>}
        <footer>
          <button className="primary" type="button" onClick={save} disabled={saving}>
            <Save size={15} />{saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, autoComplete, minLength, required }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-wrap">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
      />
      <button
        type="button"
        className="password-toggle"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((v) => !v)}
        title={visible ? '隐藏密码' : '显示密码'}
        aria-label={visible ? '隐藏密码' : '显示密码'}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function Field({ label, children, wide }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span>{children}</label>;
}

function CircleChoice({ value, onChange }) {
  return (
    <div className="circle-choice" role="radiogroup">
      {[
        { yes: true, label: '是' },
        { yes: false, label: '否' },
      ].map((opt) => (
        <button
          type="button"
          key={opt.label}
          role="radio"
          aria-checked={value === opt.yes}
          className={value === opt.yes ? 'on' : ''}
          onClick={() => onChange(opt.yes)}
        >
          <span className="circle-dot" aria-hidden="true" />
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function PlacementField({ label, kind, draft, onChange }) {
  const hint = placementHint(draft, kind);
  return (
    <div className="field">
      <span>{label}</span>
      {hint && <div className="placed-hint">{hint}</div>}
      <select value={draft[`${kind}_today`] ? 'yes' : 'no'} onChange={(e) => onChange(e.target.value === 'yes')}>
        <option value="no">否</option>
        <option value="yes">是（今天放）</option>
      </select>
    </div>
  );
}
