import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, X, ExternalLink, LogOut, Save, Users, Clipboard, Copy, Star,
} from 'lucide-react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, configured, db, DEFAULT_TEAM_ID, googleProvider } from './firebase';

const CITIES = [
  'Orlando', 'Winter Park', 'Kissimmee', 'Sanford', 'Altamonte Springs',
  'Lake Mary', 'Apopka', 'Oviedo', 'Winter Garden', 'Windermere',
  'Ocoee', 'Clermont', 'St Cloud', 'Casselberry', 'Maitland',
  'Longwood', 'Winter Springs', 'Celebration', 'Dr. Phillips', 'Lake Buena Vista',
  'Davenport', 'Poinciana',
];
const STATUS = {
  not_visited: '待拜访',
  visited: '已卖进/拜访',
  follow_up: '需跟进',
  no_interest: '无意向/暂缓',
};
const emptyShop = () => ({
  name: '', address: '', city: 'Orlando', phone: '', tier: '', status: 'not_visited',
  is_chain: false, chain_name: '', chain_total_stores: '', staff_contact: '', owner_name: '',
  owner_schedule: '', contact_role: '', store_number: '', restock_status: '', distributor: '',
  test_case_placed: false, traffic_note: '', brands_note: '', next_plan: '',
  next_plan_date: '', next_plan_time: '', source_url: '', starred: false,
});

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
  { value: 'next_follow_up', label: '下次跟进时间（由近到远）' },
  { value: 'tier', label: '分级' },
];

function authMessage(err) {
  const code = err?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return '邮箱或密码不正确';
  }
  if (code.includes('popup-closed')) return '已取消 Google 登录';
  if (code.includes('popup-blocked')) return '浏览器拦截了弹窗，请允许后重试';
  if (code.includes('too-many-requests')) return '尝试次数过多，请稍后再试';
  return err?.message || '登录失败';
}

