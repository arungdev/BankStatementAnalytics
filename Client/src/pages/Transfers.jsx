import { useCallback, useEffect, useState } from "react";
import { FiArrowRight, FiCheck, FiCheckCircle, FiX } from "react-icons/fi";
import api from "../api/client";
import { currencyFormatter, maskName } from "../utils/format";
import { usePrivacy } from "../context/usePrivacy";
import { Drawer, EmptyState, Tabs } from "@common/client";
import StatCard from "../components/StatCard";

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const fmtLongDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

const CONFIDENCE = {
  high: { label: "Very likely a transfer", color: "var(--success)", bg: "var(--success-light)" },
  medium: { label: "Possibly a transfer", color: "var(--warning)", bg: "var(--warning-light)" },
  low: { label: "Weak match — check before marking", color: "var(--danger)", bg: "var(--danger-light)" },
};

const confidenceOf = (p) => CONFIDENCE[p.confidence] || CONFIDENCE.low;

const Field = ({ label, value, span }) => (
  <div style={span ? { gridColumn: "span 2" } : undefined}>
    <div style={fieldLabel}>{label}</div>
    <div style={fieldValue}>{value || "—"}</div>
  </div>
);

// One side of a pair, with every column the parser captured for that row — enough
// to tell a genuine self-transfer from two unrelated rows sharing an amount.
const LegDetail = ({ leg, role }) => (
  <div style={{ border: "1px solid var(--border-color)", borderRadius: "12px", padding: "14px", marginBottom: "14px" }}>
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
      <span style={{ ...metaChip, fontWeight: 700 }}>{role}</span>
      <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-main)" }}>{leg.accountName}</span>
      <span
        className="tnum"
        style={{
          marginLeft: "auto",
          fontWeight: 700,
          color: leg.direction === "Credit" ? "var(--success)" : "var(--danger)",
        }}
      >
        {leg.direction === "Credit" ? "+" : "−"}
        {currencyFormatter.format(leg.amount)}
      </span>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
      <Field label="Date" value={fmtLongDate(leg.date)} />
      <Field label="Value date" value={leg.valueDate ? fmtLongDate(leg.valueDate) : null} />
      <Field label="Mode" value={leg.mode} />
      <Field label="Balance after" value={leg.balance ? currencyFormatter.format(leg.balance) : null} />
      <Field label="Merchant" value={maskName(leg.merchant)} span />
      <Field label="Category" value={[leg.category, leg.subCategory].filter(Boolean).join(" › ")} span />
      <Field label="Narration" value={maskName(leg.narration || leg.rawDescription)} span />
      <Field label="UPI / reference" value={leg.upiReference} span />
      <Field label="UPI VPA" value={maskName(leg.upiVpa)} span />
      <Field label="Bank reference" value={leg.bankReference} span />
      {leg.note && <Field label="Note" value={leg.note} span />}
    </div>
  </div>
);

// Stable identity for a suggested pair (no groupId yet) — also used to remember
// locally-dismissed suggestions across reloads.
const pairKey = (p) =>
  [p.from.accountId, p.from.bankReference, p.to.accountId, p.to.bankReference].join("|");

const DISMISSED_KEY = "dismissedTransferPairs";
const loadDismissed = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

