// 試合：コート横で見る画面。作戦ボードに今の5人、下にベンチ、次の交代。
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Pause, Play, Plus, RotateCcw, Share2, Shuffle, UserRoundCog } from 'lucide-react';
import { diffRounds, isHelper, roleOf } from '../lib/rotation.js';
import { LIMITS } from '../lib/store.js';
import { buzz, fmtClock, keepAwake, namer, primeSound, shareOrCopy, shareText, whistle } from '../lib/util.js';
import { Confirm, Segmented, Sheet } from '../ui.jsx';

// ボード上の位置（ボードの横幅を100とした座標）
const PITCH_H = 78;
const FP_SLOTS = [
  [32, 17],
  [68, 17],
  [22, 42],
  [78, 42],
];
const GK_SLOT = [50, 63];
const BENCH_PER_ROW = 5;

/** フィールドの4か所を、前の試合からなるべく動かさずに割り当てる。 */
function fieldSlots(rounds, upto) {
  let slots = [null, null, null, null];
  for (let r = 0; r <= upto; r++) {
    const round = rounds[r];
    if (!round || round.waiting) continue;
    const next = slots.map((id) => (id && round.fp.includes(id) ? id : null));
    for (const id of round.fp) {
      if (next.includes(id)) continue;
      const free = next.indexOf(null);
      if (free >= 0) next[free] = id;
    }
    slots = next;
  }
  return slots;
}

function Board({ session, cur, selected, onTap }) {
  const round = session.rounds[cur];
  const name = namer(session);
  const slots = useMemo(() => fieldSlots(session.rounds, cur), [session.rounds, cur]);
  const bench = round.waiting ? [] : round.rest;
  const benchRows = Math.ceil(bench.length / BENCH_PER_ROW);
  const height = PITCH_H + (benchRows ? 9 + benchRows * 19 : 0);

  const magnets = [];
  if (!round.waiting) {
    magnets.push({ id: round.gk, role: 'gk', x: GK_SLOT[0], y: GK_SLOT[1] });
    slots.forEach((id, i) => {
      if (id) magnets.push({ id, role: 'fp', x: FP_SLOTS[i][0], y: FP_SLOTS[i][1] });
    });
    bench.forEach((id, i) => {
      const row = Math.floor(i / BENCH_PER_ROW);
      const inRow = Math.min(BENCH_PER_ROW, bench.length - row * BENCH_PER_ROW);
      const col = i % BENCH_PER_ROW;
      magnets.push({ id, role: 'rest', x: 50 + (col - (inRow - 1) / 2) * 18.5, y: PITCH_H + 17 + row * 19 });
    });
  }
  magnets.sort((a, b) => (a.id < b.id ? -1 : 1)); // 並び順を固定して、試合を切り替えたとき滑らかに動かす

  return (
    <div className="board" style={{ aspectRatio: `100 / ${height}` }}>
      <svg className="pitch" viewBox={`0 0 100 ${PITCH_H}`} style={{ height: `${(PITCH_H / height) * 100}%` }} aria-hidden="true">
        <rect className="turf" x="0" y="0" width="100" height={PITCH_H} rx="3.5" />
        <g className="chalk">
          <path d="M4 4 H96 V73 H4 Z" />
          <path d="M36 4 A14 14 0 0 0 64 4" />
          <path d="M15 73 A28 28 0 0 1 43 45 H57 A28 28 0 0 1 85 73" />
          <path d="M43 73 v3.2 h14 v-3.2" />
        </g>
        <circle className="spot" cx="50" cy="45" r="0.9" />
        <circle className="spot" cx="50" cy="26" r="0.9" />
      </svg>
      {benchRows > 0 && (
        <div className="bench" style={{ top: `${(PITCH_H / height) * 100}%` }}>
          <span>休み</span>
        </div>
      )}
      {round.waiting && (
        <div className="board-wait" style={{ height: `${(PITCH_H / height) * 100}%` }}>
          <strong>メンバー待ち</strong>
          <span>いま{(round.present || []).length}人。2人そろえば助っ人を入れて始められます</span>
        </div>
      )}
      {magnets.map((m) => {
        const label = name(m.id);
        const len = [...label].length;
        return (
          <button
            key={m.id}
            type="button"
            className={`magnet is-${m.role} ${isHelper(m.id) ? 'is-helper' : ''} ${selected === m.id ? 'is-selected' : ''} len-${Math.min(len, 6)}`}
            style={{ left: `${m.x}%`, top: `${(m.y / height) * 100}%` }}
            onClick={() => onTap(m.id)}
            aria-pressed={selected === m.id}
            aria-label={`${label}（${m.role === 'gk' ? 'ゴールキーパー' : m.role === 'fp' ? 'フィールド' : '休み'}）`}
          >
            <span className="magnet-name">{label}</span>
            {m.role === 'gk' && <span className="magnet-tag">GK</span>}
          </button>
        );
      })}
    </div>
  );
}

