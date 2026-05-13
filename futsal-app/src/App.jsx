import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ═══════════════════════════════════════════
//  Storage
// ═══════════════════════════════════════════
const db = {
  async load(key, fb) {
    try {
      if (window.storage) { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : fb; }
      const v = localStorage.getItem("futsal_" + key); return v ? JSON.parse(v) : fb;
    } catch { return fb; }
  },
  async save(key, v) {
    try { const j = JSON.stringify(v); if (window.storage) await window.storage.set(key, j); else localStorage.setItem("futsal_" + key, j); } catch {}
  },
};

// ═══════════════════════════════════════════
//  Algorithm
// ═══════════════════════════════════════════
function getRestCount(n) { return Math.max(0, Math.min(2, n - 5)); }

function calcJoinRound(delayMin, otherTeams, matchMin) {
  if (delayMin <= 0) return 0;
  return Math.ceil(delayMin / (Math.max(1, otherTeams) * matchMin));
}

function generateSchedule(memberCount, totalRounds, joinRoundMap, helperCount) {
  const schedule = [];
  const stats = Array.from({ length: memberCount }, () => ({ gk: 0, rest: 0, field: 0 }));

  for (let r = 0; r < totalRounds; r++) {
    const available = [];
    for (let m = 0; m < memberCount; m++) {
      if ((joinRoundMap[m] || 0) <= r) available.push(m);
    }

    const n = available.length;
    const helpersNeeded = Math.max(0, 5 - n);
    const helpersUsed = Math.min(helpersNeeded, helperCount);
    const totalOnCourt = n + helpersUsed;

    if (totalOnCourt < 5) {
      schedule.push({ gk: -1, rest: [], waiting: true, available: n, helpersUsed: 0, helperGK: false, helperFP: 0 });
      continue;
    }

    const prev = r > 0 ? schedule[r - 1] : null;
    const prevOK = prev && !prev.waiting;

    if (helpersUsed > 0) {
      // Helper(s) on court: first helper = GK, rest = FP
      const helperGK = true;
      const helperFP = helpersUsed - 1;
      const teamOnCourt = 5 - helpersUsed; // team slots on court (all FP)
      const teamRest = Math.max(0, n - teamOnCourt);

      // Pick team rest: those with least rest, not violating constraints
      const restPool = [...available];
      // If prev round had a team member as GK (when no helpers), they can't rest now
      // But if prev had helperGK, no team member was GK, so no constraint from that
      if (prevOK && !prev.helperGK && prev.gk >= 0) {
        // prev GK was a team member, they shouldn't rest this round
        const idx = restPool.indexOf(prev.gk);
        if (idx >= 0 && restPool.length > teamRest) {
          restPool.splice(idx, 1);
          restPool.push(prev.gk); // move to end (least priority for rest)
        }
      }
      restPool.sort((a, b) => stats[a].rest - stats[b].rest);
      const rest = restPool.slice(0, teamRest);
      const field = available.filter((m) => !rest.includes(m));

      schedule.push({ gk: -1, rest, waiting: false, helperGK, helperFP, helpersUsed });
      rest.forEach((m) => stats[m].rest++);
      field.forEach((m) => stats[m].field++);
    } else {
      // No helpers, normal rotation
      const rc = getRestCount(n);

      const gkPool = available.filter((m) => {
        if (prevOK && prev.rest.includes(m)) return false;
        return true;
      });
      gkPool.sort((a, b) => {
        if (stats[a].gk !== stats[b].gk) return stats[a].gk - stats[b].gk;
        return stats[b].field - stats[a].field;
      });
      const gk = gkPool.length > 0 ? gkPool[0] : available[0];

      const restPool = available.filter((m) => {
        if (m === gk) return false;
        if (prevOK && prev.gk === m && !prev.helperGK) return false;
        return true;
      });
      restPool.sort((a, b) => {
        if (stats[a].rest !== stats[b].rest) return stats[a].rest - stats[b].rest;
        return (stats[b].field + stats[b].gk) - (stats[a].field + stats[a].gk);
      });
      const rest = restPool.slice(0, rc);

      schedule.push({ gk, rest, waiting: false, helperGK: false, helperFP: 0, helpersUsed: 0 });
      stats[gk].gk++;
      rest.forEach((m) => stats[m].rest++);
      available.filter((m) => m !== gk && !rest.includes(m)).forEach((m) => stats[m].field++);
    }
  }
  return schedule;
}

function getRole(schedule, r, m) {
  const round = schedule[r];
  if (!round || round.waiting) return "waiting";
  if (round.gk === m) return "gk";
  if (round.rest.includes(m)) return "rest";
  return "field";
}

function validateSchedule(schedule, memberCount) {
  const issues = [];
  for (let m = 0; m < memberCount; m++) {
    for (let r = 0; r < schedule.length - 1; r++) {
      const c = getRole(schedule, r, m), nx = getRole(schedule, r + 1, m);
      if (c === "rest" && nx === "gk") issues.push(`第${r+1}→${r+2} 休→GK`);
      if (c === "gk" && nx === "rest") issues.push(`第${r+1}→${r+2} GK→休`);
    }
  }
  return issues;
}

