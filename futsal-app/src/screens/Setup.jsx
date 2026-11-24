// 準備：今日来る人を選び、試合の設定をして、ローテーションを作る。
import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { estimateJoinRound, COURT_SIZE, MIN_MEMBERS } from '../lib/rotation.js';
import { LIMITS, todayISO } from '../lib/store.js';
import { fmtDate } from '../lib/util.js';
import { Cards, Confirm, Segmented, Sheet, Stepper } from '../ui.jsx';

const DELAYS = [15, 30, 45, 60, 90];

export default function Setup({ state, dispatch, go, toast }) {
  const { members, setup, session, lateCounts } = state;
  const [editing, setEditing] = useState(false);
  const [lateFor, setLateFor] = useState(null);
  const [name, setName] = useState('');
  const [askRecreate, setAskRecreate] = useState(false);
  const [askRemove, setAskRemove] = useState(null);

  const selected = members.filter((m) => setup.selected.includes(m.id));
  const count = selected.length;
  const lateIds = selected.filter((m) => setup.late[m.id]).map((m) => m.id);
  const atStart = count - lateIds.length;
  const interval = setup.otherTeams * setup.matchMin;
  const sameDay = session && session.date === todayISO();

  const add = () => {
    const clean = name.trim();
    if (!clean) return;
    if (members.some((m) => m.name === clean)) {
      toast(`「${clean}」はすでにいます`);
      return;
    }
    dispatch({ type: 'member/add', id: `m${Date.now()}`, name: clean });
    setName('');
  };

  const create = () => {
    dispatch({ type: 'session/create', now: Date.now(), date: todayISO(), seed: Math.floor(Math.random() * 1e9) + 1 });
    go('match');
  };

  let summary;
  if (count === 0) summary = '今日来る人をタップして選びます';
  else if (count < MIN_MEMBERS) summary = `あと${MIN_MEMBERS - count}人選ぶと作れます`;
  else {
    const parts = [`${count}人`];
    parts.push(count > COURT_SIZE ? `毎試合${count - COURT_SIZE}人が休み` : count === COURT_SIZE ? '休みなし' : `助っ人${COURT_SIZE - count}人`);
    if (lateIds.length) {
      if (atStart < MIN_MEMBERS) parts.push(`開始時${atStart}人（人数待ち）`);
      else if (atStart < COURT_SIZE) parts.push(`開始時${atStart}人（助っ人${COURT_SIZE - atStart}人）`);
      else parts.push(`開始時${atStart}人`);
    }
    summary = parts.join('、');
  }

  const lateMember = lateFor ? members.find((m) => m.id === lateFor) : null;
  const late = lateFor ? setup.late[lateFor] : null;
  const setLate = (patch) => {
    const base = late || { from: 1, min: null, excused: false };
    dispatch({ type: 'setup/late', id: lateFor, late: { ...base, ...patch } });
  };
  const maxFrom = Math.max(1, setup.total - 1);

  return (
    <div className="page page-setup">
      <header className="page-head">
        <div>
          <h1>{editing ? '名簿の編集' : '今日のメンバー'}</h1>
          <p className="page-sub">{editing ? '並べ替え・名前の変更・削除' : fmtDate(todayISO())}</p>
        </div>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setEditing((v) => !v)}>
          {editing ? (
            <>
              <Check size={16} />
              完了
            </>
          ) : (
            <>
              <Pencil size={15} />
              名簿を編集
            </>
          )}
        </button>
      </header>

      {session && !editing && (
        <button type="button" className="notice" onClick={() => go('match')}>
          <span>
            <strong>{sameDay ? '今日' : fmtDate(session.date)}のローテーションがあります</strong>
            <small>第{session.cur + 1}試合を表示中。ここで選び直しても、作り直すまで変わりません。</small>
          </span>
          <span className="notice-go">試合へ</span>
        </button>
      )}

      <ul className={`roster ${editing ? 'is-editing' : ''}`}>
        {members.map((m, i) => {
          const on = setup.selected.includes(m.id);
          const l = setup.late[m.id];
          if (editing) {
            return (
              <li key={m.id} className="roster-row">
                <div className="reorder">
                  <button type="button" className="icon-btn" disabled={i === 0} onClick={() => dispatch({ type: 'member/move', id: m.id, dir: -1 })} aria-label={`${m.name}を上へ`}>
                    <ArrowUp size={18} />
                  </button>
                  <button type="button" className="icon-btn" disabled={i === members.length - 1} onClick={() => dispatch({ type: 'member/move', id: m.id, dir: 1 })} aria-label={`${m.name}を下へ`}>
                    <ArrowDown size={18} />
                  </button>
                </div>
                <input
                  className="field roster-input"
                  defaultValue={m.name}
                  maxLength={12}
                  aria-label="名前"
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value.trim() !== m.name) dispatch({ type: 'member/rename', id: m.id, name: e.target.value });
                    else e.target.value = m.name;
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                />
                <button type="button" className="icon-btn is-danger" onClick={() => setAskRemove(m)} aria-label={`${m.name}を削除`}>
                  <Trash2 size={19} />
                </button>
              </li>
            );
          }
          return (
            <li key={m.id} className={`roster-row ${on ? 'is-on' : ''}`}>
              <button type="button" className="roster-main" aria-pressed={on} onClick={() => dispatch({ type: 'setup/toggle', id: m.id })}>
                <span className="tick">{on && <Check size={18} strokeWidth={3} />}</span>
                <span className="roster-name">{m.name}</span>
                <Cards count={lateCounts[m.id]} />
              </button>
              {on && (
                <button type="button" className={`late-chip ${l ? 'is-late' : ''}`} onClick={() => setLateFor(m.id)}>
                  <Clock size={15} />
                  {l ? `第${l.from + 1}試合から${l.excused ? '（免除）' : ''}` : '遅刻'}
                </button>
              )}
            </li>
          );
        })}
        <li className="roster-row roster-add">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <span className="tick is-plus">
              <Plus size={18} />
            </span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="名前を入れて追加" maxLength={12} enterKeyHint="done" aria-label="追加するメンバーの名前" />
            <button type="submit" className="btn btn-quiet btn-small" disabled={!name.trim()}>
              追加
            </button>
          </form>
        </li>
      </ul>

      {!editing && (
        <>
          <div className="roster-tools">
            <button type="button" className="link" onClick={() => dispatch({ type: 'setup/selectAll' })}>
              全員を選ぶ
            </button>
            <button type="button" className="link" onClick={() => dispatch({ type: 'setup/clear' })} disabled={!count}>
              選択を外す
            </button>
          </div>

          <section className="group" aria-label="試合の設定">
            <div className="group-row">
              <span>試合数</span>
              <Stepper label="試合数" value={setup.total} min={LIMITS.total[0]} max={LIMITS.total[1]} onChange={(v) => dispatch({ type: 'setup/config', key: 'total', value: v })} />
            </div>
            <div className="group-row">
              <span>1試合の時間</span>
              <Stepper label="1試合の時間" unit="分" value={setup.matchMin} min={LIMITS.matchMin[0]} max={LIMITS.matchMin[1]} onChange={(v) => dispatch({ type: 'setup/config', key: 'matchMin', value: v })} />
            </div>
            <div className="group-row">
              <span>
                相手チーム数
                <small>自分たちの試合は約{interval}分おき。遅刻の目安に使います</small>
              </span>
              <Stepper label="相手チーム数" value={setup.otherTeams} min={LIMITS.otherTeams[0]} max={LIMITS.otherTeams[1]} onChange={(v) => dispatch({ type: 'setup/config', key: 'otherTeams', value: v })} />
            </div>
          </section>

          <div className="cta">
            <p className="cta-summary">{summary}</p>
            <button type="button" className="btn btn-primary btn-large" disabled={count < MIN_MEMBERS} onClick={() => (sameDay ? setAskRecreate(true) : create())}>
              {sameDay ? 'ローテーションを作り直す' : 'ローテーションを作る'}
            </button>
          </div>
        </>
      )}

      <Sheet open={Boolean(lateMember)} title={lateMember ? `${lateMember.name}の遅刻` : ''} onClose={() => setLateFor(null)}>
        <p className="sheet-label">どのくらい遅れる？</p>
        <div className="chips">
          {DELAYS.map((min) => (
            <button
              key={min}
              type="button"
              className={`chip ${late?.min === min ? 'is-on' : ''}`}
              onClick={() => setLate({ min, from: Math.max(1, Math.min(maxFrom, estimateJoinRound(min, setup.otherTeams, setup.matchMin))) })}
            >
              {min}分
            </button>
          ))}
        </div>
        <div className="group">
          <div className="group-row">
            <span>
              参加する試合
              <small>分数から自動で入ります。ずれるときは直接直せます</small>
            </span>
            <Stepper label="参加する試合" unit="試合目" value={(late?.from ?? 1) + 1} min={2} max={maxFrom + 1} onChange={(v) => setLate({ from: v - 1, min: null })} />
          </div>
          <div className="group-row">
            <span>
              遅刻の回数
              <small>仕事など仕方ない理由なら「数えない」</small>
            </span>
            <Segmented
              label="遅刻の回数"
              value={late ? Boolean(late.excused) : false}
              onChange={(v) => setLate({ excused: v })}
              options={[
                { value: false, label: '数える' },
                { value: true, label: '数えない' },
              ]}
            />
          </div>
        </div>
        <div className="sheet-actions">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={!late}
            onClick={() => {
              dispatch({ type: 'setup/late', id: lateFor, late: null });
              setLateFor(null);
            }}
          >
            遅刻なしに戻す
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (!late) setLate({});
              setLateFor(null);
            }}
          >
            {late ? '決定' : '第2試合からにする'}
          </button>
        </div>
      </Sheet>

      <Confirm
        open={askRecreate}
        title="作り直しますか？"
        body={`いまのローテーション（第${session ? session.cur + 1 : 1}試合を表示中）を捨てて、選んだ${count}人で第1試合から組み直します。入れ替えや途中の出入りは消えます。`}
        yes="作り直す"
        onYes={create}
        onClose={() => setAskRecreate(false)}
      />
      <Confirm
        open={Boolean(askRemove)}
        title={askRemove ? `${askRemove.name}を名簿から削除` : ''}
        body="通算の遅刻回数も消えます。過去の開催記録には名前が残ります。"
        yes="削除する"
        danger
        onYes={() => dispatch({ type: 'member/remove', id: askRemove.id })}
        onClose={() => setAskRemove(null)}
      />
    </div>
  );
}