function Timer({ session, dispatch, onNext, isLast }) {
  const { timer } = session;
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);

  useEffect(() => {
    if (!timer.running) return undefined;
    fired.current = false;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= timer.endsAt && !fired.current) {
        fired.current = true;
        dispatch({ type: 'timer/pause', now: t });
        whistle();
        buzz([400, 150, 400, 150, 800]);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [timer.running, timer.endsAt, dispatch]);

  useEffect(() => {
    keepAwake(timer.running);
    if (!timer.running) return undefined;
    const again = () => document.visibilityState === 'visible' && keepAwake(true);
    document.addEventListener('visibilitychange', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      keepAwake(false);
    };
  }, [timer.running]);

  const remain = timer.running ? Math.max(0, timer.endsAt - now) : timer.remainMs;
  const full = session.matchMin * 60000;
  const untouched = !timer.running && !timer.done && timer.remainMs === full;

  return (
    <section className={`timer ${timer.done ? 'is-done' : ''} ${timer.running ? 'is-running' : ''}`} aria-label="試合タイマー">
      <div className="timer-face">
        <span className="timer-clock num" role="timer">
          {fmtClock(remain)}
        </span>
        {!untouched && <span className="timer-note">{timer.done ? 'タイムアップ' : timer.running ? '試合中' : '一時停止中'}</span>}
      </div>
      <div className="timer-actions">
        {!untouched && (
          <button type="button" className="icon-btn" onClick={() => dispatch({ type: 'timer/reset' })} aria-label="タイマーを戻す">
            <RotateCcw size={20} />
          </button>
        )}
        {timer.done && !isLast ? (
          <button type="button" className="btn btn-primary" onClick={onNext}>
            次の試合へ
          </button>
        ) : timer.running ? (
          <button type="button" className="btn btn-quiet" onClick={() => dispatch({ type: 'timer/pause', now: Date.now() })}>
            <Pause size={18} />
            止める
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              primeSound();
              dispatch({ type: 'timer/start', now: Date.now() });
            }}
          >
            <Play size={18} />
            {untouched || timer.done ? '開始' : '再開'}
          </button>
        )}
      </div>
    </section>
  );
}

