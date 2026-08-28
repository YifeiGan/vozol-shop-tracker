import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Plus, X, ExternalLink, LogOut, Save, Users, Clipboard, Copy, Star, Map, List, Eye, EyeOff, LayoutDashboard, SlidersHorizontal,
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
import { auth, configured, db, DEFAULT_TEAM_ID, googleProvider } from './firebase';
import { geocodeAddress, geocodeQuery, GEOCODE_VERSION, needsGeocode, shopHasCoords } from './geocode';

const ShopMap = React.lazy(() => import('./ShopMap'));

const ORLANDO_CITIES = [
  'Orlando', 'Winter Park', 'Kissimmee', 'Sanford', 'Altamonte Springs',
  'Lake Mary', 'Apopka', 'Oviedo', 'Winter Garden', 'Windermere',
  'Ocoee', 'Clermont', 'St Cloud', 'Casselberry', 'Maitland',
  'Longwood', 'Winter Springs', 'Celebration', 'Dr. Phillips', 'Lake Buena Vista',
  'Davenport', 'Poinciana',
];
const TAMPA_CITIES = [
  'Tampa', 'Clearwater', 'St Petersburg', 'Largo', 'Dunedin', 'Pinellas Park',
  'Oldsmar', 'Palm Harbor', 'Tarpon Springs', 'Safety Harbor', 'Seminole',
  'Indian Rocks Beach', 'Belleair Bluffs', 'Clearwater Beach', 'St Pete Beach',
  'New Port Richey', 'Port Richey', 'Holiday', 'Madeira Beach', 'Treasure Island',
];
const CITIES = [...ORLANDO_CITIES, ...TAMPA_CITIES];
const TEAM_LABEL = { orlando: 'Orlando', tampa: 'Tampa' };
const STATUS = {
  not_visited: '待拜访',
  visited: '已卖进/拜访',
  follow_up: '需跟进',
  no_interest: '无意向/暂缓',
};
function defaultCity(teamId) {
  return teamId === 'tampa' ? 'Clearwater' : 'Orlando';
}

const emptyShop = (teamId) => ({
  name: '', address: '', city: defaultCity(teamId), phone: '', tier: '', status: 'not_visited',
  is_chain: false, chain_name: '', chain_total_stores: '', staff_contact: '', owner_name: '',
  owner_schedule: '', contact_role: '', store_number: '', restock_status: '', distributor: '',
  test_case_placed: false, sample_placed: false, test_case_placed_on: '', sample_placed_on: '',
  test_case_today: false, sample_today: false,
  traffic_note: '', traffic_notes: [], brands_note: '', next_plan: '',
  next_plan_date: '', next_plan_time: '', source_url: '', starred: false,
});
const MAX_TRAFFIC_NOTES = 2;

function formatNextPlan(shop) {
  const date = (shop?.next_plan_date || '').trim();
  if (!date) return '';
  const time = (shop?.next_plan_time || '').trim();
  return time ? `${date} ${time}` : date;
}

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
const COOPERATION = {
  all: '合作意愿',
  willing: '有意向',
  sold_in: '已卖进',
  follow_up: '需跟进',
  no_interest: '无意向',
  not_visited: '待拜访',
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
  if (typeof value.toDate === 'function') return todayDateKey(value.toDate());
  if (value instanceof Date) return todayDateKey(value);
  if (typeof value === 'string' || typeof value === 'number') return todayDateKey(new Date(value));
  return '';
}

function isTierAPlus(tier) {
  return tier === 'S' || tier === 'A+' || tier === 'A';
}

