// 表示用の整形と、端末の機能（共有・振動・音・画面スリープ防止）まわり。
import { isHelper } from './rotation.js';

const WEEK = '日月火水木金土';

export function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** id から表示名を引く関数を作る。助っ人は「助っ人」「助っ人2」。 */
export function namer(session) {
  const names = new Map(session.players.map((p) => [p.id, p.name]));
  return (id) => {
    if (isHelper(id)) {
      const n = Number(id.slice(2));
      return n > 1 ? `助っ人${n}` : '助っ人';
    }
    return names.get(id) || '？';
  };
}

export function shareText(session) {
  const name = namer(session);
  const lines = [`フットサル ローテーション ${fmtDate(session.date)}`];
  session.rounds.forEach((round, i) => {
    if (round.waiting) {
      lines.push(`${i + 1}) メンバー待ち`);
      return;
    }
    const parts = [`GK ${name(round.gk)}`, `FP ${round.fp.map(name).join('・')}`];
    if (round.rest.length) parts.push(`休 ${round.rest.map(name).join('・')}`);
    lines.push(`${i + 1}) ${parts.join('｜')}`);
  });
  return lines.join('\n');
}

const embedded = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

/** 端末の共有メニューを開く。使えなければクリップボードにコピーする。 */
export async function shareOrCopy(text) {
  if (!embedded && navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** 控えをファイルに保存する。ダウンロードできない環境（埋め込み表示）ではコピーに切り替える。 */
export async function saveBackup(filename, text) {
  if (embedded) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  downloadText(filename, text);
  return 'saved';
}

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buzz(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* 振動に対応していない端末 */
  }
}

// ── 終了の合図（音） ──
let audio = null;
/** タイマー開始のタップで呼ぶ。ブラウザは操作をきっかけにしないと音を出せないため。 */
export function primeSound() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    audio = null;
  }
}
export function whistle() {
  if (!audio) return;
  try {
    const t0 = audio.currentTime;
    [0, 0.32, 0.64].forEach((offset, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = 1760;
      const len = i === 2 ? 0.7 : 0.2;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + len);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + len + 0.05);
    });
  } catch {
    /* 音が出せなくても続行 */
  }
}

// ── 計測中は画面を消さない ──
let lock = null;
export async function keepAwake(on) {
  try {
    if (on) {
      if (!lock && navigator.wakeLock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => {
          lock = null;
        });
      }
    } else if (lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null;
  }
}