function NextUp({ session, cur, onNext, dispatch }) {
  const name = namer(session);
  const round = session.rounds[cur];
  const next = session.rounds[cur + 1];
  if (!next) {
    return (
      <section className="nextup">
        <h2>最後の試合です</h2>
        <div className="nextup-foot">
          <button type="button" className="btn btn-quiet" disabled={session.total >= LIMITS.total[1]} onClick={() => dispatch({ type: 'session/total', total: session.total + 1 })}>
            <Plus size={18} />
            もう1試合追加
          </button>
        </div>
      </section>
    );
  }
  const d = diffRounds(round, next);
  return (
    <section className="nextup">
      <h2>
        次は第<span className="num">{cur + 2}</span>試合
      </h2>
      {next.waiting ? (
        <p className="nextup-line">メンバー待ちです</p>
      ) : (
        <dl className="changes">
          <div>
            <dt className="is-gk">GK</dt>
            <dd>
              {name(d.gk)}
              {!d.gkChanged && <small>（続けて）</small>}
            </dd>
          </div>
          {d.ins.length > 0 && (
            <div>
              <dt className="is-in">入る</dt>
              <dd>{d.ins.map(name).join('、')}</dd>
            </div>
          )}
          {d.outs.length > 0 && (
            <div>
              <dt className="is-out">出る</dt>
              <dd>{d.outs.map(name).join('、')}</dd>
            </div>
          )}
          {!round.waiting && d.ins.length === 0 && d.outs.length === 0 && (
            <div>
              <dt>交代</dt>
              <dd>なし{d.gkChanged ? '（GKだけ替わります）' : ''}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="nextup-foot">
        <button type="button" className="btn btn-quiet" onClick={onNext}>
          第{cur + 2}試合へ進む
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}

function PresenceSheet({ open, onClose, state, dispatch, toast }) {
  const { session, members } = state;
  const { cur, total, timer } = session;
  const started = timer.running || timer.done || timer.remainMs !== session.matchMin * 60000;
  const [when, setWhen] = useState('now');
  useEffect(() => {
    if (open) setWhen(started && cur + 1 < total ? 'next' : 'now');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const from = when === 'next' ? cur + 1 : cur;
  const guests = members.filter((m) => !session.players.some((p) => p.id === m.id));
  const change = (id, present, label) => {
    dispatch({ type: 'session/presence', id, from, present });
    onClose();
    toast(`${label}。第${from + 1}試合から組み直しました`, { undo: true });
  };

  return (
    <Sheet open title="メンバーの出入り" onClose={onClose}>
      <div className="group">
        <div className="group-row">
          <span>いつから反映</span>
          <Segmented
            label="いつから反映"
            value={when}
            onChange={setWhen}
            options={[
              { value: 'now', label: `この試合（第${cur + 1}）` },
              { value: 'next', label: `次（第${cur + 2}）`, disabled: cur + 1 >= total },
            ]}
          />
        </div>
      </div>
      <ul className="presence">
        {session.players.map((p) => {
          const list = session.avail[p.id];
          const here = list[from];
          const everHere = list.slice(0, from).some(Boolean);
          const lateAtStart = !list[0];
          return (
            <li key={p.id}>
              <div className="presence-who">
                <strong>{p.name}</strong>
                <small className={here ? '' : 'is-away'}>{here ? '参加中' : everHere ? '離脱' : '未着'}</small>
              </div>
              {(lateAtStart || p.late !== 'none') && (
                <button
                  type="button"
                  className={`chip chip-small ${p.late === 'counted' ? 'is-warn' : ''}`}
                  onClick={() => dispatch({ type: 'session/late', id: p.id, late: p.late === 'counted' ? 'excused' : 'counted' })}
                >
                  {p.late === 'counted' ? '遅刻に数える' : '遅刻に数えない'}
                </button>
              )}
              {here ? (
                <button type="button" className="btn btn-quiet btn-small" onClick={() => change(p.id, false, `${p.name}が抜けます`)}>
                  抜ける
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-small" onClick={() => change(p.id, true, `${p.name}が入ります`)}>
                  {everHere ? '戻る' : '到着'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {guests.length > 0 && (
        <>
          <p className="sheet-label">名簿から飛び入りで追加</p>
          <div className="chips">
            {guests.map((m) => (
              <button key={m.id} type="button" className="chip" onClick={() => change(m.id, true, `${m.name}が入ります`)}>
                <Plus size={15} />
                {m.name}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

export default function Match({ state, dispatch, go, toast }) {
  const { session } = state;
  const [selected, setSelected] = useState(null);
  const [presence, setPresence] = useState(false);
  const [askFinish, setAskFinish] = useState(false);
  const cur = session ? session.cur : 0;

  useEffect(() => setSelected(null), [cur]);

  if (!session) {
    return (
      <div className="page page-empty">
        <svg className="empty-art" viewBox="0 0 100 78" aria-hidden="true">
          <rect className="turf" width="100" height="78" rx="3.5" />
          <g className="chalk">
            <path d="M4 4 H96 V73 H4 Z" />
            <path d="M36 4 A14 14 0 0 0 64 4" />
            <path d="M15 73 A28 28 0 0 1 43 45 H57 A28 28 0 0 1 85 73" />
          </g>
        </svg>
        <h1>まだローテーションがありません</h1>
        <p>「準備」で今日来る人を選ぶと、ここに作戦ボードが出ます。</p>
        <button type="button" className="btn btn-primary btn-large" onClick={() => go('setup')}>
          メンバーを選ぶ
        </button>
      </div>
    );
  }

  const round = session.rounds[cur];
  const name = namer(session);
  const isLast = cur >= session.total - 1;
  const goto = (i) => dispatch({ type: 'session/goto', cur: i });
  const away = session.players.filter((p) => !session.avail[p.id][cur]);
  const helpers = round.waiting ? 0 : [round.gk, ...round.fp].filter(isHelper).length;

  const tap = (id) => {
    if (!selected) return setSelected(id);
    if (selected === id) return setSelected(null);
    if (roleOf(round, selected) === roleOf(round, id)) return setSelected(id);
    dispatch({ type: 'session/swap', round: cur, a: selected, b: id });
    setSelected(null);
    return toast(`${name(selected)}と${name(id)}を入れ替えました${isLast ? '' : '。次の試合からは組み直しています'}`, { undo: true });
  };

  const share = async () => {
    const result = await shareOrCopy(shareText(session));
    if (result === 'copied') toast('ローテーション表をコピーしました');
    if (result === 'failed') toast('共有できませんでした');
  };

  return (
    <div className="page page-match">
      <header className="match-head">
        <h1>
          第<span className="num">{cur + 1}</span>試合
          <small>
            全<span className="num">{session.total}</span>試合
          </small>
        </h1>
        <div className="match-nav">
          <button type="button" className="icon-btn is-boxed" onClick={() => goto(cur - 1)} disabled={cur === 0} aria-label="前の試合">
            <ChevronLeft size={24} />
          </button>
          <button type="button" className="icon-btn is-boxed" onClick={() => goto(cur + 1)} disabled={isLast} aria-label="次の試合">
            <ChevronRight size={24} />
          </button>
        </div>
      </header>
      <ol className="ticks" aria-hidden="true">
        {session.rounds.map((_, i) => (
          <li key={i} className={i < cur ? 'is-done' : i === cur ? 'is-now' : ''} />
        ))}
      </ol>

      <Board session={session} cur={cur} selected={selected} onTap={tap} />

      <p className={`board-hint ${selected ? 'is-active' : ''}`}>
        <ArrowLeftRight size={15} />
        {selected ? `${name(selected)}と入れ替える人をタップ` : '2人を順にタップすると入れ替え'}
      </p>

      {(helpers > 0 || away.length > 0) && (
        <ul className="notes">
          {helpers > 0 && <li>助っ人{helpers}人が入ります{isHelper(round.gk) ? '。GKは助っ人にお願いします' : ''}</li>}
          {away.map((p) => {
            const list = session.avail[p.id];
            const back = list.findIndex((v, r) => r > cur && v);
            const gone = list.slice(0, cur).some(Boolean);
            return (
              <li key={p.id}>
                {p.name}：{gone ? '離脱' : '未着'}
                {back >= 0 ? `（第${back + 1}試合から）` : ''}
              </li>
            );
          })}
        </ul>
      )}

      <Timer session={session} dispatch={dispatch} isLast={isLast} onNext={() => goto(cur + 1)} />
      <NextUp session={session} cur={cur} dispatch={dispatch} onNext={() => goto(cur + 1)} />

      <div className="toolbar">
        <button type="button" onClick={() => setPresence(true)}>
          <UserRoundCog size={20} />
          出入り
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'session/shuffle', from: cur, seed: Math.floor(Math.random() * 1e9) + 1 });
            toast(`第${cur + 1}試合から別の組み合わせにしました`, { undo: true });
          }}
        >
          <Shuffle size={20} />
          組み替え
        </button>
        <button type="button" onClick={share}>
          <Share2 size={20} />
          共有
        </button>
      </div>

      <button type="button" className="link link-center" onClick={() => setAskFinish(true)}>
        今日はここまで（記録して終了）
      </button>

      <PresenceSheet open={presence} onClose={() => setPresence(false)} state={state} dispatch={dispatch} toast={toast} />
      <Confirm
        open={askFinish}
        title="今日の分を終了しますか？"
        body="参加者と遅刻を「記録」に残して、ローテーションを閉じます。"
        yes="記録して終了"
        onYes={() => {
          dispatch({ type: 'session/finish' });
          go('records');
          toast('おつかれさまでした。記録に残しました');
        }}
        onClose={() => setAskFinish(false)}
      />
    </div>
  );
}