// ═══════════════════════════════════════════
//  Styling
// ═══════════════════════════════════════════
const ROLES = {
  gk: { bg: "linear-gradient(135deg,#f59e0b,#d97706)", color: "#451a03", label: "GK", icon: "🧤" },
  rest: { bg: "linear-gradient(135deg,#475569,#334155)", color: "#cbd5e1", label: "休み", icon: "💤" },
  field: { bg: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "#e0f2fe", label: "FP", icon: "🏃" },
  waiting: { bg: "linear-gradient(135deg,#1e293b,#0f172a)", color: "#475569", label: "未着", icon: "⏳" },
  helper: { bg: "linear-gradient(135deg,#059669,#047857)", color: "#ecfdf5", label: "助っ人", icon: "🤝" },
};

const DEFAULT_MEMBERS = [
  { id: "m1", name: "喜種" }, { id: "m2", name: "上野" }, { id: "m3", name: "川邉" },
  { id: "m4", name: "畑中" }, { id: "m5", name: "山本" }, { id: "m6", name: "伊達" }, { id: "m7", name: "武田" },
];

// ═══════════════════════════════════════════
//  Court Background
// ═══════════════════════════════════════════
function CourtBG() {
  return (
    <svg style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0, opacity: 0.06, pointerEvents: "none" }}
      viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice">
      <rect x="20" y="20" width="360" height="660" rx="6" fill="none" stroke="#38bdf8" strokeWidth="2.5" />
      <line x1="20" y1="350" x2="380" y2="350" stroke="#38bdf8" strokeWidth="2" />
      <circle cx="200" cy="350" r="55" fill="none" stroke="#38bdf8" strokeWidth="2" />
      <circle cx="200" cy="350" r="3" fill="#38bdf8" />
      <rect x="110" y="20" width="180" height="80" rx="4" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <rect x="145" y="20" width="110" height="40" rx="3" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <rect x="110" y="600" width="180" height="80" rx="4" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <rect x="145" y="640" width="110" height="40" rx="3" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
    </svg>
  );
}