export default function Transfers() {
  // Re-render on the "hide amounts" toggle (this page reads no outlet context).
  usePrivacy();
  const [suggestions, setSuggestions] = useState([]);
  const [marked, setMarked] = useState([]);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("suggestions");
  const [selected, setSelected] = useState(null);
  const [drawerWidth, setDrawerWidth] = useState(460);

  const load = useCallback(() => {
    return Promise.all([
      api.get("/transfers/suggestions").then((r) => r.data || []),
      api.get("/transfers").then((r) => r.data || []),
    ])
      .then(([s, m]) => {
        setSuggestions(s);
        setMarked(m);
      })
      .catch((err) => console.error("Failed to load transfers", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const legKey = (leg) => ({
    accountId: leg.accountId,
    bankReference: leg.bankReference,
    bankType: leg.bankType,
    transactionType: leg.transactionType,
  });

  const markPair = (p) => {
    setBusy(true);
    setSelected(null);
    api
      .post("/transfers/mark", { from: legKey(p.from), to: legKey(p.to) })
      .then(load)
      .catch((err) => {
        console.error(err);
        alert("Failed to mark the pair as a transfer.");
      })
      .finally(() => setBusy(false));
  };

  const markMany = (pairs, prompt) => {
    if (!window.confirm(prompt)) return;
    setBusy(true);
    Promise.allSettled(
      pairs.map((p) => api.post("/transfers/mark", { from: legKey(p.from), to: legKey(p.to) }))
    )
      .then(load)
      .finally(() => setBusy(false));
  };

  // Mark only the pairs the user can see — locally dismissed ones stay out.
  const markAll = () =>
    markMany(visibleSuggestions, `Mark all ${visibleSuggestions.length} suggested pairs as transfers?`);

  const markAllHigh = () =>
    markMany(
      highConfidence,
      `Mark the ${highConfidence.length} high-confidence pair${highConfidence.length === 1 ? "" : "s"} as transfers?`
    );

  const unmark = (p) => {
    setBusy(true);
    setSelected(null);
    api
      .delete(`/transfers/${p.groupId}`)
      .then(load)
      .catch((err) => console.error(err))
      .finally(() => setBusy(false));
  };

  // Dismissals are cosmetic (kept in this browser only) — the pair simply
  // stops being suggested; analytics still count both rows.
  const dismiss = (p) => {
    const next = new Set(dismissed);
    next.add(pairKey(p));
    setDismissed(next);
    setSelected(null);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
  };

  const visibleSuggestions = suggestions.filter((p) => !dismissed.has(pairKey(p)));
  const highConfidence = visibleSuggestions.filter((p) => p.confidence === "high");

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <div className="loader-text">Looking for transfers between your accounts...</div>
      </div>
    );
  }

  const markedTotal = marked.reduce((sum, p) => sum + (p.amount || 0), 0);

  const TABS = [
    { key: "suggestions", label: "Suggested", count: visibleSuggestions.length },
    { key: "marked", label: "Marked transfers", count: marked.length },
  ];

  // Whole card opens the detail panel; the action buttons sit on top of it and
  // must not bubble their click up into the card.
  const PairCard = ({ p, actions }) => {
    const conf = confidenceOf(p);
    return (
      <div
        style={cardBase}
        className="transfer-card"
        role="button"
        tabIndex={0}
        onClick={() => setSelected(p)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSelected(p);
          }
        }}
        title="Click for full details"
      >
        <div className="tnum" style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.5px", marginBottom: "12px" }}>
          {currencyFormatter.format(p.amount)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <div style={legBox}>
            <div style={legAccount}>{p.from.accountName}</div>
            <div style={legDate}>{fmtDate(p.from.date)}</div>
            <div style={legDesc} title={p.from.description}>{maskName(p.from.description) || p.from.mode || "—"}</div>
          </div>
          <FiArrowRight size={16} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
          <div style={legBox}>
            <div style={legAccount}>{p.to.accountName}</div>
            <div style={legDate}>{fmtDate(p.to.date)}</div>
            <div style={legDesc} title={p.to.description}>{maskName(p.to.description) || p.to.mode || "—"}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={metaChip}>
            {p.daysApart === 0 ? "same day" : `${p.daysApart} day${p.daysApart === 1 ? "" : "s"} apart`}
          </span>
          {!p.groupId && (
            <span style={{ ...metaChip, color: conf.color, background: conf.bg, borderColor: "transparent" }}>
              {p.confidence}
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }} onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* ── Summary strip ── */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "24px" }}>
        <StatCard
          label="Suggested pairs"
          value={visibleSuggestions.length.toString()}
          sub="matching debit ↔ credit found"
        />
        <StatCard
          label="Marked transfers"
          value={marked.length.toString()}
          sub="excluded from income & spend"
        />
        <StatCard
          label="Amount excluded"
          value={currencyFormatter.format(markedTotal)}
          sub="own money, not income or spend"
        />
      </div>

      {/* ── Tab bar + Mark all ── */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "24px", gap: "12px", flexWrap: "wrap" }}>
        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} variant="underline" />
        {activeTab === "suggestions" && visibleSuggestions.length > 0 && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
            {highConfidence.length > 0 && (
              <button
                className="btn"
                onClick={markAllHigh}
                disabled={busy}
                style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
                title="Mark only the pairs flagged high confidence"
              >
                <FiCheck size={15} /> Mark high confidence ({highConfidence.length})
              </button>
            )}
            <button
              className="btn primary"
              onClick={markAll}
              disabled={busy}
              style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
            >
              <FiCheckCircle size={15} /> Mark all as transfers
            </button>
          </div>
        )}
      </div>

      {activeTab === "suggestions" && (
        <section>
          <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: 0, marginBottom: "16px" }}>
            A debit in one of your accounts matched to an equal credit in another within a few days.
            Marking a pair as a transfer removes it from income and spending analytics — the money
            just moved between your own accounts.
          </p>
          {visibleSuggestions.length === 0 ? (
            <EmptyState icon="🔍" title="Nothing found" message="No unconfirmed transfers between your accounts were detected." />
          ) : (
            <div style={grid}>
              {visibleSuggestions.map((p) => (
                <PairCard
                  key={pairKey(p)}
                  p={p}
                  actions={
                    <>
                      <button className="btn primary" disabled={busy} onClick={() => markPair(p)} style={btnRow}>
                        <FiCheck size={14} /> Transfer
                      </button>
                      <button className="btn" disabled={busy} onClick={() => dismiss(p)} style={btnRow} title="Hide this suggestion (it will still count in analytics)">
                        <FiX size={14} /> Not a transfer
                      </button>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "marked" && (
        <section>
          {marked.length === 0 ? (
            <EmptyState icon="⇄" title="No marked transfers" message="Confirm a suggested pair to exclude it from your analytics." />
          ) : (
            <div style={grid}>
              {marked.map((p) => (
                <PairCard
                  key={p.groupId}
                  p={p}
                  actions={
                    <button className="btn" disabled={busy} onClick={() => unmark(p)} style={btnRow} title="Count these rows in analytics again">
                      <FiX size={14} /> Unmark
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Detail panel ── */}
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.groupId ? "Transfer details" : "Suggested transfer"}
        width={drawerWidth}
        onWidthChange={setDrawerWidth}
      >
        {selected && (
          <>
            <div
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
                padding: "4px 0 20px", borderBottom: "1px solid var(--border-color)", marginBottom: "20px",
              }}
            >
              <div className="tnum" style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-0.5px", color: "var(--text-main)" }}>
                {currencyFormatter.format(selected.amount)}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "13px", fontWeight: 600, textAlign: "center" }}>
                {selected.from.accountName} → {selected.to.accountName}
              </div>
            </div>

            {/* Why the detector paired these two rows — the evidence, so a coincidental
                amount match can be spotted before it is excluded from analytics. */}
            <div
              style={{
                background: confidenceOf(selected).bg,
                border: "1px solid var(--border-color)",
                borderRadius: "12px",
                padding: "12px 14px",
                marginBottom: "18px",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "13px", color: confidenceOf(selected).color, marginBottom: "8px" }}>
                {confidenceOf(selected).label}
              </div>
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.7 }}>
                <li>Equal amounts of {currencyFormatter.format(selected.amount)} in two different accounts</li>
                <li>
                  {selected.daysApart === 0
                    ? "Both posted on the same day"
                    : `Posted ${selected.daysApart} day${selected.daysApart === 1 ? "" : "s"} apart`}
                  {selected.creditPostedFirst && " — the credit landed before the debit"}
                </li>
                {selected.sharedNames?.length > 0 ? (
                  <li>Both narrations mention {selected.sharedNames.map(maskName).join(", ")}</li>
                ) : (
                  <li>No name appears in both narrations — the amount alone links them</li>
                )}
              </ul>
            </div>

            <LegDetail leg={selected.from} role="Money out" />
            <LegDetail leg={selected.to} role="Money in" />

            <div style={{ display: "flex", gap: "8px", marginTop: "18px" }}>
              {selected.groupId ? (
                <button className="btn" disabled={busy} onClick={() => unmark(selected)} style={btnRow}>
                  <FiX size={14} /> Unmark as transfer
                </button>
              ) : (
                <>
                  <button className="btn primary" disabled={busy} onClick={() => markPair(selected)} style={btnRow}>
                    <FiCheck size={14} /> Mark as transfer
                  </button>
                  <button className="btn" disabled={busy} onClick={() => dismiss(selected)} style={btnRow}>
                    <FiX size={14} /> Not a transfer
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
  gap: "16px",
};

const cardBase = {
  border: "1px solid var(--border-color)",
  borderRadius: "14px",
  padding: "18px",
  background: "var(--surface)",
  boxShadow: "var(--shadow-sm)",
  cursor: "pointer",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

const fieldLabel = {
  fontSize: "11px",
  color: "var(--text-muted)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.3px",
};

const fieldValue = {
  marginTop: "3px",
  fontSize: "13px",
  color: "var(--text-main)",
  fontWeight: 500,
  wordBreak: "break-word",
};

const legBox = { flex: 1, minWidth: 0 };

const legAccount = {
  fontWeight: 700,
  fontSize: "13px",
  color: "var(--text-main)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const legDate = { fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" };

const legDesc = {
  fontSize: "11px",
  color: "var(--text-faint)",
  marginTop: "2px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const metaChip = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--text-muted)",
  background: "var(--surface-2)",
  border: "1px solid var(--border-color)",
  padding: "3px 9px",
  borderRadius: "999px",
};

const btnRow = { display: "flex", alignItems: "center", gap: "6px" };
