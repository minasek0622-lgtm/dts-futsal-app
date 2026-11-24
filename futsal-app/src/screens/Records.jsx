// 記録：通算の遅刻ランキングと、これまでの開催。
import { useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { fmtDate } from '../lib/util.js';
import { Confirm } from '../ui.jsx';

export default function Records({ state, dispatch }) {
  const { members, lateCounts, history, session } = state;
  const [askRemove, setAskRemove] = useState(null);

  const attended = {};
  for (const h of history) for (const p of h.players) attended[p.id] = (attended[p.id] || 0) + 1;

  const ranked = members
    .map((m, order) => ({ ...m, order, late: lateCounts[m.id] || 0, came: attended[m.id] || 0 }))
    .sort((a, b) => b.late - a.late || a.order - b.order);
  let rank = 0;
  let prev = null;
  ranked.forEach((m, i) => {
    if (m.late !== prev) rank = i + 1;
    prev = m.late;
    m.rank = m.late ? rank : null;
  });
  const anyLate = ranked.some((m) => m.late);

  return (
    <div className="page page-records">
      <header className="page-head">
        <div>
          <h1>遅刻ランキング</h1>
          <p className="page-sub">通算。数え間違いは ＋ − で直せます</p>
        </div>
      </header>

      {!anyLate && <p className="quiet-note">まだ誰も遅刻していません。</p>}
      <ol className="ranking">
        {ranked.map((m) => (
          <li key={m.id} className={m.late ? (m.rank === 1 ? 'is-top' : '') : 'is-clean'}>
            <span className="rank num">{m.rank ?? '–'}</span>
            <span className="ranking-who">
              <strong>{m.name}</strong>
              {m.came > 0 && <small>参加{m.came}回</small>}
            </span>
            <span className="ranking-cards" aria-hidden="true">
              {Array.from({ length: Math.min(m.late, 5) }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            <div className="mini-stepper">
              <button type="button" onClick={() => dispatch({ type: 'late/adjust', id: m.id, delta: -1 })} disabled={!m.late} aria-label={`${m.name}の遅刻を1回減らす`}>
                <Minus size={16} />
              </button>
              <output className="num" aria-label={`${m.name}の遅刻回数`}>
                {m.late}
              </output>
              <button type="button" onClick={() => dispatch({ type: 'late/adjust', id: m.id, delta: 1 })} aria-label={`${m.name}の遅刻を1回増やす`}>
                <Plus size={16} />
              </button>
            </div>
          </li>
        ))}
      </ol>

      <h2 className="section-title">これまでの開催</h2>
      {session && <p className="quiet-note">{fmtDate(session.date)}の分は進行中です。「試合」の画面で終了すると、ここに残ります。</p>}
      {history.length === 0 && !session && <p className="quiet-note">終了した開催がここに並びます。</p>}
      <ul className="history">
        {history.map((h) => {
          const names = new Map(h.players.map((p) => [p.id, p.name]));
          const late = (h.late || []).map((id) => names.get(id)).filter(Boolean);
          const excused = (h.excused || []).map((id) => names.get(id)).filter(Boolean);
          return (
            <li key={h.id}>
              <div>
                <strong>{fmtDate(h.date)}</strong>
                <span>
                  {h.players.length}人・{h.total}試合
                </span>
                {late.length > 0 && <small className="is-warn">遅刻：{late.join('、')}</small>}
                {excused.length > 0 && <small>遅刻（数えない）：{excused.join('、')}</small>}
              </div>
              <button type="button" className="icon-btn" onClick={() => setAskRemove(h)} aria-label={`${fmtDate(h.date)}の記録を削除`}>
                <Trash2 size={18} />
              </button>
            </li>
          );
        })}
      </ul>

      <Confirm
        open={Boolean(askRemove)}
        title={askRemove ? `${fmtDate(askRemove.date)}の記録を削除` : ''}
        body="開催の記録だけを消します。通算の遅刻回数は変わりません。"
        yes="削除する"
        danger
        onYes={() => dispatch({ type: 'history/remove', id: askRemove.id })}
        onClose={() => setAskRemove(null)}
      />
    </div>
  );
}
