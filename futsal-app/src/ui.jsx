// 画面をまたいで使う小さな部品。
import { useEffect, useRef } from 'react';
import { Minus, Plus, X } from 'lucide-react';

export function Stepper({ value, min, max, onChange, unit, label }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`${label}を減らす`}>
        <Minus size={18} />
      </button>
      <output className="stepper-value">
        <span className="num">{value}</span>
        {unit && <span className="stepper-unit">{unit}</span>}
      </output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`${label}を増やす`}>
        <Plus size={18} />
      </button>
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          className={o.value === value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 画面下からせり上がるシート。 */
export function Sheet({ open, title, onClose, children, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる">
            <X size={22} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, body, yes, danger, onYes, onClose }) {
  return (
    <Sheet
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onYes();
              onClose();
            }}
          >
            {yes}
          </button>
        </>
      }
    >
      <p className="sheet-text">{body}</p>
    </Sheet>
  );
}

/** 作戦ボードのアイコン（タブ用）。 */
export function BoardIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18" />
      <path d="M8.5 20v-1a3.5 3.5 0 0 1 7 0v1" />
      <circle cx="8" cy="14" r="0.6" fill="currentColor" />
      <circle cx="16" cy="14" r="0.6" fill="currentColor" />
    </svg>
  );
}

/** 遅刻の回数をイエローカードで示す。 */
export function Cards({ count }) {
  if (!count) return null;
  return (
    <span className="cards" aria-label={`通算遅刻 ${count}回`}>
      <i aria-hidden="true" />
      <span className="num">{count}</span>
    </span>
  );
}
