import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Ellipsis, ListOrdered, Table2, Users } from 'lucide-react';
import { loadState, reducer, saveState } from './lib/store.js';
import { BoardIcon } from './ui.jsx';
import Setup from './screens/Setup.jsx';
import Match from './screens/Match.jsx';
import Table from './screens/Table.jsx';
import Records from './screens/Records.jsx';
import More from './screens/More.jsx';

const TABS = [
  { id: 'setup', label: '準備', Icon: Users },
  { id: 'match', label: '試合', Icon: BoardIcon },
  { id: 'table', label: '全体表', Icon: Table2 },
  { id: 'records', label: '記録', Icon: ListOrdered },
  { id: 'more', label: 'その他', Icon: Ellipsis },
];
const SCREENS = { setup: Setup, match: Match, table: Table, records: Records, more: More };

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [tab, setTab] = useState(() => (state.session ? 'match' : 'setup'));
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => saveState(state), [state]);

  // 画面の色（端末に合わせる／明るい／暗い）
  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.theme);
    const dark = state.theme === 'dark' || (state.theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1410' : '#eef2ee');
  }, [state.theme]);

  const toast = useCallback((text, opts = {}) => {
    clearTimeout(toastTimer.current);
    setToastMsg({ text, undo: Boolean(opts.undo), key: Date.now() });
    toastTimer.current = setTimeout(() => setToastMsg(null), opts.undo ? 6000 : 3200);
  }, []);

  const go = useCallback((id) => {
    clearTimeout(toastTimer.current);
    setToastMsg(null);
    setTab(id);
    window.scrollTo(0, 0);
  }, []);

  const Screen = SCREENS[tab];

  return (
    <div className="app">
      <main className="screen" key={tab}>
        <Screen state={state} dispatch={dispatch} go={go} toast={toast} />
      </main>

      {toastMsg && (
        <div className="toast" role="status" key={toastMsg.key}>
          <span>{toastMsg.text}</span>
          {toastMsg.undo && state.undo && (
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'undo' });
                setToastMsg(null);
              }}
            >
              元に戻す
            </button>
          )}
        </div>
      )}

      <nav className="tabbar" aria-label="画面の切り替え">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" className={tab === id ? 'is-on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
            <Icon size={23} />
            <span>{label}</span>
            {id === 'match' && state.session && <i className="tab-dot" aria-hidden="true" />}
          </button>
        ))}
      </nav>
    </div>
  );
}
