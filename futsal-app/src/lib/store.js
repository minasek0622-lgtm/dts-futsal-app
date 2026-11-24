// アプリ全体の状態と、その変更ルール（reducer）。保存先はこの端末の localStorage。
import { planRotation, swapRoles } from './rotation.js';

const STORAGE_KEY = 'futsal.v4';
export const APP_VERSION = '4.0.0';

export const LIMITS = {
  total: [1, 30],
  matchMin: [3, 20],
  otherTeams: [1, 5],
};

const DEFAULT_MEMBERS = ['喜種', '上野', '川邉', '畑中', '山本', '伊達', '武田'].map((name, i) => ({
  id: `m${i + 1}`,
  name,
}));

export function todayISO(d = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function initialState() {
  return {
    v: 4,
    members: DEFAULT_MEMBERS,
    lateCounts: {}, // 通算の遅刻回数 { [id]: n }
    setup: { selected: [], late: {}, total: 10, matchMin: 7, otherTeams: 2 },
    session: null, // 今日のローテーション
    history: [], // 過去の開催
    theme: 'auto',
    undo: null,
  };
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

/** 読み込んだデータの形を整える。壊れている部分は初期値に戻す。 */
export function normalize(raw) {
  const base = initialState();
  if (!raw || typeof raw !== 'object') return base;
  const members = Array.isArray(raw.members)
    ? raw.members
        .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string' && m.name.trim())
        .map((m) => ({ id: m.id, name: m.name.trim().slice(0, 12) }))
    : base.members;
  const known = new Set(members.map((m) => m.id));
  const lateCounts = {};
  if (raw.lateCounts && typeof raw.lateCounts === 'object') {
    for (const [id, n] of Object.entries(raw.lateCounts)) {
      if (known.has(id) && Number(n) > 0) lateCounts[id] = Math.floor(Number(n));
    }
  }
  const s = raw.setup && typeof raw.setup === 'object' ? raw.setup : {};
  const total = clamp(s.total ?? base.setup.total, LIMITS.total);
  const late = {};
  if (s.late && typeof s.late === 'object') {
    for (const [id, l] of Object.entries(s.late)) {
      if (!known.has(id) || !l) continue;
      late[id] = {
        from: Math.max(1, Math.min(total - 1, Math.round(Number(l.from) || 1))),
        min: Number(l.min) > 0 ? Number(l.min) : null,
        excused: Boolean(l.excused),
      };
    }
  }
  const setup = {
    selected: Array.isArray(s.selected) ? s.selected.filter((id) => known.has(id)) : [],
    late,
    total,
    matchMin: clamp(s.matchMin ?? base.setup.matchMin, LIMITS.matchMin),
    otherTeams: clamp(s.otherTeams ?? base.setup.otherTeams, LIMITS.otherTeams),
  };
  let session = null;
  const rs = raw.session;
  if (rs && Array.isArray(rs.players) && Array.isArray(rs.rounds) && rs.avail && rs.rounds.length === rs.total) {
    session = {
      ...rs,
      cur: Math.min(rs.total - 1, Math.max(0, rs.cur || 0)),
      lateApplied: Array.isArray(rs.lateApplied) ? rs.lateApplied : [],
      timer: rs.timer && typeof rs.timer.remainMs === 'number' ? rs.timer : freshTimer(rs.matchMin || 7),
    };
  }
  return {
    v: 4,
    members,
    lateCounts,
    setup,
    session,
    history: Array.isArray(raw.history) ? raw.history.filter((h) => h && h.date && Array.isArray(h.players)) : [],
    theme: ['auto', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'auto',
    undo: null,
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
    // 旧バージョン（v3まで）のメンバーと遅刻回数を引き継ぐ
    const oldMembers = JSON.parse(localStorage.getItem('futsal_members') || 'null');
    const oldLate = JSON.parse(localStorage.getItem('futsal_lateCounts') || 'null');
    if (oldMembers || oldLate) {
      return normalize({ ...initialState(), members: oldMembers || DEFAULT_MEMBERS, lateCounts: oldLate || {} });
    }
  } catch {
    /* 保存領域が使えない環境でも動かす */
  }
  return initialState();
}

export function saveState(state) {
  try {
    const { undo, ...rest } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    /* 保存できなくても画面は動かす */
  }
}

export const exportData = (state) => {
  const { undo, ...rest } = state;
  return JSON.stringify({ app: 'futsal-rotation', exportedAt: new Date().toISOString(), ...rest }, null, 2);
};

// ───────── セッション（今日のローテーション）の部品 ─────────

const freshTimer = (matchMin) => ({ running: false, endsAt: null, remainMs: matchMin * 60000, done: false });

function replan(session, from, seed = session.seed) {
  const rounds = planRotation({
    players: session.players,
    avail: session.avail,
    total: session.total,
    fixed: session.rounds.slice(0, from),
    seed: seed + from * 7919,
  });
  return { ...session, seed, rounds };
}

/** 通算の遅刻回数を、セッションの遅刻設定と食い違わないように合わせる。何度呼んでも二重に数えない。 */
function reconcileLate(lateCounts, session, applied) {
  const want = new Set(session ? session.players.filter((p) => p.late === 'counted').map((p) => p.id) : []);
  const had = new Set(applied || []);
  const counts = { ...lateCounts };
  for (const id of want) if (!had.has(id)) counts[id] = (counts[id] || 0) + 1;
  for (const id of had) {
    if (want.has(id)) continue;
    counts[id] = Math.max(0, (counts[id] || 0) - 1);
    if (!counts[id]) delete counts[id];
  }
  return { lateCounts: counts, lateApplied: [...want] };
}

function toHistory(session) {
  const came = session.players.filter((p) => session.avail[p.id]?.some(Boolean));
  return {
    id: session.id,
    date: session.date,
    total: session.total,
    players: came.map(({ id, name }) => ({ id, name })),
    late: session.players.filter((p) => p.late === 'counted').map((p) => p.id),
    excused: session.players.filter((p) => p.late === 'excused').map((p) => p.id),
  };
}

const withUndo = (state, label) => ({ session: state.session, lateCounts: state.lateCounts, label });

// ───────── reducer ─────────

export function reducer(state, action) {
  switch (action.type) {
    // ── メンバー ──
    case 'member/add': {
      const name = action.name.trim().slice(0, 12);
      if (!name) return state;
      return {
        ...state,
        members: [...state.members, { id: action.id, name }],
        setup: { ...state.setup, selected: [...state.setup.selected, action.id] },
      };
    }
    case 'member/rename': {
      const name = action.name.trim().slice(0, 12);
      if (!name) return state;
      const rename = (list) => list.map((m) => (m.id === action.id ? { ...m, name } : m));
      return {
        ...state,
        members: rename(state.members),
        session: state.session ? { ...state.session, players: rename(state.session.players) } : null,
      };
    }
    case 'member/remove': {
      const { [action.id]: _l, ...late } = state.setup.late;
      const { [action.id]: _c, ...lateCounts } = state.lateCounts;
      return {
        ...state,
        members: state.members.filter((m) => m.id !== action.id),
        lateCounts,
        setup: { ...state.setup, selected: state.setup.selected.filter((id) => id !== action.id), late },
      };
    }
    case 'member/move': {
      const i = state.members.findIndex((m) => m.id === action.id);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= state.members.length) return state;
      const members = state.members.slice();
      [members[i], members[j]] = [members[j], members[i]];
      return { ...state, members };
    }

    // ── 準備 ──
    case 'setup/toggle': {
      const on = state.setup.selected.includes(action.id);
      const { [action.id]: _l, ...lateRest } = state.setup.late;
      return {
        ...state,
        setup: {
          ...state.setup,
          selected: on ? state.setup.selected.filter((id) => id !== action.id) : [...state.setup.selected, action.id],
          late: on ? lateRest : state.setup.late,
        },
      };
    }
    case 'setup/selectAll':
      return { ...state, setup: { ...state.setup, selected: state.members.map((m) => m.id) } };
    case 'setup/clear':
      return { ...state, setup: { ...state.setup, selected: [], late: {} } };
    case 'setup/late': {
      const { [action.id]: _l, ...rest } = state.setup.late;
      return { ...state, setup: { ...state.setup, late: action.late ? { ...rest, [action.id]: action.late } : rest } };
    }
    case 'setup/config': {
      const value = clamp(action.value, LIMITS[action.key]);
      const setup = { ...state.setup, [action.key]: value };
      if (action.key === 'total') {
        const late = {};
        for (const [id, l] of Object.entries(setup.late)) late[id] = { ...l, from: Math.max(1, Math.min(l.from, value - 1)) };
        setup.late = late;
      }
      return { ...state, setup };
    }

    // ── 今日のローテーション ──
    case 'session/create': {
      const { setup } = state;
      let history = state.history;
      let applied = [];
      if (state.session) {
        if (state.session.date === action.date) applied = state.session.lateApplied; // 同じ日の作り直し：遅刻は数え直さない
        else history = [toHistory(state.session), ...history]; // 前回分は記録へ
      }
      const players = state.members
        .filter((m) => setup.selected.includes(m.id))
        .map((m) => {
          const l = setup.late[m.id];
          return { id: m.id, name: m.name, late: l ? (l.excused ? 'excused' : 'counted') : 'none', lateMin: l?.min ?? null };
        });
      const avail = {};
      for (const p of players) {
        const from = setup.late[p.id] ? setup.late[p.id].from : 0;
        avail[p.id] = Array.from({ length: setup.total }, (_, r) => r >= from);
      }
      let session = {
        id: `s${action.now}`,
        date: action.date,
        createdAt: action.now,
        seed: action.seed,
        players,
        avail,
        total: setup.total,
        matchMin: setup.matchMin,
        rounds: [],
        cur: 0,
        timer: freshTimer(setup.matchMin),
        lateApplied: [],
      };
      session = replan(session, 0);
      const rec = reconcileLate(state.lateCounts, session, applied);
      return { ...state, history, lateCounts: rec.lateCounts, session: { ...session, lateApplied: rec.lateApplied }, undo: null };
    }
    case 'session/goto': {
      const s = state.session;
      if (!s) return state;
      const cur = Math.min(s.total - 1, Math.max(0, action.cur));
      if (cur === s.cur) return state;
      return { ...state, session: { ...s, cur, timer: s.timer.running ? s.timer : freshTimer(s.matchMin) } };
    }
    case 'session/swap': {
      const s = state.session;
      if (!s) return state;
      const swapped = swapRoles(s.rounds[action.round], action.a, action.b);
      if (swapped === s.rounds[action.round]) return state;
      const rounds = s.rounds.slice();
      rounds[action.round] = swapped;
      // 入れ替えた試合は確定とし、それより後ろを組み直して偏りを取り戻す
      return { ...state, undo: withUndo(state, '入れ替え'), session: replan({ ...s, rounds }, action.round + 1) };
    }
    case 'session/presence': {
      const s = state.session;
      if (!s) return state;
      let players = s.players;
      const avail = { ...s.avail };
      if (!players.some((p) => p.id === action.id)) {
        const m = state.members.find((x) => x.id === action.id);
        if (!m) return state;
        players = [...players, { id: m.id, name: m.name, late: 'none', lateMin: null }];
        avail[m.id] = new Array(s.total).fill(false);
      }
      avail[action.id] = avail[action.id].map((v, r) => (r >= action.from ? action.present : v));
      return { ...state, undo: withUndo(state, '出入りの変更'), session: replan({ ...s, players, avail }, action.from) };
    }
    case 'session/late': {
      const s = state.session;
      if (!s) return state;
      const players = s.players.map((p) => (p.id === action.id ? { ...p, late: action.late } : p));
      const session = { ...s, players };
      const rec = reconcileLate(state.lateCounts, session, s.lateApplied);
      return { ...state, lateCounts: rec.lateCounts, session: { ...session, lateApplied: rec.lateApplied } };
    }
    case 'session/total': {
      const s = state.session;
      if (!s) return state;
      const total = Math.max(s.cur + 1, clamp(action.total, LIMITS.total));
      if (total === s.total) return state;
      const avail = {};
      for (const [id, list] of Object.entries(s.avail)) {
        avail[id] = total < list.length ? list.slice(0, total) : list.concat(new Array(total - list.length).fill(list[list.length - 1] ?? true));
      }
      const next = { ...s, total, avail, rounds: s.rounds.slice(0, total) };
      return { ...state, undo: withUndo(state, '試合数の変更'), session: total > s.total ? replan(next, s.total) : next };
    }
    case 'session/shuffle': {
      const s = state.session;
      if (!s) return state;
      return { ...state, undo: withUndo(state, '組み替え'), session: replan(s, action.from, action.seed) };
    }
    case 'session/finish': {
      if (!state.session) return state;
      return {
        ...state,
        history: [toHistory(state.session), ...state.history],
        session: null,
        setup: { ...state.setup, late: {} },
        undo: null,
      };
    }
    case 'session/discard': {
      if (!state.session) return state;
      const rec = reconcileLate(state.lateCounts, null, state.session.lateApplied);
      return { ...state, lateCounts: rec.lateCounts, session: null, undo: null };
    }
    case 'undo': {
      if (!state.undo) return state;
      return { ...state, session: state.undo.session, lateCounts: state.undo.lateCounts, undo: null };
    }

    // ── タイマー ──
    case 'timer/start': {
      const s = state.session;
      if (!s || s.timer.running) return state;
      const remainMs = s.timer.remainMs > 0 ? s.timer.remainMs : s.matchMin * 60000;
      return { ...state, session: { ...s, timer: { running: true, endsAt: action.now + remainMs, remainMs, done: false } } };
    }
    case 'timer/pause': {
      const s = state.session;
      if (!s || !s.timer.running) return state;
      const remainMs = Math.max(0, s.timer.endsAt - action.now);
      return { ...state, session: { ...s, timer: { running: false, endsAt: null, remainMs, done: remainMs === 0 } } };
    }
    case 'timer/reset': {
      const s = state.session;
      if (!s) return state;
      return { ...state, session: { ...s, timer: freshTimer(s.matchMin) } };
    }

    // ── 記録・設定 ──
    case 'late/adjust': {
      const n = Math.max(0, (state.lateCounts[action.id] || 0) + action.delta);
      const { [action.id]: _c, ...rest } = state.lateCounts;
      return { ...state, lateCounts: n ? { ...rest, [action.id]: n } : rest };
    }
    case 'history/remove':
      return { ...state, history: state.history.filter((h) => h.id !== action.id) };
    case 'theme':
      return { ...state, theme: action.value };
    case 'data/replace':
      return normalize(action.data);
    case 'data/reset':
      return initialState();
    default:
      return state;
  }
}