// ═══════════════════════════════════════════
//  Members Tab
// ═══════════════════════════════════════════
function MembersTab({ allMembers, setAllMembers, selected, setSelected, delayMap, setDelayMap, excuseMap, setExcuseMap,
  otherTeams, setOtherTeams, matchMin, setMatchMin, helperCount, setHelperCount,
  lateCounts, onGenerate, saveMembersToStorage, totalRounds, setTotalRounds }) {
  const [newName, setNewName] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const inputRef = useRef(null);

  const toggleSelect = (id) => setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const setDelay = (id, min) => { setDelayMap((p) => ({ ...p, [id]: min })); if (min === 0) { setExpandedId(null); setExcuseMap((p) => { const n = { ...p }; delete n[id]; return n; }); } };
  const toggleExcuse = (id) => setExcuseMap((p) => ({ ...p, [id]: !p[id] }));

  const addMember = () => {
    const name = newName.trim();
    if (!name) return;
    const updated = [...allMembers, { id: "m" + Date.now(), name }];
    setAllMembers(updated);
    saveMembersToStorage(updated);
    setNewName("");
    inputRef.current?.focus();
  };

  const removeMember = (id) => {
    const updated = allMembers.filter((m) => m.id !== id);
    setAllMembers(updated);
    saveMembersToStorage(updated);
    setSelected((p) => p.filter((x) => x !== id));
    setDelayMap((p) => { const n = { ...p }; delete n[id]; return n; });
  };

  const sel = allMembers.filter((m) => selected.includes(m.id));
  const lateMembers = sel.filter((m) => (delayMap[m.id] || 0) > 0);
  const onTimeCount = sel.length - lateMembers.length;

  // Calculate min on-time across all rounds to determine if helpers are needed
  const minAvailableAtStart = onTimeCount;
  const helpersNeeded = Math.max(0, 5 - minAvailableAtStart);
  const canGenerate = sel.length >= 1 && (minAvailableAtStart + helperCount >= 5 || sel.length >= 5);

  const Btn = ({ v, cur, set, w }) => (
    <button onClick={() => set(v)} style={{ width: w || 36, height: 36, borderRadius: 10, fontSize: 15, fontWeight: 800,
      background: cur === v ? "#2563eb" : "#06102b", color: cur === v ? "#fff" : "#475569",
      border: cur === v ? "2px solid #38bdf8" : "2px solid #1e3a5f" }}>{v}</button>
  );

  const Stepper = ({ val, set, min, max }) => (
    <div style={{ display: "flex", alignItems: "center" }}>
      <button onClick={() => set(Math.max(min, val - 1))}
        style={{ width: 32, height: 36, borderRadius: "10px 0 0 10px", background: "#06102b", border: "2px solid #1e3a5f", borderRight: "none", color: "#38bdf8", fontSize: 16, fontWeight: 700 }}>−</button>
      <div style={{ width: 40, height: 36, background: "#06102b", border: "2px solid #1e3a5f", borderLeft: "none", borderRight: "none",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: "#38bdf8" }}>{val}</div>
      <button onClick={() => set(Math.min(max, val + 1))}
        style={{ width: 32, height: 36, borderRadius: "0 10px 10px 0", background: "#06102b", border: "2px solid #1e3a5f", borderLeft: "none", color: "#38bdf8", fontSize: 16, fontWeight: 700 }}>+</button>
    </div>
  );

  return (
    <div>
      {/* Settings */}
      <div style={{ background: "#0d1f4b", borderRadius: 14, padding: "16px", border: "1px solid #1e3a5f", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 12 }}>⚙️ 試合設定</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, marginBottom: 6 }}>相手チーム数</div>
            <div style={{ display: "flex", gap: 4 }}>{[1,2,3,4,5].map((n) => <Btn key={n} v={n} cur={otherTeams} set={setOtherTeams} />)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, marginBottom: 6 }}>1試合（分）</div>
            <Stepper val={matchMin} set={setMatchMin} min={3} max={15} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, marginBottom: 6 }}>試合数</div>
            <Stepper val={totalRounds} set={setTotalRounds} min={1} max={30} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 10 }}>
          自チーム試合間隔: 約<span style={{ color: "#38bdf8", fontWeight: 800 }}>{otherTeams * matchMin}分</span>
        </div>
      </div>

      {/* Today's Lineup */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>👥</span> 今日のメンバー
          <span style={{ background: "#1e3a5f", color: "#38bdf8", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 800 }}>{sel.length}人</span>
          {lateMembers.length > 0 && <span style={{ background: "#78350f", color: "#f59e0b", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>遅刻{lateMembers.length}人</span>}
        </div>

        {sel.length === 0 ? (
          <div style={{ background: "#0d1f4b", borderRadius: 14, padding: "28px 16px", textAlign: "center", border: "2px dashed #1e3a5f" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>👆</div>
            <div style={{ color: "#475569", fontSize: 14, fontWeight: 600 }}>下のメンバーをタップして追加</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sel.map((m) => {
              const delay = delayMap[m.id] || 0;
              const isLate = delay > 0;
              const excuse = excuseMap[m.id] || false;
              const joinR = calcJoinRound(delay, otherTeams, matchMin);
              const lc = lateCounts[m.id] || 0;
              const isExp = expandedId === m.id;

              return (
                <div key={m.id} style={{ background: isLate ? "linear-gradient(135deg,#451a03,#78350f)" : "#0d1f4b",
                  borderRadius: 14, border: isLate ? "1px solid #92400e" : "1px solid #1e3a5f", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 900, color: "#fff", flex: 1 }}>{m.name}</span>
                    {lc > 0 && <span style={{ background: "#dc2626", color: "#fff", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 800 }}>遅刻{lc}回</span>}
                    {isLate && <span style={{ background: "#f59e0b", color: "#451a03", padding: "3px 8px", borderRadius: 8, fontSize: 10, fontWeight: 800 }}>{delay}分遅れ→第{joinR + 1}試合〜</span>}
                    <button onClick={() => setExpandedId(isExp ? null : m.id)}
                      style={{ padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                        background: isLate ? "#f59e0b" : "#1e3a5f", color: isLate ? "#451a03" : "#64748b" }}>
                      {isLate ? "遅刻⚠" : "遅刻?"}</button>
                    <button onClick={() => { toggleSelect(m.id); setDelay(m.id, 0); }}
                      style={{ color: "#64748b", fontSize: 18, padding: "0 2px", lineHeight: 1 }}>✕</button>
                  </div>

                  {isExp && (
                    <div style={{ padding: "0 14px 14px", animation: "fadeIn 0.15s ease" }}>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, fontWeight: 600 }}>何分遅れる？</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {[0, 15, 30, 45, 60, 90].map((min) => (
                          <button key={min} onClick={() => setDelay(m.id, min)}
                            style={{ padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                              background: delay === min ? "#2563eb" : "#06102b", color: delay === min ? "#fff" : "#94a3b8",
                              border: delay === min ? "2px solid #38bdf8" : "2px solid #1e3a5f" }}>
                            {min === 0 ? "遅刻なし" : `${min}分`}
                          </button>
                        ))}
                      </div>
                      {isLate && (
                        <>
                          <div style={{ marginTop: 10, fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>
                            → 第{joinR + 1}試合（約{joinR * otherTeams * matchMin}分後）から参加
                          </div>
                          <button onClick={() => toggleExcuse(m.id)}
                            style={{ marginTop: 10, padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                              background: excuse ? "#059669" : "#1e293b",
                              color: excuse ? "#ecfdf5" : "#64748b",
                              border: excuse ? "2px solid #34d399" : "2px solid #334155" }}>
                            {excuse ? "✅ 仕方ない理由（カウントしない）" : "仕方ない理由？"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Helper Setting */}
        {helpersNeeded > 0 && (
          <div style={{ marginTop: 12, padding: "14px 16px", background: "#042f2e", borderRadius: 14, border: "1px solid #059669" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#34d399", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              🤝 助っ人が必要です
              <span style={{ fontSize: 11, color: "#059669", fontWeight: 600 }}>（開始時{onTimeCount}人 → あと{helpersNeeded}人）</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "#6ee7b7", fontWeight: 600 }}>助っ人人数</span>
              <div style={{ display: "flex", gap: 4 }}>
                {[0, 1, 2, 3].map((n) => (
                  <button key={n} onClick={() => setHelperCount(n)}
                    style={{ width: 36, height: 36, borderRadius: 10, fontSize: 15, fontWeight: 800,
                      background: helperCount === n ? "#059669" : "#06102b",
                      color: helperCount === n ? "#fff" : "#475569",
                      border: helperCount === n ? "2px solid #34d399" : "2px solid #1e3a5f" }}>{n}</button>
                ))}
              </div>
            </div>
            {helperCount >= 1 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#6ee7b7", lineHeight: 1.6 }}>
                {helperCount === 1
                  ? "→ 助っ人1人 = GKを担当（チームメンバーは全員FP）"
                  : `→ 助っ人${helperCount}人 = 1人GK + ${helperCount - 1}人FP`}
              </div>
            )}
          </div>
        )}

        {/* Helper Setting (even when enough players - optional) */}
        {helpersNeeded === 0 && sel.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#475569", textAlign: "center" }}>
            ※ 助っ人なしで試合可能です
          </div>
        )}

        {/* Generate */}
        <button onClick={onGenerate} disabled={!canGenerate}
          style={{ width: "100%", marginTop: 16, padding: "16px", borderRadius: 14,
            background: canGenerate ? "linear-gradient(135deg,#2563eb,#0ea5e9)" : "#1e293b",
            color: canGenerate ? "#fff" : "#475569", fontSize: 17, fontWeight: 800, border: "none", letterSpacing: "1px",
            boxShadow: canGenerate ? "0 4px 20px rgba(37,99,235,0.4)" : "none" }}>
          {canGenerate
            ? `⚽ ローテーション作成${helperCount > 0 ? `（助っ人${helperCount}人込み）` : ""}`
            : helpersNeeded > 0 ? `助っ人を${helpersNeeded}人以上追加してください` : `あと${Math.max(0, 5 - sel.length)}人選んでください`}
        </button>
      </div>

      {/* All Members */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 10 }}>📋 登録メンバー</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {allMembers.map((m) => {
            const isSel = selected.includes(m.id);
            const lc = lateCounts[m.id] || 0;
            return (
              <div key={m.id} style={{ position: "relative" }}>
                <button onClick={() => toggleSelect(m.id)}
                  style={{ padding: "10px 18px", borderRadius: 12, fontSize: 16, fontWeight: 700,
                    background: "#0d1f4b", color: isSel ? "#334155" : "#e2e8f0",
                    border: isSel ? "2px solid #334155" : "2px solid #1e3a5f",
                    opacity: isSel ? 0.4 : 1, textDecoration: isSel ? "line-through" : "none" }}>
                  {m.name}
                </button>
                {lc > 0 && !isSel && (
                  <span style={{ position: "absolute", top: -6, left: -6, background: "#dc2626", color: "#fff",
                    width: 20, height: 20, borderRadius: 10, fontSize: 10, fontWeight: 800,
                    display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #06102b" }}>{lc}</span>
                )}
                {!isSel && !DEFAULT_MEMBERS.find((d) => d.id === m.id) && (
                  <button onClick={() => removeMember(m.id)}
                    style={{ position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: 10,
                      background: "#ef4444", color: "#fff", fontSize: 11, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #06102b" }}>✕</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Member */}
      <div style={{ background: "#0d1f4b", borderRadius: 14, padding: "16px", border: "1px solid #1e3a5f" }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 10 }}>➕ 新規メンバー追加</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input ref={inputRef} type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMember()} placeholder="名前を入力..."
            style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "2px solid #1e3a5f",
              background: "#06102b", color: "#e2e8f0", fontSize: 16, fontWeight: 600, outline: "none", fontFamily: "inherit" }} />
          <button onClick={addMember}
            style={{ padding: "12px 20px", borderRadius: 10, fontSize: 15, fontWeight: 800,
              background: newName.trim() ? "linear-gradient(135deg,#2563eb,#0ea5e9)" : "#1e293b",
              color: newName.trim() ? "#fff" : "#475569" }}>追加</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Round Nav
// ═══════════════════════════════════════════
function RoundNav({ cur, total, set }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 28 }}>
      <button onClick={() => set(Math.max(0, cur - 1))} disabled={cur === 0}
        style={{ width: 48, height: 48, borderRadius: 14, background: "#0d1f4b", border: "1px solid #1e3a5f",
          color: cur === 0 ? "#1e3a5f" : "#38bdf8", fontSize: 24, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 38, fontWeight: 900, color: "#38bdf8", fontVariantNumeric: "tabular-nums" }}>第{cur + 1}試合</div>
        <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{cur + 1} / {total}</div>
      </div>
      <button onClick={() => set(Math.min(total - 1, cur + 1))} disabled={cur >= total - 1}
        style={{ width: 48, height: 48, borderRadius: 14, background: "#0d1f4b", border: "1px solid #1e3a5f",
          color: cur >= total - 1 ? "#1e3a5f" : "#38bdf8", fontSize: 24, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Now Tab
// ═══════════════════════════════════════════
function NowTab({ schedule, members, cur, total, setCur }) {
  if (!schedule.length) return <EmptyState />;
  const round = schedule[cur];

  if (round.waiting) {
    return (<div><RoundNav cur={cur} total={total} set={setCur} />
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b" }}>メンバー待ち</div>
        <div style={{ fontSize: 14, color: "#475569", marginTop: 8 }}>現在{round.available}人 — 5人揃い次第スタート</div>
      </div></div>);
  }

  const fieldMembers = members.filter((m) => m.idx !== round.gk && !round.rest.includes(m.idx) && (m.joinRound || 0) <= cur);
  const restMembers = round.rest.map((i) => members.find((m) => m.idx === i)).filter(Boolean);
  const gkMember = round.helperGK ? null : members.find((m) => m.idx === round.gk);

  const Card = ({ name, role, sub }) => {
    const s = ROLES[role] || ROLES.field;
    return (
      <div style={{ background: s.bg, borderRadius: 16, padding: "18px 14px", textAlign: "center", boxShadow: `0 4px 16px rgba(0,0,0,0.2)` }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{name}</div>
        <div style={{ fontSize: 13, color: s.color, opacity: 0.6, marginTop: 3, fontWeight: 600 }}>{sub}</div>
      </div>
    );
  };

  return (
    <div>
      <RoundNav cur={cur} total={total} set={setCur} />

      {/* Helpers indicator */}
      {round.helpersUsed > 0 && (
        <div style={{ background: "#042f2e", borderRadius: 12, padding: "10px 14px", marginBottom: 14, border: "1px solid #059669",
          fontSize: 13, color: "#34d399", fontWeight: 700, textAlign: "center" }}>
          🤝 助っ人{round.helpersUsed}人参加中{round.helperGK ? "（GK担当）" : ""}
        </div>
      )}

      {/* Field */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>🏃 フィールドプレーヤー</div>
        <div style={{ display: "grid", gridTemplateColumns: (fieldMembers.length + (round.helperFP || 0)) <= 4 ? "1fr 1fr" : "1fr 1fr 1fr", gap: 10 }}>
          {fieldMembers.map((m) => <Card key={m.id} name={m.name} role="field" sub="FP" />)}
          {Array.from({ length: round.helperFP || 0 }, (_, i) => (
            <Card key={`hfp${i}`} name={`助っ人${i + 2}`} role="helper" sub="FP（助っ人）" />
          ))}
        </div>
      </div>

      {/* GK */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>🧤 ゴールキーパー</div>
        {round.helperGK
          ? <Card name="助っ人" role="helper" sub="GK（助っ人）" />
          : <Card name={gkMember?.name || "?"} role="gk" sub="GK" />}
      </div>

      {/* Rest */}
      {restMembers.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>💤 休み</div>
          <div style={{ display: "grid", gridTemplateColumns: restMembers.length === 1 ? "1fr" : "1fr 1fr", gap: 10 }}>
            {restMembers.map((m) => <Card key={m.id} name={m.name} role="rest" sub="休み" />)}
          </div>
        </div>
      )}

      {/* Next preview */}
      {cur < total - 1 && !schedule[cur + 1]?.waiting && (
        <div style={{ padding: "14px 16px", background: "#0d1f4b", borderRadius: 14, border: "1px solid #1e3a5f" }}>
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>次の試合（第{cur + 2}試合）</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {schedule[cur + 1]?.helperGK && <span style={{ padding: "5px 12px", borderRadius: 10, fontSize: 13, fontWeight: 700, ...ROLES.helper, background: ROLES.helper.bg, color: ROLES.helper.color }}>助っ人 🧤</span>}
            {members.filter((m) => (m.joinRound || 0) <= cur + 1).map((m) => {
              const role = getRole(schedule, cur + 1, m.idx);
              const s = ROLES[role] || ROLES.field;
              return <span key={m.id} style={{ padding: "5px 12px", borderRadius: 10, fontSize: 13, fontWeight: 700, background: s.bg, color: s.color }}>{m.name} {s.icon}</span>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  Table Tab
// ═══════════════════════════════════════════
function TableTab({ schedule, members, totalRounds }) {
  const [sel, setSel] = useState(null);
  if (!schedule.length) return <EmptyState />;

  const hasHelpers = schedule.some((r) => r.helpersUsed > 0);

  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", borderRadius: 14, background: "#0d1f4b", border: "1px solid #1e3a5f" }}>
      <table style={{ width: "100%", fontSize: 13 }}>
        <thead><tr>
          <th style={{ padding: "14px 8px", textAlign: "left", borderBottom: "2px solid #1e3a5f", color: "#475569", fontSize: 11, fontWeight: 700, position: "sticky", left: 0, background: "#0d1f4b", zIndex: 2, minWidth: 52 }}>#</th>
          {hasHelpers && <th style={{ padding: "14px 6px", textAlign: "center", borderBottom: "2px solid #1e3a5f", color: "#34d399", fontSize: 12, fontWeight: 800, minWidth: 50 }}>助っ人</th>}
          {members.map((m, i) => (
            <th key={m.id} onClick={() => setSel(sel === i ? null : i)}
              style={{ padding: "14px 6px", textAlign: "center", borderBottom: "2px solid #1e3a5f",
                color: sel === i ? "#38bdf8" : "#e2e8f0", fontSize: 14, fontWeight: 800, cursor: "pointer", minWidth: 58 }}>
              {m.name}
              {(m.joinRound || 0) > 0 && <span style={{ display: "block", fontSize: 8, color: "#f59e0b", marginTop: 1 }}>第{m.joinRound + 1}〜</span>}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {Array.from({ length: totalRounds }, (_, r) => {
            const rd = schedule[r];
            return (
              <tr key={r}>
                <td style={{ padding: "10px 8px", fontWeight: 800, fontSize: 12, color: "#38bdf8", borderBottom: "1px solid #132d5e", position: "sticky", left: 0, background: "#0d1f4b", zIndex: 1 }}>{r + 1}</td>
                {hasHelpers && (
                  <td style={{ padding: "8px 4px", textAlign: "center", borderBottom: "1px solid #132d5e" }}>
                    {rd && rd.helpersUsed > 0 ? (
                      <span style={{ display: "inline-block", padding: "5px 8px", borderRadius: 16, fontSize: 11, fontWeight: 700,
                        background: ROLES.helper.bg, color: ROLES.helper.color }}>
                        {rd.helperGK ? "GK" : "FP"}{rd.helperFP > 0 ? `+${rd.helperFP}` : ""}
                      </span>
                    ) : <span style={{ color: "#1e3a5f" }}>−</span>}
                  </td>
                )}
                {members.map((m, mi) => {
                  const avail = (m.joinRound || 0) <= r;
                  const role = avail ? getRole(schedule, r, m.idx) : "waiting";
                  const s = ROLES[role] || ROLES.waiting;
                  const dim = sel !== null && sel !== mi;
                  return (
                    <td key={m.id} onClick={() => setSel(sel === mi ? null : mi)}
                      style={{ padding: "8px 4px", textAlign: "center", borderBottom: "1px solid #132d5e" }}>
                      <span style={{ display: "inline-block", padding: "5px 12px", borderRadius: 16, fontSize: 12, fontWeight: 700,
                        background: s.bg, color: s.color, opacity: dim ? 0.15 : 1, transition: "opacity 0.15s" }}>
                        {s.label}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Stats Tab
// ═══════════════════════════════════════════
function StatsTab({ schedule, members, totalRounds, lateCounts, allMembers, onUpdateLateCount }) {
  // Late ranking (all members, not just active)
  const lateRanking = allMembers
    .map((m) => ({ ...m, count: lateCounts[m.id] || 0 }))
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxLate = lateRanking.length > 0 ? lateRanking[0].count : 0;

  const medals = ["🥇", "🥈", "🥉"];
  const btnS = { width: 28, height: 28, borderRadius: 8, fontSize: 16, fontWeight: 800,
    display: "flex", alignItems: "center", justifyContent: "center", border: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Late Ranking */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#f87171", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>⏰</span> 遅刻ランキング（通算）
        </div>
        {lateRanking.length === 0 ? (
          <div style={{ background: "#0d1f4b", borderRadius: 14, padding: "20px 16px", textAlign: "center", border: "1px solid #1e3a5f" }}>
            <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>まだ遅刻者はいません 🎉</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lateRanking.map((m, i) => (
              <div key={m.id} style={{
                background: i === 0 ? "linear-gradient(135deg,#7f1d1d,#991b1b)" : "#0d1f4b",
                border: i === 0 ? "1px solid #dc2626" : "1px solid #1e3a5f",
                borderRadius: 14, padding: "14px 16px",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ fontSize: 24, width: 28, textAlign: "center", flexShrink: 0 }}>
                  {i < 3 ? medals[i] : <span style={{ fontSize: 16, color: "#475569", fontWeight: 800 }}>{i + 1}</span>}
                </span>
                <span style={{ flex: 1, fontSize: 18, fontWeight: 800, color: "#f1f5f9" }}>{m.name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => onUpdateLateCount(m.id, Math.max(0, m.count - 1))}
                    style={{ ...btnS, background: "#1e293b", color: "#94a3b8" }}>−</button>
                  <div style={{ width: Math.max(20, (m.count / maxLate) * 60), height: 28, borderRadius: 8,
                    background: "linear-gradient(90deg,#dc2626,#ef4444)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 900, color: "#fff", minWidth: 36 }}>
                    {m.count}
                  </div>
                  <button onClick={() => onUpdateLateCount(m.id, m.count + 1)}
                    style={{ ...btnS, background: "#1e293b", color: "#94a3b8" }}>+</button>
                  <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>回</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Match Stats */}
      {schedule.length > 0 && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#38bdf8", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>📊</span> 今日の出場集計
          </div>
          {(() => {
            const stats = members.map((m) => {
              let gk = 0, rest = 0, field = 0;
              for (let r = 0; r < totalRounds; r++) {
                if ((m.joinRound || 0) > r) continue;
                const role = getRole(schedule, r, m.idx);
                if (role === "gk") gk++; else if (role === "rest") rest++; else if (role === "field") field++;
              }
              return { ...m, gk, rest, field };
            });
            return stats.map((s) => (
              <div key={s.id} style={{ background: "#0d1f4b", border: "1px solid #1e3a5f", borderRadius: 16, padding: "18px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontWeight: 900, fontSize: 18, color: "#f1f5f9" }}>
                    {s.name}
                    {(s.joinRound || 0) > 0 && <span style={{ fontSize: 11, color: "#f59e0b", marginLeft: 8 }}>第{s.joinRound + 1}〜</span>}
                  </div>
                  <div style={{ fontSize: 13, color: "#475569", fontWeight: 600 }}>出場 {s.field + s.gk} / {totalRounds}</div>
                </div>
                <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", height: 32 }}>
                  {[{ val: s.field, ...ROLES.field }, { val: s.gk, ...ROLES.gk }, { val: s.rest, ...ROLES.rest }].map((item, j) =>
                    item.val > 0 && <div key={j} style={{ flex: item.val, background: item.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: item.color, minWidth: 36 }}>{item.label} {item.val}</div>
                  )}
                </div>
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (<div style={{ textAlign: "center", padding: "60px 20px" }}>
    <div style={{ fontSize: 48, marginBottom: 16 }}>⚽</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: "#475569" }}>メンバータブでローテーションを作成してください</div>
  </div>);
}

// ═══════════════════════════════════════════
//  Rules Tab
// ═══════════════════════════════════════════
function RulesTab() {
  const S = [
    { icon: "📐", title: "コート", items: ["サイズ: 約 40m × 20m（体育館サイズ）", "サッカーの約1/9の大きさ", "ゴール: 3m × 2m（サッカーの約半分）"] },
    { icon: "👥", title: "人数", items: ["1チーム5人（GK1 + FP4）", "交代は自由、何度でもOK（フライングサブ）", "試合中いつでもベンチエリアから交代可能"] },
    { icon: "⏱", title: "試合時間", items: ["前後半 各20分（プレイングタイム）", "ハーフタイム 15分", "タイムアウト: 各チーム前後半1回ずつ（1分間）"] },
    { icon: "⚽", title: "ボール", items: ["4号球（サッカーは5号球）", "ローバウンド仕様（弾みにくい）", "小さめで足元の技術が活きる"] },
    { icon: "🚫", title: "サッカーとの違い", items: ["スライディングタックル禁止", "オフサイドなし", "ゴールキックではなくGKのスロー", "キックインはボールを置いて4秒以内", "バックパス制限（GKへ2回連続のパス禁止）"] },
    { icon: "🟨", title: "ファウル", items: ["チームファウル6つ目以降は第2PKが相手に与えられる", "第2PK: 10mの距離から直接フリーキック（壁なし）", "退場は2分間の退場（サッカーと違い補充可能）"] },
    { icon: "💡", title: "初心者Tips", items: ["パスをつないでポゼッション重視がおすすめ", "コートが狭いので常にパスコースを作る意識", "GKも5人目のFPとして攻撃参加が重要", "スペースは一瞬で消えるので判断スピードが鍵"] },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 42, marginBottom: 8 }}>⚽</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: "#38bdf8" }}>フットサルのルール</div>
        <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>知っておきたい基本ルールまとめ</div>
      </div>
      {S.map((sec, i) => (
        <div key={i} style={{ background: "#0d1f4b", border: "1px solid #1e3a5f", borderRadius: 16, padding: "18px" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#e2e8f0", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>{sec.icon}</span>{sec.title}
          </div>
          {sec.items.map((item, j) => (
            <div key={j} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 6 }}>
              <span style={{ color: "#2563eb", fontSize: 8, marginTop: 7, flexShrink: 0 }}>●</span>
              <span style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.6, fontWeight: 500 }}>{item}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════
//  Main App
// ═══════════════════════════════════════════
const TABS = [
  { id: "members", label: "メンバー", icon: "👥" },
  { id: "now", label: "試合中", icon: "▶" },
  { id: "table", label: "全体表", icon: "📋" },
  { id: "stats", label: "集計", icon: "📊" },
  { id: "rules", label: "ルール", icon: "📖" },
];

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("members");
  const [allMembers, setAllMembers] = useState(DEFAULT_MEMBERS);
  const [selected, setSelected] = useState([]);
  const [delayMap, setDelayMap] = useState({});
  const [excuseMap, setExcuseMap] = useState({});
  const [otherTeams, setOtherTeams] = useState(2);
  const [matchMin, setMatchMin] = useState(7);
  const [totalRounds, setTotalRounds] = useState(10);
  const [helperCount, setHelperCount] = useState(0);
  const [currentRound, setCurrentRound] = useState(0);
  const [schedule, setSchedule] = useState([]);
  const [activeMembers, setActiveMembers] = useState([]);
  const [lateCounts, setLateCounts] = useState({});

  useEffect(() => {
    Promise.all([db.load("members", null), db.load("lateCounts", {})]).then(([saved, lc]) => {
      if (saved?.length > 0) setAllMembers(saved);
      setLateCounts(lc || {});
      setLoading(false);
    });
  }, []);

  const saveMembersToStorage = useCallback((m) => db.save("members", m), []);

  const handleGenerate = useCallback(() => {
    const selMembers = allMembers.filter((m) => selected.includes(m.id))
      .map((m, i) => ({ ...m, idx: i, joinRound: calcJoinRound(delayMap[m.id] || 0, otherTeams, matchMin) }));

    const joinRoundMap = {};
    selMembers.forEach((m) => { joinRoundMap[m.idx] = m.joinRound; });

    const sched = generateSchedule(selMembers.length, totalRounds, joinRoundMap, helperCount);
    setSchedule(sched);
    setActiveMembers(selMembers);
    setCurrentRound(0);

    // Increment late counters (only for non-excused)
    const newCounts = { ...lateCounts };
    selMembers.forEach((m) => {
      if ((delayMap[m.id] || 0) > 0 && !excuseMap[m.id]) {
        newCounts[m.id] = (newCounts[m.id] || 0) + 1;
      }
    });
    setLateCounts(newCounts);
    db.save("lateCounts", newCounts);

    setTab("now");
  }, [allMembers, selected, delayMap, excuseMap, otherTeams, matchMin, totalRounds, helperCount, lateCounts]);

  const onUpdateLateCount = useCallback((id, count) => {
    const newCounts = { ...lateCounts, [id]: count };
    if (count <= 0) delete newCounts[id];
    setLateCounts(newCounts);
    db.save("lateCounts", newCounts);
  }, [lateCounts]);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#06102b", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 48, animation: "pulse 1.5s infinite" }}>⚽</div>
    </div>
  );

  return (
    <div style={{ position: "relative", maxWidth: 520, margin: "0 auto", minHeight: "100vh", background: "#06102b", overflow: "hidden" }}>
      <CourtBG />
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        * { box-sizing: border-box; }
        input::placeholder { color: #334155; }
      `}</style>

      <div style={{ position: "relative", zIndex: 1, padding: "22px 16px 0", textAlign: "center" }}>
        <div style={{ fontSize: 26, fontWeight: 900 }}>
          <span style={{ background: "linear-gradient(90deg,#38bdf8,#2563eb)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            ⚽ フットサル ローテーション
          </span>
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1, padding: "20px 16px 120px" }}>
        {tab === "members" && <MembersTab {...{ allMembers, setAllMembers, selected, setSelected, delayMap, setDelayMap, excuseMap, setExcuseMap, otherTeams, setOtherTeams, matchMin, setMatchMin, helperCount, setHelperCount, lateCounts, onGenerate: handleGenerate, saveMembersToStorage, totalRounds, setTotalRounds }} />}
        {tab === "now" && <NowTab schedule={schedule} members={activeMembers} cur={currentRound} total={totalRounds} setCur={setCurrentRound} />}
        {tab === "table" && <TableTab schedule={schedule} members={activeMembers} totalRounds={totalRounds} />}
        {tab === "stats" && <StatsTab schedule={schedule} members={activeMembers} totalRounds={totalRounds} lateCounts={lateCounts} allMembers={allMembers} onUpdateLateCount={onUpdateLateCount} />}
        {tab === "rules" && <RulesTab />}
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(6,16,43,0.96)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderTop: "1px solid #1e3a5f",
        display: "flex", justifyContent: "center", padding: "6px 0 max(8px, env(safe-area-inset-bottom))", zIndex: 50 }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, maxWidth: 100, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              padding: "6px 0", color: tab === t.id ? "#38bdf8" : "#334155", fontSize: 10, fontWeight: 700 }}>
            <span style={{ fontSize: 20 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