function isDateInRange(dateKey, start, end) {
  if (!dateKey || !start || !end) return false;
  return dateKey >= start && dateKey <= end;
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
    .map((e) => ({ date: e.date || '', units: Number(e.units) || 0 }))
    .filter((e) => e.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function todayUnitsValue(log, today = todayDateKey()) {
  const entry = normalizeUnitsLog({ units_log: log }).find((e) => e.date === today);
  return entry ? String(entry.units) : '';
}

function mergeUnitsLog(existingLog, todayUnitsText) {
  const today = todayDateKey();
  const text = String(todayUnitsText ?? '').trim();
  const withoutToday = normalizeUnitsLog({ units_log: existingLog }).filter((e) => e.date !== today);
  if (!text) return withoutToday;
  const units = Number(text);
  if (Number.isNaN(units) || units < 0) return withoutToday;
  return [{ date: today, units }, ...withoutToday];
}

function unitsInRange(shop, start, end) {
  return normalizeUnitsLog(shop)
    .filter((e) => isDateInRange(e.date, start, end))
    .reduce((sum, e) => sum + e.units, 0);
}

function shopVisitedInRange(shop, start, end) {
  if (isDateInRange(shopUpdatedDateKey(shop), start, end)) return true;
  return normalizeTrafficNotes(shop).some((n) => isDateInRange(n.date, start, end));
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

function computeAreaMetrics(shopList, start, end) {
  const total = shopList.length;
  const visitedCount = shopList.filter((s) => shopVisitedInRange(s, start, end)).length;
  const mappedCount = shopList.filter(shopHasCoords).length;
  const aPlusCount = shopList.filter((s) => isTierAPlus(s.tier)).length;
  const soldInCount = shopList.filter((s) => s.status === 'visited').length;
  const sampleCount = shopList.filter((s) => placementInRange(s, 'sample', start, end)).length;
  const testCaseCount = shopList.filter((s) => placementInRange(s, 'test_case', start, end)).length;
  const totalUnits = shopList.reduce((sum, s) => sum + unitsInRange(s, start, end), 0);
  return {
    total,
    visitedCount,
    mappedCount,
    mappedPct: pct(mappedCount, MAPPING_TARGET),
    aPlusCount,
    aPlusPct: pct(aPlusCount, total),
    sampleCount,
    testCaseCount,
    soldInCount,
    soldInPct: pct(soldInCount, total),
    totalUnits,
  };
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
    if (q && ![s.name, s.address, s.city, s.owner_name, s.staff_contact].some((v) => (v || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function buildDailyReportText(shopList) {
  const today = todayDateKey();
  const todayShops = shopList.filter((s) => shopUpdatedDateKey(s) === today);
  const newShops = todayShops.filter((s) => isNewVisitToday(s, today));
  const revisitShops = todayShops.filter((s) => !isNewVisitToday(s, today));
  const newAPlusCount = newShops.filter((s) => isTierAPlus(s.tier)).length;
  const testCaseCount = todayShops.filter((s) => placedToday(s, 'test_case', today)).length;
  const sampleCount = todayShops.filter((s) => placedToday(s, 'sample', today)).length;
  const totalUnits = todayShops.reduce((sum, s) => sum + unitsInRange(s, today, today), 0);
  return [
    `日期：${today}`,
    `新店：${newShops.length}`,
    `新店中 A 级及以上：${newAPlusCount}`,
    `回访：${revisitShops.length}`,
    `样机投放数量：${sampleCount || ''}`,
    `试抽盒投放数量：${testCaseCount || ''}`,
    `卖进总支数：${totalUnits || ''}`,
    `遇到的问题：`,
  ].join('\n');
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
  const ownerId = item.ref.parent?.parent?.id || data.assigned_to;
  return { id: item.id, ...data, assigned_to: data.assigned_to || ownerId };
}

let pendingSignupName = '';

function authEmailOf(user) {
  return user.email
    || user.providerData?.find((p) => p.email)?.email
    || '';
}

async function ensureProfile(user) {
  const ref = doc(db, 'profiles', user.uid);
  const email = authEmailOf(user);
  const fullName = (pendingSignupName || user.displayName || email.split('@')[0] || '未命名').trim();
  pendingSignupName = '';

  let snap;
  try {
    snap = await getDoc(ref);
  } catch {
    snap = null;
  }
  if (snap?.exists()) return { id: snap.id, ...snap.data() };

  try {
    await user.getIdToken(true);
  } catch {
    // token refresh is best-effort; profile create no longer depends on token email
  }

  const profile = {
    full_name: fullName || '未命名',
    email,
    role: 'sales',
    team_id: DEFAULT_TEAM_ID,
    active: true,
  };
  await setDoc(ref, profile);
  return { id: user.uid, ...profile };
}

async function migrateLegacyShops(currentUser, profile, members) {
  let snap;
  try {
    const shopQuery = profile.role === 'manager'
      ? query(collection(db, 'shops'), where('team_id', '==', profile.team_id))
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
  let members = [];
  if (p.role === 'manager') {
    const memberSnap = await getDocs(query(collection(db, 'profiles'), where('team_id', '==', p.team_id)));
    members = memberSnap.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''));
  }

  await migrateLegacyShops(currentUser, p, members);

  const ownerIds = p.role === 'manager'
    ? [...new Set([currentUser.uid, ...members.map((m) => m.id)])]
    : [currentUser.uid];
  const shopSnaps = await withTimeout(
    Promise.all(ownerIds.map((id) => getDocs(shopsCollection(id)))),
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
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: fullName.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (error) {
      pendingSignupName = '';
      setErr(authMessage(error, mode));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setErr('');
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
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
        <p>Orlando · {signup ? '创建账号' : 'Firebase 云端版'}</p>
        {!signup && (
          <>
            <button className="google" type="button" onClick={google} disabled={busy}>
              <GoogleMark /> 使用 Google 账号登录
            </button>
            <div className="or">或使用邮箱密码</div>
          </>
        )}
        {signup && (
          <label>
            姓名
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
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
        <button className="auth-switch" type="button" onClick={() => switchMode(signup ? 'login' : 'signup')}>
          {signup ? '已有账号？去登录' : '没有账号？创建账号'}
        </button>
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
  const [dashFrom, setDashFrom] = useState(() => monthStartKey());
  const [dashTo, setDashTo] = useState(() => todayDateKey());
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
        setLoadError('');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError('');
      try {
        const data = await fetchTeamData(next);
        if (cancelled) return;
        setProfile(data.profile);
        setShops(data.shops);
        setMembers(data.members);
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
    (async () => {
      while (!cancelled) {
        const pending = shopsRef.current.filter(needsGeocode);
        if (!pending.length) {
          if (!cancelled) setGeocodeNote('');
          break;
        }
        setGeocodeNote(`正在按地址重新定位 ${pending.length} 家…`);
        const shop = pending[0];
        const queryText = geocodeQuery(shop);
        let coords = null;
        try {
          coords = await geocodeAddress(queryText, shop);
        } catch {
          coords = null;
        }
        if (cancelled) return;
        const patch = coords
          ? {
            lat: coords.lat,
            lng: coords.lng,
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
          if (shop.assigned_to) {
            await updateDoc(shopDoc(shop.assigned_to, shop.id), patch);
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

  async function loadAll(currentUser = user) {
    if (!currentUser) return;
    setLoading(true);
    setLoadError('');
    try {
      const data = await fetchTeamData(currentUser);
      setProfile(data.profile);
      setShops(data.shops);
      setMembers(data.members);
    } catch (error) {
      setLoadError(readErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function openShop(shop) {
    const notes = normalizeTrafficNotes(shop);
    const today = todayDateKey();
    setSelected(shop.id);
    setDraft({
      ...shop,
      chain_total_stores: shop.chain_total_stores ?? '',
      next_plan_date: shop.next_plan_date || '',
      next_plan_time: shop.next_plan_time || '',
      starred: Boolean(shop.starred),
      test_case_placed: isPlaced(shop, 'test_case'),
      sample_placed: isPlaced(shop, 'sample'),
      test_case_placed_on: placementOn(shop, 'test_case'),
      sample_placed_on: placementOn(shop, 'sample'),
      test_case_today: placedToday(shop, 'test_case', today),
      sample_today: placedToday(shop, 'sample', today),
      traffic_notes: notes,
      traffic_note: todayNoteText(notes),
      units_log: normalizeUnitsLog(shop),
      units_today: todayUnitsValue(normalizeUnitsLog(shop), today),
    });
    setReportText('');
    setCopied(false);
  }

  async function toggleStar(shop, e) {
    e?.stopPropagation?.();
    const next = !shop.starred;
    try {
      await updateDoc(shopDoc(shop.assigned_to || profile.id, shop.id), {
        starred: next,
        updated_at: serverTimestamp(),
      });
      setShops((prev) => prev.map((s) => (s.id === shop.id ? { ...s, starred: next, updated_at: new Date() } : s)));
      if (selected === shop.id && draft) setDraft({ ...draft, starred: next });
    } catch (error) {
      alert(error.message);
    }
  }

  function openNew() {
    setSelected('new');
    setDraft(emptyShop(profile?.team_id));
    setReportText('');
    setCopied(false);
  }

  async function saveShop() {
    if (!draft.name.trim() || saving) return;
    const nextPlanText = formatNextPlan(draft);
    const prevShop = selected === 'new' ? draft : (shops.find((s) => s.id === selected) || draft);
    const existingNotes = normalizeTrafficNotes(prevShop);
    const nextNotes = serializeTrafficNotes(mergeTrafficNotes(existingNotes, draft.traffic_note));
    const testNext = nextPlacement(prevShop, draft.test_case_today, 'test_case');
    const sampleNext = nextPlacement(prevShop, draft.sample_today, 'sample');
    const nextUnitsLog = mergeUnitsLog(normalizeUnitsLog(prevShop), draft.units_today);
    const payload = withoutUndefined({
      ...draft,
      name: draft.name.trim(),
      chain_total_stores: draft.chain_total_stores === '' ? null : Number(draft.chain_total_stores),
      next_plan_date: draft.next_plan_date || '',
      next_plan_time: draft.next_plan_date ? (draft.next_plan_time || '') : '',
      next_plan: nextPlanText,
      traffic_notes: nextNotes,
      traffic_note: nextNotes[0]?.text || '',
      units_log: nextUnitsLog,
      test_case_placed: testNext.placed,
      test_case_placed_on: testNext.on,
      sample_placed: sampleNext.placed,
      sample_placed_on: sampleNext.on,
    });
    delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;
    delete payload.test_case_today;
    delete payload.sample_today;
    delete payload.units_today;
    setSaving(true);
    try {
      const geoQuery = geocodeQuery(payload);
      const prevGeoShop = selected === 'new' ? null : shops.find((s) => s.id === selected);
      if (!geoQuery) {
        payload.lat = null;
        payload.lng = null;
        payload.geocode_query = '';
        payload.geocode_failed = false;
        payload.geocode_version = GEOCODE_VERSION;
      } else if (selected === 'new' || geoQuery !== geocodeQuery(prevGeoShop || {}) || prevGeoShop?.geocode_version !== GEOCODE_VERSION) {
        const coords = await geocodeAddress(geoQuery, payload);
        if (coords) {
          payload.lat = coords.lat;
          payload.lng = coords.lng;
          payload.geocode_query = geoQuery;
          payload.geocode_failed = false;
          payload.geocode_version = GEOCODE_VERSION;
        }
      }
      if (selected === 'new') {
        payload.team_id = profile.team_id;
        payload.assigned_to = profile.role === 'manager' ? (draft.assigned_to || profile.id) : profile.id;
        const ref = await addDoc(shopsCollection(payload.assigned_to), {
          ...payload,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
        setShops((prev) => [{ id: ref.id, ...payload, assigned_to: payload.assigned_to, team_id: payload.team_id, created_at: new Date(), updated_at: new Date() }, ...prev]);
      } else {
        const current = shops.find((s) => s.id === selected);
        const oldOwner = current?.assigned_to || profile.id;
        const newOwner = profile.role === 'manager' ? (payload.assigned_to || oldOwner) : oldOwner;
        payload.assigned_to = newOwner;
        if (newOwner !== oldOwner) {
          const oldRef = shopDoc(oldOwner, selected);
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
          await updateDoc(shopDoc(oldOwner, selected), {
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
      alert(error.message);
    } finally {
      setSaving(false);
    }
  }

  function buildReport() {
    if (!draft) return;
    const lines = [
      ['店铺名称', draft.name],
      ['城市', draft.city],
      ['地址', draft.address],
      ['评级', draft.tier || '未分级'],
      ['拜访状态', STATUS[draft.status] || draft.status],
      ['老板', draft.owner_name],
      ['店员', draft.staff_contact],
      ['老板到店规律', draft.owner_schedule],
      ['主要拿货二级批发商', draft.distributor],
      ['进货情况', draft.restock_status],
      ['是否放 Test Case', draft.test_case_today ? '是' : '否'],
      ['是否放 sample', draft.sample_today ? '是' : '否'],
      ['今日卖进数量', draft.units_today || ''],
      ['热卖品牌明细', draft.brands_note],
      ['备注', draft.traffic_note],
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

  const filtered = useMemo(() => {
    const matched = applyShopFilters(shops, {
      search, fTier, fStatus, fStarred, fCity, fSample, fTestCase, fAssignee, fCooperation, fSoldIn,
    });
    return sortShops(matched, sortBy);
  }, [shops, search, sortBy, fTier, fStatus, fStarred, fCity, fSample, fTestCase, fAssignee, fCooperation, fSoldIn]);

  const teamCities = useMemo(() => {
    const pool = profile?.team_id === 'tampa' ? TAMPA_CITIES : ORLANDO_CITIES;
    const fromShops = shops.map((s) => s.city).filter(Boolean);
    return [...new Set([...pool, ...fromShops])].sort((a, b) => a.localeCompare(b));
  }, [shops, profile?.team_id]);

  const myShops = useMemo(() => {
    if (profile?.role === 'manager') return shops;
    return shops.filter((s) => s.assigned_to === profile?.id);
  }, [shops, profile]);

  const dashboardRows = useMemo(() => {
    const start = dashFrom;
    const end = dashTo;
    if (!start || !end || start > end) return { mine: null, rows: [], team: null };

    if (profile?.role === 'manager') {
      const activeMembers = members.filter((m) => m.active);
      const rows = activeMembers.map((m) => ({
        id: m.id,
        name: m.full_name || m.email || m.id,
        ...computeAreaMetrics(shops.filter((s) => s.assigned_to === m.id), start, end),
      }));
      const team = computeAreaMetrics(shops, start, end);
      const mine = rows.find((r) => r.id === profile.id) || computeAreaMetrics(shops.filter((s) => s.assigned_to === profile.id), start, end);
      return { mine, rows, team };
    }

    const mine = computeAreaMetrics(myShops, start, end);
    return { mine, rows: [], team: null };
  }, [shops, members, profile, myShops, dashFrom, dashTo]);
  const draftNoteHistory = draft ? historyNotes(normalizeTrafficNotes(draft)) : [];
  const mappedCount = filtered.filter(shopHasCoords).length;
  const unmappedCount = filtered.filter((s) => geocodeQuery(s) && !shopHasCoords(s)).length;
  const noAddressCount = filtered.filter((s) => !geocodeQuery(s)).length;

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
      <button className="primary add-shop" type="button" onClick={openNew}>
        <Plus size={15} />添加店铺
      </button>
    </section>
  );

  const countRow = (
    <div className="count-row">
      <div className="count">
        共 {filtered.length} 家店铺
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
        {filtered.map((s) => (
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
                <span className="chip">{STATUS[s.status]}</span>
              </div>
            </div>
            <div className="meta">
              {s.starred && <span className="star-tag">重点关注</span>}
              {s.owner_name && <span>老板 {s.owner_name}</span>}
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
            {s.brands_note && <p>{s.brands_note}</p>}
            {formatNextPlan(s) && <p className="next">下次：{formatNextPlan(s)}</p>}
            {!formatNextPlan(s) && s.next_plan && <p className="next">下次：{s.next_plan}</p>}
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

  return (
    <main className={view === 'map' ? 'app map-mode' : view === 'dashboard' ? 'app dashboard-mode' : 'app'}>
      <header className="app-top">
        <div className="app-brand">
          <h1>门店拜访清单</h1>
          <span>{TEAM_LABEL[profile?.team_id] || profile?.team_id || 'Orlando'}</span>
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
            <section className="daily-report">
              <button type="button" onClick={generateDailyReport}>
                <Clipboard size={15} />生成今日汇报
              </button>
              <textarea
                value={dailyReportText}
                onChange={(e) => setDailyReportText(e.target.value)}
                placeholder={'点击「生成今日汇报」自动填充，可在此编辑\n\n日期：\n新店：\n新店中 A 级及以上：\n回访：\n样机投放数量：\n试抽盒投放数量：\n卖进总支数：\n遇到的问题：'}
                rows={10}
              />
              {dailyReportText && (
                <button type="button" onClick={copyDailyReport}>
                  <Copy size={14} />{dailyCopied ? '已复制' : '复制汇报'}
                </button>
              )}
            </section>
            <button className="primary daily-report-launch" type="button" onClick={openDailyReport}>
              <Clipboard size={15} />生成今日汇报
            </button>
            {profile?.role === 'manager' && (
              <div className="manager-note">Manager 模式：当前可查看团队全部门店 · {members.length} 个账号</div>
            )}
          </aside>
          <div className="app-content">
            {filterBar}
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
                />
              </React.Suspense>
            </div>
          </div>
        </div>
      )}
      {view === 'dashboard' && (
        <div className="dashboard-page">
          <DashboardPanel
            profile={profile}
            dashFrom={dashFrom}
            dashTo={dashTo}
            onFromChange={setDashFrom}
            onToChange={setDashTo}
            dashboardRows={dashboardRows}
          />
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
            <div className="grid">
              <Field label="店铺名称"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="城市">
                <select value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })}>
                  {draft.city && !CITIES.includes(draft.city) && (
                    <option value={draft.city}>{draft.city}</option>
                  )}
                  {CITIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field wide label="地址"><input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></Field>
              <Field label="评级">
                <select value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })}>
                  {['', 'S', 'A+', 'A', 'B'].map((x) => <option key={x} value={x}>{x || '未分级'}</option>)}
                </select>
              </Field>
              <Field label="拜访状态">
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="老板 / Decision maker"><input value={draft.owner_name} onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })} /></Field>
              <Field label="员工联系人"><input value={draft.staff_contact} onChange={(e) => setDraft({ ...draft, staff_contact: e.target.value })} /></Field>
              <Field label="老板到店规律"><input value={draft.owner_schedule} onChange={(e) => setDraft({ ...draft, owner_schedule: e.target.value })} /></Field>
              <Field label="主要拿货二级批发商"><input value={draft.distributor} onChange={(e) => setDraft({ ...draft, distributor: e.target.value })} /></Field>
              <Field label="进货情况"><input value={draft.restock_status} onChange={(e) => setDraft({ ...draft, restock_status: e.target.value })} /></Field>
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
              <Field label="今日卖进数量（支）">
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="填写今天卖进支数，隔天可重新填写"
                  value={draft.units_today}
                  onChange={(e) => setDraft({ ...draft, units_today: e.target.value })}
                />
              </Field>
              {profile?.role === 'manager' && (
                <Field label="负责人">
                  <select value={draft.assigned_to || profile.id} onChange={(e) => setDraft({ ...draft, assigned_to: e.target.value })}>
                    {members.filter((m) => m.active).map((m) => (
                      <option value={m.id} key={m.id}>{m.full_name || m.email} · {m.role}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field wide label="热卖品牌明细"><textarea value={draft.brands_note} onChange={(e) => setDraft({ ...draft, brands_note: e.target.value })} /></Field>
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
              <div className="field">
                <span>下次拜访日期（可选）</span>
                <div className="date-row">
                  <input
                    type="date"
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
              <h3>门店信息文本</h3>
              <button type="button" onClick={buildReport}><Clipboard size={14} />一键生成</button>
              {reportText && (
                <div style={{ marginTop: 10 }}>
                  <textarea readOnly value={reportText} style={{ minHeight: 160, whiteSpace: 'pre-wrap' }} />
                  <button type="button" style={{ marginTop: 8 }} onClick={copyReport}>
                    <Copy size={14} />{copied ? '已复制' : '复制文本'}
                  </button>
                </div>
              )}
            </div>
            <footer>
              <button className="primary" type="button" onClick={saveShop} disabled={saving}>
                <Save size={15} />{saving ? '保存中…' : '保存门店'}
              </button>
              {draft.address && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${draft.name} ${draft.address} ${draft.city} FL`)}`}
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
              {profile?.role === 'manager' && (
                <Field label="负责人">
                  <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
                    <option value="all">全部</option>
                    {members.filter((m) => m.active).map((m) => (
                      <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
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
                placeholder={'点击「重新生成」自动填充，可在此编辑\n\n日期：\n新店：\n新店中 A 级及以上：\n回访：\n样机投放数量：\n试抽盒投放数量：\n卖进总支数：\n遇到的问题：'}
                rows={12}
              />
              {dailyReportText && (
                <button type="button" onClick={copyDailyReport}>
                  <Copy size={14} />{dailyCopied ? '已复制' : '复制汇报'}
                </button>
              )}
            </div>
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

function DashboardPanel({ profile, dashFrom, dashTo, onFromChange, onToChange, dashboardRows }) {
  const { mine, rows, team } = dashboardRows;
  const invalidRange = !dashFrom || !dashTo || dashFrom > dashTo;

  return (
    <section className="dashboard">
      <div className="dashboard-head">
        <div>
          <h2>{profile?.role === 'manager' ? '团队区域看板' : '我的区域看板'}</h2>
          <p>Mapping 完成比例统一以 {MAPPING_TARGET} 家门店为分母</p>
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
      {invalidRange ? (
        <p className="dashboard-empty">请选择有效的时间段</p>
      ) : (
        <>
          {mine && (
            <div className="metrics-grid">
              <MetricCard label="负责区域跑店数" value={mine.visitedCount} hint={`${dashFrom} 至 ${dashTo}`} />
              <MetricCard label="Mapping 完成" value={`${mine.mappedCount} / ${MAPPING_TARGET}`} sub={mine.mappedPct} />
              <MetricCard label="A 级及以上" value={`${mine.aPlusCount} / ${mine.total}`} sub={mine.aPlusPct} />
              <MetricCard label="样机投放" value={mine.sampleCount} />
              <MetricCard label="试抽盒投放" value={mine.testCaseCount} />
              <MetricCard label="卖进门店" value={`${mine.soldInCount} / ${mine.total}`} sub={mine.soldInPct} />
              <MetricCard label="卖进总支数" value={mine.totalUnits} highlight />
            </div>
          )}
          {profile?.role === 'manager' && team && (
            <>
              <h3 className="dashboard-section-title">团队汇总</h3>
              <div className="metrics-grid team-summary">
                <MetricCard label="团队跑店数" value={team.visitedCount} />
                <MetricCard label="团队 Mapping" value={`${team.mappedCount} / ${MAPPING_TARGET}`} sub={team.mappedPct} />
                <MetricCard label="团队 A 级及以上" value={`${team.aPlusCount} / ${team.total}`} sub={team.aPlusPct} />
                <MetricCard label="团队样机投放" value={team.sampleCount} />
                <MetricCard label="团队试抽盒投放" value={team.testCaseCount} />
                <MetricCard label="团队卖进门店" value={`${team.soldInCount} / ${team.total}`} sub={team.soldInPct} />
                <MetricCard label="团队卖进总支数" value={team.totalUnits} highlight />
              </div>
              {rows.length > 0 && (
                <>
                  <h3 className="dashboard-section-title">各负责人明细</h3>
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
                        <tr className="total-row">
                          <td>团队合计</td>
                          <td>{team.visitedCount}</td>
                          <td>{team.mappedCount} ({team.mappedPct})</td>
                          <td>{team.aPlusCount} ({team.aPlusPct})</td>
                          <td>{team.sampleCount}</td>
                          <td>{team.testCaseCount}</td>
                          <td>{team.soldInCount} ({team.soldInPct})</td>
                          <td>{team.totalUnits}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
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
