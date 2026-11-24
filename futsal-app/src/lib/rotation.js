// ローテーション計算。React に依存しない純粋な関数だけを置く。
//
// 1試合 = { waiting, gk, fp[], rest[], out[], manual? }
//   gk   … GK の id（助っ人なら "@H1"）
//   fp   … フィールドプレーヤーの id（必ず4人。助っ人は "@H2" など）
//   rest … 休みの id
//   out  … その試合にいない人（未着・離脱）の id
// コートに立つのは常に GK1 + FP4 = 5人。人数から先に休みを決めるのではなく、
// 「5人を選び、残り全員が休み」と組み立てるので、何人いても5人を超えない。

export const COURT_SIZE = 5;
export const MIN_MEMBERS = 2; // これ未満は助っ人を入れても試合にしない（メンバー待ち）
const HELPER_PREFIX = '@H';

export const helperId = (n) => `${HELPER_PREFIX}${n}`;
export const isHelper = (id) => typeof id === 'string' && id.startsWith(HELPER_PREFIX);

/** 遅刻の分数から「何試合目から入れるか」を見積もる（0始まりの試合番号を返す）。 */
export function estimateJoinRound(delayMin, otherTeams, matchMin) {
  if (!delayMin || delayMin <= 0) return 0;
  const interval = Math.max(1, otherTeams) * Math.max(1, matchMin);
  return Math.ceil(delayMin / interval);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 重み。数字が大きいほど「避けたい」。
const W = {
  CONSEC_REST: 450, // 2試合続けて休み
  NEAR_REST: 25, // 1試合おきに休み
  REST_BALANCE: 300, // 休み回数の偏り（目標との差の二乗に掛ける）
  GK_BALANCE: 250, // GK回数の偏り
  REST_ON_ARRIVAL: 60, // 着いた直後に休み
  GK_ON_ARRIVAL: 400, // 着いた直後にGK
  HARD: 1e6, // 絶対ルール（休み→GK、GK→休み）
  CONSEC_GK: 5000, // 2試合続けてGK
  COUNT: 100, // 下書きでの回数の偏り
  SINCE_REST: 4, // 前の休みから間が空いている人ほど休ませやすい
  SINCE_GK: 3,
  BEAM: 24,
  TEMP_START: 250,
  TEMP_END: 2,
};

/**
 * ローテーションを組む。
 *
 * 進め方は2段階。
 *   1. 下書き：第1試合から順に、GK回数・休み回数が少ない人を優先して当てていく。
 *   2. 清書：できた表の「休み」や「GK」を1人ずつ別の人に替えてみて、
 *      連続休みや回数の偏りが減るなら採用する。これを数千回くり返す。
 * どちらの段階でも絶対ルール（休み→GK、GK→休み）を破る組み合わせは選ばない。
 *
 * @param players [{id}] 並び順は表示順
 * @param avail   { [id]: boolean[] } 試合ごとに参加できるか
 * @param total   試合数
 * @param fixed   すでに確定している先頭の試合（ここは変えずに続きを組む）
 * @param seed    同じ seed なら同じ結果。変えると別パターンになる
 */
export function planRotation({ players, avail, total, fixed = [], seed = 1 }) {
  const ids = players.map((p) => p.id);
  const n = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const rand = mulberry32(seed || 1);
  const fixedCount = Math.min(fixed.length, total);

  // ── 骨組み：各試合に誰がいるか ──
  const rounds = [];
  for (let r = 0; r < total; r++) {
    if (r < fixedCount) {
      const src = fixed[r];
      const pick = (list) => (list || []).filter((id) => idx.has(id)).map((id) => idx.get(id));
      if (src.waiting) {
        rounds.push({ kind: 'wait', present: pick(src.present), gk: -1, rest: [], locked: true, source: src });
      } else {
        const gk = idx.has(src.gk) ? idx.get(src.gk) : -1;
        const rest = pick(src.rest);
        const present = [...(gk >= 0 ? [gk] : []), ...pick(src.fp), ...rest];
        rounds.push({ kind: 'play', present, gk, rest, locked: true, source: src });
      }
      continue;
    }
    const present = [];
    for (let i = 0; i < n; i++) if (avail[ids[i]] && avail[ids[i]][r]) present.push(i);
    const kind = present.length < MIN_MEMBERS ? 'wait' : present.length < COURT_SIZE ? 'helper' : 'play';
    rounds.push({ kind, present, gk: -1, rest: [], locked: false });
  }
  const firstSeen = new Array(n).fill(-1);
  rounds.forEach((round, r) => {
    for (const i of round.present) if (firstSeen[i] < 0) firstSeen[i] = r;
  });
  const real = (r) => r >= 0 && r < total && rounds[r].kind !== 'wait'; // 待ちを挟んだら前後のつながりは見ない

  const need = (round) => (round.kind === 'play' ? Math.max(0, round.present.length - COURT_SIZE) : 0);

  // 一人ひとりの「本来まわってくるはずの回数」。途中参加の人は、いた試合の分だけ数える。
  const gkShare = new Array(n).fill(0);
  const restTarget = new Array(n).fill(0);
  rounds.forEach((round) => {
    const m = round.present.length;
    if (round.kind !== 'play' || m < COURT_SIZE) return;
    for (const i of round.present) gkShare[i] += 1 / m;
    const k = round.locked ? round.rest.length : need(round);
    for (const i of round.present) restTarget[i] += k / m;
  });

  // ── 1. 下書き：1試合ずつ、その時点でいちばん無理のない組み合わせを選んでいく ──
  // 有望な候補を複数残しながら進める（ビームサーチ）。
  const draft = (() => {
    const since = (r, last) => Math.min(r - last, 12);
    const noise = rounds.map(() => ids.map(() => [rand(), rand()]));
    let states = [
      {
        cost: 0,
        gk: new Array(n).fill(0),
        rest: new Array(n).fill(0),
        lastGk: new Array(n).fill(-99),
        lastRest: new Array(n).fill(-99),
        seen: new Array(n).fill(false),
        prev: null,
        picks: [],
      },
    ];
    // 初めて来た人には、いまいる人の平均回数を持たせる（0回のままだと来た途端に出ずっぱりになる）
    const welcome = (s, present) => {
      const fresh = present.filter((i) => !s.seen[i]);
      if (!fresh.length) return { s, fresh };
      const old = present.filter((i) => s.seen[i]);
      const mean = (arr) => (old.length ? old.reduce((x, i) => x + arr[i], 0) / old.length : 0);
      const next = { ...s, gk: s.gk.slice(), rest: s.rest.slice(), seen: s.seen.slice() };
      const mg = mean(s.gk);
      const mr = mean(s.rest);
      for (const i of fresh) {
        next.gk[i] = mg;
        next.rest[i] = mr;
        next.seen[i] = true;
      }
      return { s: next, fresh };
    };
    const advance = (s, r, kind, gk, rest, addCost) => {
      const next = {
        cost: s.cost + addCost,
        gk: s.gk.slice(),
        rest: s.rest.slice(),
        lastGk: s.lastGk.slice(),
        lastRest: s.lastRest.slice(),
        seen: s.seen,
        prev: null,
        picks: s.picks.concat([{ gk, rest }]),
      };
      if (kind === 'wait') return next;
      if (gk >= 0) {
        next.gk[gk] += 1;
        next.lastGk[gk] = r;
      }
      for (const i of rest) {
        next.rest[i] += 1;
        next.lastRest[i] = r;
      }
      next.prev = { gk, rest: new Set(rest) };
      return next;
    };
    for (let r = 0; r < total; r++) {
      const round = rounds[r];
      const present = round.present;
      const k = need(round);
      const grown = [];
      for (const st of states) {
        const { s, fresh } = welcome(st, present);
        if (round.locked || round.kind !== 'play') {
          grown.push(advance(s, r, round.kind, round.gk, round.rest, 0));
          continue;
        }
        const prev = s.prev;
        const isFresh = new Set(fresh);
        const restCost = new Map();
        for (const p of present) {
          let c = W.COUNT * (2 * s.rest[p] + 1);
          if (prev && prev.gk === p) c += W.HARD;
          if (prev && prev.rest.has(p)) c += W.CONSEC_REST;
          if (isFresh.has(p) && r > 0) c += W.REST_ON_ARRIVAL;
          c -= W.SINCE_REST * since(r, s.lastRest[p]);
          restCost.set(p, c + noise[r][p][0]);
        }
        const byRest = present.slice().sort((x, y) => restCost.get(x) - restCost.get(y));
        for (const g of present) {
          let gc = W.COUNT * (2 * s.gk[g] + 1);
          if (prev && prev.rest.has(g)) gc += W.HARD;
          if (prev && prev.gk === g) gc += W.CONSEC_GK;
          if (isFresh.has(g) && r > 0) gc += W.GK_ON_ARRIVAL;
          gc -= W.SINCE_GK * since(r, s.lastGk[g]);
          gc += noise[r][g][1];
          const pool = byRest.filter((p) => p !== g);
          const push = (rest) => grown.push(advance(s, r, 'play', g, rest, gc + rest.reduce((x, p) => x + restCost.get(p), 0)));
          push(pool.slice(0, k));
          if (k > 0 && pool.length > k) push(pool.slice(0, k - 1).concat([pool[k]])); // 次点も候補に残す
        }
      }
      grown.sort((x, y) => x.cost - y.cost);
      states = grown.slice(0, W.BEAM);
    }
    return states[0].picks;
  })();

  // ── 2. 清書の準備 ──
  const gkAt = draft.map((pick) => pick.gk);
  const restList = draft.map((pick) => pick.rest.slice());
  const isRest = new Uint8Array(total * n);
  restList.forEach((list, r) => {
    for (const i of list) isRest[r * n + i] = 1;
  });
  // その試合で休めるか：GK本人・前の試合のGK（GK→休み）・次の試合のGK（休み→GK）は休めない
  const canRest = (r, i) =>
    gkAt[r] !== i && !(real(r - 1) && gkAt[r - 1] === i) && !(real(r + 1) && gkAt[r + 1] === i);

  // ── 3. 入れ替えを繰り返して整える（焼きなまし法） ──
  // 「休みを別の人に替える」「GKを別の人に替える」を少しずつ試し、良くなる方へ寄せていく。
  const playerCost = (p) => {
    let rests = 0;
    let gks = 0;
    let last = -99;
    let run = 0; // 休みが何試合続いているか
    let c = 0;
    for (let r = 0; r < total; r++) {
      if (gkAt[r] === p) {
        gks += 1;
        if (firstSeen[p] === r && r > 0) c += W.GK_ON_ARRIVAL;
      }
      if (!isRest[r * n + p]) continue;
      rests += 1;
      const gap = r - last;
      run = gap === 1 ? run + 1 : 1;
      if (gap === 1) c += W.CONSEC_REST * (run - 1); // 3連続・4連続になるほど重くする
      else if (gap === 2 && real(r - 1)) c += W.NEAR_REST;
      if (firstSeen[p] === r && r > 0) c += W.REST_ON_ARRIVAL;
      last = r;
    }
    return c + W.REST_BALANCE * (rests - restTarget[p]) ** 2 + W.GK_BALANCE * (gks - gkShare[p]) ** 2;
  };

  const restRounds = [];
  const gkRounds = [];
  rounds.forEach((round, r) => {
    if (round.locked || round.kind !== 'play') return;
    gkRounds.push(r);
    if (need(round)) restRounds.push(r);
  });
  if (restRounds.length) {
    const maxK = Math.max(...restRounds.map((r) => need(rounds[r])));
    const iters = Math.min(120000, 8000 + 800 * restRounds.length * maxK);
    const cost = new Array(n).fill(0).map((_, p) => playerCost(p));
    let current = cost.reduce((x, y) => x + y, 0);
    let bestCost = current;
    const snapshot = () => ({ gk: gkAt.slice(), rest: restList.map((l) => l.slice()) });
    let best = snapshot();
    const settle = (a, b, undo) => {
      const ca = playerCost(a);
      const cb = playerCost(b);
      const delta = ca + cb - cost[a] - cost[b];
      const temp = W.TEMP_START * Math.pow(W.TEMP_END / W.TEMP_START, step / iters);
      if (delta <= 0 || rand() < Math.exp(-delta / temp)) {
        cost[a] = ca;
        cost[b] = cb;
        current += delta;
        if (current < bestCost - 1e-9) {
          bestCost = current;
          best = snapshot();
        }
      } else {
        undo();
      }
    };
    let step = 0;
    for (; step < iters; step++) {
      if (rand() < 0.25) {
        // GKを、同じ試合のフィールドの誰かと替える
        const r = gkRounds[Math.floor(rand() * gkRounds.length)];
        const g = gkAt[r];
        const present = rounds[r].present;
        const f = present[Math.floor(rand() * present.length)];
        if (f === g || isRest[r * n + f]) continue;
        if (real(r - 1) && (isRest[(r - 1) * n + f] || gkAt[r - 1] === f)) continue;
        if (real(r + 1) && (isRest[(r + 1) * n + f] || gkAt[r + 1] === f)) continue;
        gkAt[r] = f;
        settle(g, f, () => {
          gkAt[r] = g;
        });
      } else {
        // 休みの1人を、同じ試合の別の人と替える
        const r = restRounds[Math.floor(rand() * restRounds.length)];
        const list = restList[r];
        const slot = Math.floor(rand() * list.length);
        const a = list[slot];
        const present = rounds[r].present;
        const b = present[Math.floor(rand() * present.length)];
        if (isRest[r * n + b] || !canRest(r, b)) continue;
        list[slot] = b;
        isRest[r * n + a] = 0;
        isRest[r * n + b] = 1;
        settle(a, b, () => {
          list[slot] = a;
          isRest[r * n + a] = 1;
          isRest[r * n + b] = 0;
        });
      }
    }
    best.gk.forEach((g, r) => {
      gkAt[r] = g;
    });
    best.rest.forEach((l, r) => {
      restList[r] = l;
    });
  }
  const resting = restList.map((l) => new Set(l));
  rounds.forEach((round, r) => {
    round.gk = gkAt[r];
  });

  // ── 出力 ──
  return rounds.map((round, r) => {
    if (round.locked) return round.source;
    const here = new Set(round.present);
    const out = ids.filter((_, i) => !here.has(i));
    if (round.kind === 'wait') {
      return { waiting: true, gk: null, fp: [], rest: [], present: round.present.map((i) => ids[i]), out };
    }
    if (round.kind === 'helper') {
      // 足りない分は助っ人。1人目の助っ人がGK、メンバーは全員フィールド。
      const fp = round.present.map((i) => ids[i]);
      for (let h = 2; h <= COURT_SIZE - round.present.length; h++) fp.push(helperId(h));
      return { waiting: false, gk: helperId(1), fp, rest: [], out };
    }
    const rest = round.present.filter((i) => resting[r].has(i));
    const fp = round.present.filter((i) => i !== round.gk && !resting[r].has(i));
    return { waiting: false, gk: ids[round.gk], fp: fp.map((i) => ids[i]), rest: rest.map((i) => ids[i]), out };
  });
}

/** その試合での役割。'gk' | 'fp' | 'rest' | 'out' | 'waiting' */
export function roleOf(round, id) {
  if (!round) return 'out';
  if (round.waiting) return (round.present || []).includes(id) ? 'waiting' : 'out';
  if (round.gk === id) return 'gk';
  if (round.fp.includes(id)) return 'fp';
  if (round.rest.includes(id)) return 'rest';
  return 'out';
}

/** 同じ試合の中で2人の役割を入れ替えた新しい試合を返す。 */
export function swapRoles(round, a, b) {
  if (!round || round.waiting || a === b) return round;
  const ra = roleOf(round, a);
  const rb = roleOf(round, b);
  if (ra === rb || ra === 'out' || rb === 'out') return round;
  const sw = (id) => (id === a ? b : id === b ? a : id);
  return { ...round, gk: sw(round.gk), fp: round.fp.map(sw), rest: round.rest.map(sw), manual: true };
}

/** ルール違反を探す。空配列なら問題なし。 */
export function validateRotation(rounds) {
  const issues = [];
  rounds.forEach((round, r) => {
    if (round.waiting) return;
    const court = 1 + round.fp.length;
    if (court !== COURT_SIZE) issues.push({ round: r, type: 'court', count: court });
    const prev = r > 0 ? rounds[r - 1] : null;
    if (!prev || prev.waiting) return;
    if (!isHelper(round.gk) && prev.rest.includes(round.gk)) issues.push({ round: r, type: 'rest-gk', id: round.gk });
    if (!isHelper(prev.gk) && round.rest.includes(prev.gk)) issues.push({ round: r, type: 'gk-rest', id: prev.gk });
  });
  return issues;
}

/** 1人ごとの回数。 */
export function tally(rounds, ids) {
  const out = {};
  for (const id of ids) out[id] = { gk: 0, fp: 0, rest: 0, out: 0 };
  for (const round of rounds) {
    for (const id of ids) {
      const role = roleOf(round, id);
      if (role === 'gk') out[id].gk += 1;
      else if (role === 'fp') out[id].fp += 1;
      else if (role === 'rest') out[id].rest += 1;
      else out[id].out += 1;
    }
  }
  return out;
}

/** 次の試合で誰が入って誰が出るか。 */
export function diffRounds(cur, next) {
  if (!cur || !next || next.waiting) return { ins: [], outs: [], gk: next ? next.gk : null, gkChanged: false };
  const courtOf = (r) => (r.waiting ? [] : [r.gk, ...r.fp]);
  const a = new Set(courtOf(cur));
  const b = new Set(courtOf(next));
  return {
    ins: [...b].filter((id) => !a.has(id)),
    outs: [...a].filter((id) => !b.has(id)),
    gk: next.gk,
    gkChanged: cur.waiting || cur.gk !== next.gk,
  };
}
