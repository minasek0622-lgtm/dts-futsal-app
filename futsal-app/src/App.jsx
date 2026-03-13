import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ═══════════════════════════════════════════
//  Storage (artifact: window.storage, deploy: localStorage)
// ═══════════════════════════════════════════
const db = {
  async load(key, fallback) {
    try {
      if (window.storage) {
        const r = await window.storage.get(key);
        return r ? JSON.parse(r.value) : fallback;
      }
      const v = localStorage.getItem("futsal_" + key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  async save(key, value) {
    try {
      const json = JSON.stringify(value);
      if (window.storage) await window.storage.set(key, json);
      else localStorage.setItem("futsal_" + key, json);
    } catch {}
  },
};

// ═══════════════════════════════════════════
//  Rotation Algorithm
// ═══════════════════════════════════════════
function getRestCount(playerCount) {
  // 5人=休み0, 6人=休み1, 7人以上=休み2
  return Math.max(0, Math.min(2, playerCount - 5));
}

function generateSchedule(playerCount, totalRounds, lateIndices = []) {
  if (playerCount < 5) return [];

  const restCount = getRestCount(playerCount);

  // Reorder: put late players at rest positions for R0
  let order = Array.from({ length: playerCount }, (_, i) => i);
  if (lateIndices.length > 0 && restCount > 0) {
    const nonLate = order.filter((i) => !lateIndices.includes(i));
    const late = order.filter((i) => lateIndices.includes(i));
    const reordered = [];
    let lateIdx = 0, nonLateIdx = 0;
    for (let pos = 0; pos < playerCount; pos++) {
      if (pos >= 2 && pos < 2 + late.length && lateIdx < late.length) {
        reordered.push(late[lateIdx++]);
      } else {
        reordered.push(nonLate[nonLateIdx++]);
      }
    }
    order = reordered;
  }

  const schedule = [];
  for (let r = 0; r < totalRounds; r++) {
    const c = r % playerCount;
    const gk = order[c];
    const rest = [];
    for (let i = 0; i < restCount; i++) {
      rest.push(order[(c + 2 + i) % playerCount]);
    }
    schedule.push({ gk, rest });
  }
  return schedule;
}

function getRole(schedule, r, m) {
  const round = schedule[r];
  if (!round) return "field";
  if (round.gk === m) return "gk";
  if (round.rest.includes(m)) return "rest";
  return "field";
}

function validateSchedule(schedule, memberCount) {
  const issues = [];
  for (let m = 0; m < memberCount; m++) {
    for (let r = 0; r < schedule.length - 1; r++) {
      const curr = getRole(schedule, r, m);
      const next = getRole(schedule, r + 1, m);
      if (curr === "rest" && next === "gk") issues.push(`第${r + 1}→${r + 2} 休→GK`);
      if (curr === "gk" && next === "rest") issues.push(`第${r + 1}→${r + 2} GK→休`);
    }
  }
  return issues;
}

// ═══════════════════════════════════════════
//  Role Styling
// ═══════════════════════════════════════════
const ROLES = {
  gk: { bg: "linear-gradient(135deg,#f59e0b,#d97706)", color: "#451a03", label: "GK", icon: "🧤" },
  rest: { bg: "linear-gradient(135deg,#475569,#334155)", color: "#cbd5e1", label: "休み", icon: "💤" },
  field: { bg: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "#e0f2fe", label: "FP", icon: "🏃" },
};

// ═══════════════════════════════════════════
//  Default Members
// ═══════════════════════════════════════════
const DEFAULT_MEMBERS = [
  { id: "m1", name: "喜種" },
  { id: "m2", name: "上野" },
  { id: "m3", name: "川邉" },
  { id: "m4", name: "畑中" },
  { id: "m5", name: "山本" },
  { id: "m6", name: "伊達" },
  { id: "m7", name: "武田" },
];

// ═══════════════════════════════════════════
//  Court Background SVG
// ═══════════════════════════════════════════
function CourtBG() {
  return (
    <svg
      style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0, opacity: 0.06, pointerEvents: "none" }}
      viewBox="0 0 400 700"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect x="20" y="20" width="360" height="660" rx="6" fill="none" stroke="#38bdf8" strokeWidth="2.5" />
      <line x1="20" y1="350" x2="380" y2="350" stroke="#38bdf8" strokeWidth="2" />
      <circle cx="200" cy="350" r="55" fill="none" stroke="#38bdf8" strokeWidth="2" />
      <circle cx="200" cy="350" r="3" fill="#38bdf8" />
      <rect x="110" y="20" width="180" height="80" rx="4" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <rect x="145" y="20" width="110" height="40" rx="3" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <rect x="110" y="600" width="180" height="80" rx="4" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <rect x="145" y="640" width="110" height="40" rx="3" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <path d="M 20 20 Q 20 20 26 20" stroke="#38bdf8" strokeWidth="1" fill="none" />
      {/* Corner arcs */}
      <path d="M 20 35 A 15 15 0 0 1 35 20" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <path d="M 365 20 A 15 15 0 0 1 380 35" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <path d="M 20 665 A 15 15 0 0 0 35 680" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <path d="M 365 680 A 15 15 0 0 0 380 665" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
    </svg>
  );
}

// ═══════════════════════════════════════════
//  Members Tab
// ═══════════════════════════════════════════
function MembersTab({ allMembers, setAllMembers, selected, setSelected, lateIds, setLateIds, onGenerate, saveMembersToStorage }) {
  const [newName, setNewName] = useState("");
  const inputRef = useRef(null);

  const toggleSelect = (id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleLate = (id) => {
    setLateIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const addMember = () => {
    const name = newName.trim();
    if (!name) return;
    const id = "m" + Date.now();
    const updated = [...allMembers, { id, name }];
    setAllMembers(updated);
    saveMembersToStorage(updated);
    setNewName("");
    inputRef.current?.focus();
  };

  const removeMember = (id) => {
    const updated = allMembers.filter((m) => m.id !== id);
    setAllMembers(updated);
    saveMembersToStorage(updated);
    setSelected((prev) => prev.filter((x) => x !== id));
    setLateIds((prev) => prev.filter((x) => x !== id));
  };

  const selectedMembers = allMembers.filter((m) => selected.includes(m.id));
  const canGenerate = selectedMembers.length >= 5;

  return (
    <div>
      {/* Today's Lineup */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 10, letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>👥</span>
          今日のメンバー
          <span style={{ background: "#1e3a5f", color: "#38bdf8", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 800 }}>
            {selectedMembers.length}人
          </span>
        </div>

        {selectedMembers.length === 0 ? (
          <div style={{ background: "#0d1f4b", borderRadius: 14, padding: "28px 16px", textAlign: "center", border: "2px dashed #1e3a5f" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>👆</div>
            <div style={{ color: "#475569", fontSize: 14, fontWeight: 600 }}>下のメンバーをタップして追加</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {selectedMembers.map((m) => {
              const isLate = lateIds.includes(m.id);
              return (
                <div
                  key={m.id}
                  style={{
                    background: isLate ? "linear-gradient(135deg,#92400e,#78350f)" : "linear-gradient(135deg,#1e40af,#1d4ed8)",
                    borderRadius: 14,
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    border: isLate ? "1px solid #f59e0b" : "1px solid #2563eb",
                    animation: "fadeIn 0.2s ease",
                  }}
                >
                  <span style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>{m.name}</span>
                  {selectedMembers.length >= 6 && (
                  <button
                    onClick={() => toggleLate(m.id)}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 8,
                      fontSize: 10,
                      fontWeight: 700,
                      background: isLate ? "#f59e0b" : "#1e3a5f",
                      color: isLate ? "#451a03" : "#64748b",
                      transition: "all 0.15s",
                    }}
                  >
                    {isLate ? "遅刻⚠" : "遅刻?"}
                  </button>
                  )}
                  <button
                    onClick={() => toggleSelect(m.id)}
                    style={{ color: "#64748b", fontSize: 18, padding: "0 2px", lineHeight: 1 }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "16px",
            borderRadius: 14,
            background: canGenerate ? "linear-gradient(135deg,#2563eb,#0ea5e9)" : "#1e293b",
            color: canGenerate ? "#fff" : "#475569",
            fontSize: 17,
            fontWeight: 800,
            border: "none",
            letterSpacing: "1px",
            transition: "all 0.2s",
            boxShadow: canGenerate ? "0 4px 20px rgba(37,99,235,0.4)" : "none",
          }}
        >
          {canGenerate ? `⚽ ${selectedMembers.length}人でローテーション作成` : `あと${Math.max(0, 5 - selectedMembers.length)}人選んでください`}
        </button>
        {!canGenerate && selectedMembers.length > 0 && (
          <div style={{ textAlign: "center", fontSize: 12, color: "#f59e0b", marginTop: 6 }}>※ 最低5人必要です（FP4名 + GK1名）</div>
        )}
      </div>

      {/* All Members */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 10, letterSpacing: "0.5px" }}>
          📋 登録メンバー
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {allMembers.map((m) => {
            const isSelected = selected.includes(m.id);
            return (
              <div
                key={m.id}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <button
                  onClick={() => toggleSelect(m.id)}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 12,
                    fontSize: 16,
                    fontWeight: 700,
                    background: isSelected ? "#0d1f4b" : "#0d1f4b",
                    color: isSelected ? "#334155" : "#e2e8f0",
                    border: isSelected ? "2px solid #334155" : "2px solid #1e3a5f",
                    opacity: isSelected ? 0.4 : 1,
                    transition: "all 0.2s",
                    textDecoration: isSelected ? "line-through" : "none",
                  }}
                >
                  {m.name}
                </button>
                {!isSelected && !DEFAULT_MEMBERS.find((d) => d.id === m.id) && (
                  <button
                    onClick={() => removeMember(m.id)}
                    style={{ position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: 10, background: "#ef4444", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #06102b" }}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add New Member */}
      <div style={{ background: "#0d1f4b", borderRadius: 14, padding: "16px", border: "1px solid #1e3a5f" }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 10 }}>➕ 新規メンバー追加</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMember()}
            placeholder="名前を入力..."
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: 10,
              border: "2px solid #1e3a5f",
              background: "#06102b",
              color: "#e2e8f0",
              fontSize: 16,
              fontWeight: 600,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={addMember}
            style={{
              padding: "12px 20px",
              borderRadius: 10,
              background: newName.trim() ? "linear-gradient(135deg,#2563eb,#0ea5e9)" : "#1e293b",
              color: newName.trim() ? "#fff" : "#475569",
              fontSize: 15,
              fontWeight: 800,
              transition: "all 0.2s",
            }}
          >
            追加
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Now (Current Match) Tab
// ═══════════════════════════════════════════
function NowTab({ schedule, members, currentRound, totalRounds, setCurrentRound }) {
  if (!schedule.length || !members.length) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚽</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#475569" }}>メンバータブでローテーションを作成してください</div>
      </div>
    );
  }

  const round = schedule[currentRound];
  const gkMember = members.find((m) => m.idx === round.gk);
  const restMembers = round.rest.map((i) => members.find((m) => m.idx === i));
  const fieldMembers = members.filter((m) => m.idx !== round.gk && !round.rest.includes(m.idx));

  return (
    <div>
      {/* Round navigator */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 28 }}>
        <button
          onClick={() => setCurrentRound(Math.max(0, currentRound - 1))}
          disabled={currentRound === 0}
          style={{
            width: 48, height: 48, borderRadius: 14, background: "#0d1f4b", border: "1px solid #1e3a5f",
            color: currentRound === 0 ? "#1e3a5f" : "#38bdf8", fontSize: 24, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >‹</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 38, fontWeight: 900, color: "#38bdf8", fontVariantNumeric: "tabular-nums", letterSpacing: "-1px" }}>
            第{currentRound + 1}試合
          </div>
          <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
            {currentRound + 1} / {totalRounds}
          </div>
        </div>
        <button
          onClick={() => setCurrentRound(Math.min(totalRounds - 1, currentRound + 1))}
          disabled={currentRound >= totalRounds - 1}
          style={{
            width: 48, height: 48, borderRadius: 14, background: "#0d1f4b", border: "1px solid #1e3a5f",
            color: currentRound >= totalRounds - 1 ? "#1e3a5f" : "#38bdf8", fontSize: 24, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >›</button>
      </div>

      {/* Field Players */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 8, letterSpacing: "0.5px" }}>🏃 フィールドプレーヤー</div>
        <div style={{ display: "grid", gridTemplateColumns: fieldMembers.length <= 4 ? "1fr 1fr" : "1fr 1fr 1fr", gap: 10 }}>
          {fieldMembers.map((m) => (
            <div key={m.id} style={{ background: "linear-gradient(135deg,#1e40af,#1d4ed8)", borderRadius: 16, padding: "18px 14px", textAlign: "center", boxShadow: "0 4px 16px rgba(30,64,175,0.3)" }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#e0f2fe" }}>{m.name}</div>
              <div style={{ fontSize: 13, color: "rgba(224,242,254,0.6)", marginTop: 3, fontWeight: 600 }}>FP</div>
            </div>
          ))}
        </div>
      </div>

      {/* GK */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 8, letterSpacing: "0.5px" }}>🧤 ゴールキーパー</div>
        <div style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)", borderRadius: 16, padding: "20px 14px", textAlign: "center", boxShadow: "0 4px 16px rgba(245,158,11,0.3)" }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#451a03" }}>{gkMember?.name}</div>
          <div style={{ fontSize: 13, color: "rgba(69,26,3,0.6)", marginTop: 3, fontWeight: 600 }}>GK</div>
        </div>
      </div>

      {/* Rest */}
      {restMembers.length > 0 && (
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 8, letterSpacing: "0.5px" }}>💤 休み</div>
        <div style={{ display: "grid", gridTemplateColumns: restMembers.length === 1 ? "1fr" : "1fr 1fr", gap: 10 }}>
          {restMembers.map((m) => (
            <div key={m?.id} style={{ background: "linear-gradient(135deg,#334155,#1e293b)", borderRadius: 16, padding: "18px 14px", textAlign: "center", border: "1px solid #475569" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#94a3b8" }}>{m?.name}</div>
              <div style={{ fontSize: 13, color: "rgba(148,163,184,0.6)", marginTop: 3, fontWeight: 600 }}>休み</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Next preview */}
      {currentRound < totalRounds - 1 && (
        <div style={{ padding: "14px 16px", background: "#0d1f4b", borderRadius: 14, border: "1px solid #1e3a5f" }}>
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>
            次の試合（第{currentRound + 2}試合）
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {members.map((m) => {
              const role = getRole(schedule, currentRound + 1, m.idx);
              const s = ROLES[role];
              return (
                <span key={m.id} style={{ padding: "5px 12px", borderRadius: 10, fontSize: 13, fontWeight: 700, background: s.bg, color: s.color }}>
                  {m.name} {s.icon}
                </span>
              );
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

  if (!schedule.length) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#475569" }}>メンバータブでローテーションを作成してください</div>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", borderRadius: 14, background: "#0d1f4b", border: "1px solid #1e3a5f" }}>
      <table style={{ width: "100%", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ padding: "14px 8px", textAlign: "left", borderBottom: "2px solid #1e3a5f", color: "#475569", fontSize: 11, fontWeight: 700, position: "sticky", left: 0, background: "#0d1f4b", zIndex: 2, minWidth: 52 }}>
              #
            </th>
            {members.map((m, i) => (
              <th
                key={m.id}
                onClick={() => setSel(sel === i ? null : i)}
                style={{
                  padding: "14px 6px", textAlign: "center", borderBottom: "2px solid #1e3a5f",
                  color: sel === i ? "#38bdf8" : "#e2e8f0",
                  fontSize: 14, fontWeight: 800, cursor: "pointer", minWidth: 58,
                }}
              >
                {m.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: totalRounds }, (_, r) => {
            const isLoop = members.length > 0 && r > 0 && r % members.length === 0;
            return (
              <tr key={r}>
                <td style={{
                  padding: "10px 8px", fontWeight: 800, fontSize: 12, color: "#38bdf8",
                  borderBottom: "1px solid #132d5e", borderTop: isLoop ? "2px dashed #1e3a5f" : "none",
                  position: "sticky", left: 0, background: "#0d1f4b", zIndex: 1,
                }}>
                  {r + 1}
                </td>
                {members.map((m, mi) => {
                  const role = getRole(schedule, r, m.idx);
                  const s = ROLES[role];
                  const dim = sel !== null && sel !== mi;
                  return (
                    <td key={m.id}
                      onClick={() => setSel(sel === mi ? null : mi)}
                      style={{
                        padding: "8px 4px", textAlign: "center",
                        borderBottom: "1px solid #132d5e",
                        borderTop: isLoop ? "2px dashed #1e3a5f" : "none",
                      }}
                    >
                      <span style={{
                        display: "inline-block", padding: "5px 12px", borderRadius: 16,
                        fontSize: 12, fontWeight: 700, background: s.bg, color: s.color,
                        opacity: dim ? 0.15 : 1, transition: "opacity 0.15s",
                      }}>
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
function StatsTab({ schedule, members, totalRounds }) {
  if (!schedule.length) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#475569" }}>メンバータブでローテーションを作成してください</div>
      </div>
    );
  }

  const stats = members.map((m) => {
    let gk = 0, rest = 0, field = 0;
    for (let r = 0; r < totalRounds; r++) {
      const role = getRole(schedule, r, m.idx);
      if (role === "gk") gk++; else if (role === "rest") rest++; else field++;
    }
    return { ...m, gk, rest, field };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {stats.map((s) => (
        <div key={s.id} style={{ background: "#0d1f4b", border: "1px solid #1e3a5f", borderRadius: 16, padding: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontWeight: 900, fontSize: 18, color: "#f1f5f9" }}>{s.name}</div>
            <div style={{ fontSize: 13, color: "#475569", fontWeight: 600 }}>出場 {s.field + s.gk} / {totalRounds}</div>
          </div>
          <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", height: 32 }}>
            {[
              { val: s.field, ...ROLES.field },
              { val: s.gk, ...ROLES.gk },
              { val: s.rest, ...ROLES.rest },
            ].map(
              (item, j) =>
                item.val > 0 && (
                  <div key={j} style={{
                    flex: item.val, background: item.bg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 800, color: item.color,
                    minWidth: 36,
                  }}>
                    {item.label} {item.val}
                  </div>
                )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════
//  Rules Tab
// ═══════════════════════════════════════════
function RulesTab() {
  const sections = [
    {
      icon: "📐",
      title: "コート",
      items: [
        "サイズ: 約 40m × 20m（体育館サイズ）",
        "サッカーの約1/9の大きさ",
        "ゴール: 3m × 2m（サッカーの約半分）",
      ],
    },
    {
      icon: "👥",
      title: "人数",
      items: [
        "1チーム5人（GK1 + FP4）",
        "交代は自由、何度でもOK（フライングサブ）",
        "試合中いつでもベンチエリアから交代可能",
      ],
    },
    {
      icon: "⏱",
      title: "試合時間",
      items: [
        "前後半 各20分（プレイングタイム）",
        "ハーフタイム 15分",
        "タイムアウト: 各チーム前後半1回ずつ（1分間）",
      ],
    },
    {
      icon: "⚽",
      title: "ボール",
      items: [
        "4号球（サッカーは5号球）",
        "ローバウンド仕様（弾みにくい）",
        "小さめで足元の技術が活きる",
      ],
    },
    {
      icon: "🚫",
      title: "サッカーとの違い",
      items: [
        "スライディングタックル禁止",
        "オフサイドなし",
        "ゴールキックではなくGKのスロー",
        "キックインはボールを置いて4秒以内",
        "バックパス制限（GKへ2回連続のパス禁止）",
      ],
    },
    {
      icon: "🟨",
      title: "ファウル",
      items: [
        "チームファウル6つ目以降は第2PKが相手に与えられる",
        "第2PK: 10mの距離から直接フリーキック（壁なし）",
        "退場は2分間の退場（サッカーと違い補充可能）",
      ],
    },
    {
      icon: "💡",
      title: "初心者Tips",
      items: [
        "パスをつないでポゼッション重視がおすすめ",
        "コートが狭いので常にパスコースを作る意識",
        "GKも5人目のFPとして攻撃参加が重要",
        "スペースは一瞬で消えるので判断スピードが鍵",
      ],
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 42, marginBottom: 8 }}>⚽</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: "#38bdf8" }}>フットサルのルール</div>
        <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>知っておきたい基本ルールまとめ</div>
      </div>
      {sections.map((sec, i) => (
        <div key={i} style={{ background: "#0d1f4b", border: "1px solid #1e3a5f", borderRadius: 16, padding: "18px", overflow: "hidden" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#e2e8f0", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>{sec.icon}</span>
            {sec.title}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sec.items.map((item, j) => (
              <div key={j} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ color: "#2563eb", fontSize: 8, marginTop: 7, flexShrink: 0 }}>●</span>
                <span style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.6, fontWeight: 500 }}>{item}</span>
              </div>
            ))}
          </div>
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
  const [lateIds, setLateIds] = useState([]);
  const [totalRounds, setTotalRounds] = useState(10);
  const [currentRound, setCurrentRound] = useState(0);
  const [schedule, setSchedule] = useState([]);
  const [activeMembers, setActiveMembers] = useState([]);

  // Load persisted members
  useEffect(() => {
    db.load("members", null).then((saved) => {
      if (saved && saved.length > 0) setAllMembers(saved);
      setLoading(false);
    });
  }, []);

  const saveMembersToStorage = useCallback((members) => {
    db.save("members", members);
  }, []);

  const handleGenerate = useCallback(() => {
    const selMembers = allMembers
      .filter((m) => selected.includes(m.id))
      .map((m, i) => ({ ...m, idx: i }));

    const lateIndices = selMembers
      .filter((m) => lateIds.includes(m.id))
      .map((m) => m.idx);

    const sched = generateSchedule(selMembers.length, totalRounds, lateIndices);
    setSchedule(sched);
    setActiveMembers(selMembers);
    setCurrentRound(0);
    setTab("now");
  }, [allMembers, selected, lateIds, totalRounds]);

  const issues = useMemo(
    () => (schedule.length ? validateSchedule(schedule, activeMembers.length) : []),
    [schedule, activeMembers.length]
  );

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#06102b", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 48, animation: "pulse 1.5s infinite" }}>⚽</div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", maxWidth: 520, margin: "0 auto", minHeight: "100vh", background: "#06102b", overflow: "hidden" }}>
      <CourtBG />

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        * { box-sizing: border-box; }
        input::placeholder { color: #334155; }
      `}</style>

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "22px 16px 0", textAlign: "center" }}>
        <div style={{ fontSize: 26, fontWeight: 900, color: "#fff", letterSpacing: "1px", marginBottom: 2 }}>
          <span style={{ background: "linear-gradient(90deg,#38bdf8,#2563eb)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            フットサル ローテーション
          </span>
        </div>

        {/* Round control (shown when schedule exists and not on members/rules tab) */}
        {schedule.length > 0 && tab !== "members" && tab !== "rules" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 12, animation: "fadeIn 0.2s ease" }}>
            <span style={{ fontSize: 12, color: "#475569", fontWeight: 700 }}>試合数</span>
            <div style={{ display: "flex", alignItems: "center" }}>
              <button onClick={() => { const n = Math.max(1, totalRounds - 1); setTotalRounds(n); setCurrentRound(c => Math.min(c, n - 1)); const sched = generateSchedule(activeMembers.length, n, activeMembers.filter(m => lateIds.includes(m.id)).map(m => m.idx)); setSchedule(sched); }}
                style={{ width: 32, height: 32, borderRadius: "8px 0 0 8px", background: "#0d1f4b", border: "1px solid #1e3a5f", color: "#38bdf8", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
              <div style={{ width: 40, height: 32, background: "#06102b", border: "1px solid #1e3a5f", borderLeft: "none", borderRight: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 900, color: "#38bdf8", fontVariantNumeric: "tabular-nums" }}>{totalRounds}</div>
              <button onClick={() => { const n = Math.min(28, totalRounds + 1); setTotalRounds(n); const sched = generateSchedule(activeMembers.length, n, activeMembers.filter(m => lateIds.includes(m.id)).map(m => m.idx)); setSchedule(sched); }}
                style={{ width: 32, height: 32, borderRadius: "0 8px 8px 0", background: "#0d1f4b", border: "1px solid #1e3a5f", color: "#38bdf8", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
            </div>

          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 16px 120px" }}>
        {tab === "members" && (
          <MembersTab
            allMembers={allMembers}
            setAllMembers={setAllMembers}
            selected={selected}
            setSelected={setSelected}
            lateIds={lateIds}
            setLateIds={setLateIds}
            onGenerate={handleGenerate}
            saveMembersToStorage={saveMembersToStorage}
          />
        )}
        {tab === "now" && (
          <NowTab
            schedule={schedule}
            members={activeMembers}
            currentRound={currentRound}
            totalRounds={totalRounds}
            setCurrentRound={setCurrentRound}
          />
        )}
        {tab === "table" && <TableTab schedule={schedule} members={activeMembers} totalRounds={totalRounds} />}
        {tab === "stats" && <StatsTab schedule={schedule} members={activeMembers} totalRounds={totalRounds} />}
        {tab === "rules" && <RulesTab />}
      </div>

      {/* Bottom Tab Bar */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "rgba(6,16,43,0.96)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid #1e3a5f",
          display: "flex",
          justifyContent: "center",
          padding: "6px 0 max(8px, env(safe-area-inset-bottom))",
          zIndex: 50,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              maxWidth: 100,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              padding: "6px 0",
              color: tab === t.id ? "#38bdf8" : "#334155",
              fontSize: 10,
              fontWeight: 700,
              transition: "color 0.15s",
            }}
          >
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