function timeValue(value) {
  if (!value) return 0;
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

function buildDailyReportText(shopList) {
  const today = todayDateKey();
  const todayShops = shopList.filter((s) => shopUpdatedDateKey(s) === today);
  const visitCount = todayShops.length;
  const aPlusCount = todayShops.filter((s) => isTierAPlus(s.tier)).length;
  const testCaseCount = todayShops.filter((s) => s.test_case_placed).length;
  return [
    `日期：${today}`,
    `访店数量：${visitCount}`,
    `A级及以上门店数：${aPlusCount}`,
    `样机投放数量：`,
    `试抽盒投放数量：${testCaseCount || ''}`,
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
    return 'Firestore 拒绝读取。请确认已创建数据库，并把仓库里的 firestore.rules 发布到规则页。';
  }
  if (code.includes('unavailable') || code.includes('not-found')) {
    return '连不上 Firestore。请在 Firebase 控制台创建 Firestore 数据库后再刷新。';
  }
  return error?.message || '加载失败';
}

async function ensureProfile(user) {
  const ref = doc(db, 'profiles', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  const profile = {
    full_name: user.displayName || (user.email || '').split('@')[0],
    email: user.email || '',
    role: 'sales',
    team_id: DEFAULT_TEAM_ID,
    active: true,
  };
  await setDoc(ref, profile);
  return { id: user.uid, ...profile };
}

async function fetchTeamData(currentUser) {
  const p = await withTimeout(
    ensureProfile(currentUser),
    20000,
    '读取账号超时。请刷新页面，或检查网络是否拦截了 Firestore。',
  );
  const shopQuery = p.role === 'manager'
    ? query(collection(db, 'shops'), where('team_id', '==', p.team_id))
    : query(collection(db, 'shops'), where('assigned_to', '==', currentUser.uid));
  const shopSnap = await withTimeout(
    getDocs(shopQuery),
    20000,
    '读取门店超时。多半是浏览器连不上 Firestore，请硬刷新后再试；若仍失败，换 Chrome 打开同一网址。',
  );
  const shops = shopSnap.docs
    .map((item) => ({ id: item.id, ...item.data() }));
  let members = [];
  if (p.role === 'manager') {
    const memberSnap = await getDocs(query(collection(db, 'profiles'), where('team_id', '==', p.team_id)));
    members = memberSnap.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''));
  }
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setErr(authMessage(error));
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
        setErr(authMessage(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="panel" onSubmit={submit}>
        <h1>门店拜访清单</h1>
        <p>Orlando · Firebase 云端版</p>
        <button className="google" type="button" onClick={google} disabled={busy}>
          <GoogleMark /> 使用 Google 账号登录
        </button>
        <div className="or">或使用邮箱密码</div>
        <label>邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></label>
        <label>密码<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required /></label>
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
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
  const [dailyReportText, setDailyReportText] = useState('');
  const [dailyCopied, setDailyCopied] = useState(false);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reportText, setReportText] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setSelected(shop.id);
    setDraft({
      ...shop,
      chain_total_stores: shop.chain_total_stores ?? '',
      next_plan_date: shop.next_plan_date || '',
      next_plan_time: shop.next_plan_time || '',
      starred: Boolean(shop.starred),
    });
    setReportText('');
    setCopied(false);
  }

  async function toggleStar(shop, e) {
    e?.stopPropagation?.();
    const next = !shop.starred;
    try {
      await updateDoc(doc(db, 'shops', shop.id), {
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
    setDraft(emptyShop());
    setReportText('');
    setCopied(false);
  }

  async function saveShop() {
    if (!draft.name.trim() || saving) return;
    const nextPlanText = formatNextPlan(draft);
    const payload = withoutUndefined({
      ...draft,
      name: draft.name.trim(),
      chain_total_stores: draft.chain_total_stores === '' ? null : Number(draft.chain_total_stores),
      next_plan_date: draft.next_plan_date || '',
      next_plan_time: draft.next_plan_date ? (draft.next_plan_time || '') : '',
      next_plan: nextPlanText,
    });
    delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;
    setSaving(true);
    try {
      if (selected === 'new') {
        payload.team_id = profile.team_id;
        payload.assigned_to = profile.role === 'manager' ? (draft.assigned_to || profile.id) : profile.id;
        const ref = await addDoc(collection(db, 'shops'), {
          ...payload,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
        setShops((prev) => [{ id: ref.id, ...payload, assigned_to: payload.assigned_to, team_id: payload.team_id, created_at: new Date(), updated_at: new Date() }, ...prev]);
      } else {
        await updateDoc(doc(db, 'shops', selected), {
          ...payload,
          updated_at: serverTimestamp(),
        });
        setShops((prev) => {
          const next = { ...draft, ...payload, id: selected, updated_at: new Date() };
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
      ['是否放 Test Case', draft.test_case_placed ? '是' : '否'],
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

  function generateDailyReport() {
    setDailyReportText(buildDailyReportText(shops));
    setDailyCopied(false);
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
    const q = search.toLowerCase().trim();
    const matched = shops.filter((s) => !q || [s.name, s.address, s.city, s.owner_name, s.staff_contact].some((v) => (v || '').toLowerCase().includes(q)));
    return sortShops(matched, sortBy);
  }, [shops, search, sortBy]);

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
    <main className="app">
      <header>
        <div>
          <h1>门店拜访清单</h1>
          <span>Orlando</span>
        </div>
        <div className="user">
          <Users size={15} />
          {profile?.full_name || user.email}
          <b>{profile?.role === 'manager' ? 'Manager' : 'Sales'}</b>
          <button type="button" onClick={() => signOut(auth)}><LogOut size={15} />退出</button>
        </div>
      </header>
      {loadError && <div className="error">{loadError}</div>}
      <section className="toolbar">
        <div className="search">
          <Search size={15} />
          <input placeholder="搜索店名 / 地址 / 城市 / 联系人" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="primary" type="button" onClick={openNew}><Plus size={15} />添加店铺</button>
        <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button type="button" onClick={generateDailyReport}><Clipboard size={15} />生成今日汇报</button>
      </section>
      <section className="daily-report">
        <textarea
          value={dailyReportText}
          onChange={(e) => setDailyReportText(e.target.value)}
          placeholder={'点击「生成今日汇报」自动填充，可在此编辑\n\n日期：\n访店数量：\nA级及以上门店数：\n样机投放数量：\n试抽盒投放数量：\n遇到的问题：'}
          rows={8}
        />
        {dailyReportText && (
          <button type="button" onClick={copyDailyReport}>
            <Copy size={14} />{dailyCopied ? '已复制' : '复制汇报'}
          </button>
        )}
      </section>
      {profile?.role === 'manager' && (
        <div className="manager-note">Manager 模式：当前可查看团队全部门店 · {members.length} 个账号</div>
      )}
      <div className="count">共 {filtered.length} 家店铺</div>
      <section>
        {filtered.map((s) => (
          <article className={s.starred ? 'card starred' : 'card'} key={s.id} onClick={() => openShop(s)}>
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
              <div>
                <span className="chip">{s.tier || '未分级'}</span>
                <span className="chip">{STATUS[s.status]}</span>
              </div>
            </div>
            <div className="meta">
              {s.starred && <span className="star-tag">重点关注</span>}
              {s.owner_name && <span>老板 {s.owner_name}</span>}
              {s.distributor && <span>批发商 {s.distributor}</span>}
              {s.test_case_placed && <span>已放 Test Case</span>}
            </div>
            {s.traffic_note && <p className="remark">{s.traffic_note}</p>}
            {s.brands_note && <p>{s.brands_note}</p>}
            {formatNextPlan(s) && <p className="next">下次：{formatNextPlan(s)}</p>}
            {!formatNextPlan(s) && s.next_plan && <p className="next">下次：{s.next_plan}</p>}
          </article>
        ))}
      </section>
      {draft && (
        <div className="modal" onMouseDown={() => { setDraft(null); setSelected(null); }}>
          <div className="editor" onMouseDown={(e) => e.stopPropagation()}>
            <div className="editorhead">
              <h2>{selected === 'new' ? '添加店铺' : '编辑店铺'}</h2>
              <button type="button" onClick={() => setDraft(null)}><X size={18} /></button>
            </div>
            <div className="grid">
              <Field label="店铺名称"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="城市">
                <select value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })}>
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
              <Field label="星标（定期重点关注）">
                <select value={draft.starred ? 'yes' : 'no'} onChange={(e) => setDraft({ ...draft, starred: e.target.value === 'yes' })}>
                  <option value="no">否</option>
                  <option value="yes">是</option>
                </select>
              </Field>
              <Field label="老板 / Decision maker"><input value={draft.owner_name} onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })} /></Field>
              <Field label="员工联系人"><input value={draft.staff_contact} onChange={(e) => setDraft({ ...draft, staff_contact: e.target.value })} /></Field>
              <Field label="老板到店规律"><input value={draft.owner_schedule} onChange={(e) => setDraft({ ...draft, owner_schedule: e.target.value })} /></Field>
              <Field label="主要拿货二级批发商"><input value={draft.distributor} onChange={(e) => setDraft({ ...draft, distributor: e.target.value })} /></Field>
              <Field label="进货情况"><input value={draft.restock_status} onChange={(e) => setDraft({ ...draft, restock_status: e.target.value })} /></Field>
              <Field label="是否放 Test Case">
                <select value={draft.test_case_placed ? 'yes' : 'no'} onChange={(e) => setDraft({ ...draft, test_case_placed: e.target.value === 'yes' })}>
                  <option value="no">否</option>
                  <option value="yes">是</option>
                </select>
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
              <Field wide label="备注"><textarea value={draft.traffic_note} onChange={(e) => setDraft({ ...draft, traffic_note: e.target.value })} /></Field>
              <Field label="下次拜访日期（可选）">
                <input
                  type="date"
                  value={draft.next_plan_date || ''}
                  onChange={(e) => setDraft({
                    ...draft,
                    next_plan_date: e.target.value,
                    next_plan_time: e.target.value ? draft.next_plan_time : '',
                  })}
                />
              </Field>
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
    </main>
  );
}

function Field({ label, children, wide }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span>{children}</label>;
}
