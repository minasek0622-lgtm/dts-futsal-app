// 全体表：全試合の割り当てと、今日の出場バランス。
import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { isHelper, roleOf, tally, validateRotation } from '../lib/rotation.js';
import { LIMITS } from '../lib/store.js';
import { fmtDate, namer, shareOrCopy, shareText } from '../lib/util.js';
import { Stepper } from '../ui.jsx';

const CELL = { gk: 'GK', fp: '', rest: '休', out: '', waiting: '待' };

export default function Table({ state, dispatch, go, toast }) {
  const { session } = state;
  const [focus, setFocus] = useState(null);

  if (!session) {
    return (
      <div className="page page-empty">
        <h1>表はまだありません</h1>
        <p>ローテーションを作ると、全試合の割り当てがここに並びます。</p>
        <button type="button" className="btn btn-primary btn-large" onClick={() => go('setup')}>
          メンバーを選ぶ
        </button>
      </div>
    );
  }

  const name = namer(session);
  const players = session.players;
  const ids = players.map((p) => p.id);
  const stats = tally(session.rounds, ids);
  const hasHelper = session.rounds.some((r) => !r.waiting && [r.gk, ...r.fp].some(isHelper));
  const issues = validateRotation(session.rounds).filter((i) => i.type !== 'court');
  const most = Math.max(1, ...ids.map((id) => stats[id].gk + stats[id].fp + stats[id].rest));

  const share = async () => {
    const result = await shareOrCopy(shareText(session));
    if (result === 'copied') toast('ローテーション表をコピーしました');
    if (result === 'failed') toast('共有できませんでした');
  };

  return (
    <div className="page page-table">
      <header className="page-head">
        <div>
          <h1>全体表</h1>
          <p className="page-sub">
            {fmtDate(session.date)}　{players.length}人
          </p>
        </div>
        <button type="button" className="btn btn-quiet btn-small" onClick={share}>
          <Share2 size={16} />
          共有
        </button>
      </header>

      <div className="sheet-table-wrap">
        <table className={`rota ${focus ? 'has-focus' : ''}`} style={{ '--cols': players.length + (hasHelper ? 1 : 0) }}>
          <thead>
            <tr>
              <th className="rota-corner" scope="col">
                <span className="sr">試合</span>
              </th>
              {players.map((p) => (
                <th key={p.id} scope="col" className={focus === p.id ? 'is-focus' : ''}>
                  <button type="button" onClick={() => setFocus(focus === p.id ? null : p.id)} aria-pressed={focus === p.id}>
                    <span className="rota-name">{p.name}</span>
                  </button>
                </th>
              ))}
              {hasHelper && (
                <th scope="col" className="is-helper">
                  <span className="rota-name">助っ人</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {session.rounds.map((round, r) => (
              <tr key={r} className={`${r === session.cur ? 'is-now' : ''} ${r < session.cur ? 'is-past' : ''}`}>
                <th scope="row">
                  <button type="button" className="num" onClick={() => dispatch({ type: 'session/goto', cur: r })} aria-label={`第${r + 1}試合を表示`}>
                    {r + 1}
                  </button>
                </th>
                {players.map((p) => {
                  const role = roleOf(round, p.id);
                  return (
                    <td key={p.id} className={`c-${role} ${focus === p.id ? 'is-focus' : ''}`}>
                      <span>{CELL[role]}</span>
                    </td>
                  );
                })}
                {hasHelper && (
                  <td className="c-helper">
                    <span>{round.waiting ? '' : isHelper(round.gk) ? `GK${round.fp.filter(isHelper).length ? `+${round.fp.filter(isHelper).length}` : ''}` : round.fp.filter(isHelper).length ? `FP${round.fp.filter(isHelper).length}` : ''}</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legend">
        <span className="lg lg-gk">GK</span>
        <span className="lg lg-fp">フィールド</span>
        <span className="lg lg-rest">休み</span>
        <span className="lg lg-out">不在</span>
        <span className="legend-tip">名前をタップで1人だけ強調</span>
      </p>

      {issues.length > 0 && (
        <ul className="warnings">
          {issues.map((i, k) => (
            <li key={k}>
              第{i.round}→{i.round + 1}試合：{name(i.id)}が{i.type === 'rest-gk' ? '休みの次にGK' : 'GKの次に休み'}（手動の入れ替えによるもの）
            </li>
          ))}
        </ul>
      )}

      <section className="group">
        <div className="group-row">
          <span>試合数</span>
          <Stepper label="試合数" value={session.total} min={session.cur + 1} max={LIMITS.total[1]} onChange={(v) => dispatch({ type: 'session/total', total: v })} />
        </div>
      </section>

      <h2 className="section-title">今日の出場バランス</h2>
      <ul className="balance">
        {players.map((p) => {
          const s = stats[p.id];
          return (
            <li key={p.id}>
              <span className="balance-name">{p.name}</span>
              <span className="balance-bar" aria-hidden="true">
                {s.fp > 0 && <i className="b-fp" style={{ flexGrow: s.fp }} />}
                {s.gk > 0 && <i className="b-gk" style={{ flexGrow: s.gk }} />}
                {s.rest > 0 && <i className="b-rest" style={{ flexGrow: s.rest }} />}
                {most - (s.fp + s.gk + s.rest) > 0 && <i className="b-out" style={{ flexGrow: most - (s.fp + s.gk + s.rest) }} />}
              </span>
              <span className="balance-nums">
                出場<b className="num">{s.fp + s.gk}</b>
                <small>
                  GK{s.gk}・休{s.rest}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
