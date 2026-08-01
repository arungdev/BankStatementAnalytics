import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FiCheck, FiX, FiTrash2, FiEdit2, FiCalendar, FiPlus } from "react-icons/fi";
import api from "../api/client";
import { getCardReminders } from "../api/cards";
import { currencyFormatter, maskName } from "../utils/format";
import { usePrivacy } from "../context/usePrivacy";
import { Avatar, Badge, Drawer, EmptyState, Modal, Tabs } from "@common/client";
import StatCard from "../components/StatCard";

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const dueLabel = (days) => {
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
};

// Unpaid credit-card statements (ids prefixed "cc-") share the recurring-bill
// item shape but aren't editable and have no bill transactions to open.
const isCardBill = (b) => String(b.id).startsWith("cc-");

const CADENCES = ["Weekly", "Monthly", "Quarterly", "Yearly"];
// How many times a cadence bills per month, for the normalized monthly total.
const PER_MONTH = { Weekly: 52 / 12, Monthly: 1, Quarterly: 1 / 3, Yearly: 1 / 12 };

export default function Bills() {
  // Subscribe to the mask flag so toggling "hide amounts" re-renders this page.
  // This page reads no outlet context, so without this subscription React
  // Router's cached outlet element bails out of re-rendering and the
  // currencyFormatter amounts stay stale until the next unrelated render.
  usePrivacy();
  const navigate = useNavigate();
  const [bills, setBills] = useState([]);
  const [cardBills, setCardBills] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("due");
  const [editing, setEditing] = useState(null); // bill being edited
  const [selectedBill, setSelectedBill] = useState(null); // bill/suggestion whose transactions are shown
  const [selectedKind, setSelectedKind] = useState("bill"); // "bill" | "suggestion"
  const [billTxns, setBillTxns] = useState([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(450);

  const load = useCallback(() => {
    return Promise.all([
      api.get("/bills").then((r) => r.data || []),
      api.get("/bills/suggestions").then((r) => r.data || []),
      getCardReminders().then((r) => r.data || []).catch(() => []),
    ])
      .then(([b, s, c]) => {
        setBills(b);
        setSuggestions(s);
        setCardBills(c);
      })
      .catch((err) => console.error("Failed to load bills", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmSuggestion = (s) => {
    api
      .post("/bills", {
        name: s.name,
        matchKey: s.matchKey,
        counterPartyId: s.counterPartyId ?? null,
        expectedAmount: s.expectedAmount,
        dueDayOfMonth: s.dueDayOfMonth,
        cadence: s.cadence || "Monthly",
        lastSeenDate: s.lastSeenDate,
      })
      .then(load)
      .catch((err) => {
        console.error(err);
        alert("Failed to add bill.");
      });
  };

  const dismissSuggestion = (s) => {
    api
      .post("/bills/dismiss", { name: s.name, matchKey: s.matchKey })
      .then(() => setSuggestions((prev) => prev.filter((x) => x.matchKey !== s.matchKey)))
      .catch((err) => console.error(err));
  };

  const openBill = (bill) => {
    setSelectedBill(bill);
    setSelectedKind("bill");
    setBillTxns([]);
    setLoadingTxns(true);
    api
      .get(`/bills/${bill.id}/transactions`)
      .then((res) => setBillTxns(res.data || []))
      .catch((err) => console.error(err))
      .finally(() => setLoadingTxns(false));
  };

  const openSuggestion = (s) => {
    setSelectedBill(s);
    setSelectedKind("suggestion");
    setBillTxns([]);
    setLoadingTxns(true);
    api
      .post("/bills/suggestion-transactions", { name: s.name, matchKey: s.matchKey, expectedAmount: s.expectedAmount })
      .then((res) => setBillTxns(res.data || []))
      .catch((err) => console.error(err))
      .finally(() => setLoadingTxns(false));
  };

  const closeBill = () => {
    setSelectedBill(null);
    setBillTxns([]);
  };

  const deleteBill = (bill) => {
    if (!window.confirm(`Remove the reminder for "${bill.name}"?`)) return;
    api
      .delete(`/bills/${bill.id}`)
      .then(load)
      .catch((err) => console.error(err));
  };

  const openAdd = () =>
    setEditing({ isNew: true, name: "", expectedAmount: "", dueDayOfMonth: "1", cadence: "Monthly" });

  const saveEdit = () => {
    const name = (editing.name || "").trim();
    if (!name) {
      alert("Please enter a name for the bill.");
      return;
    }
    const payload = {
      name,
      expectedAmount: Number(editing.expectedAmount) || 0,
      dueDayOfMonth: Number(editing.dueDayOfMonth) || 1,
      cadence: editing.cadence || "Monthly",
    };
    const request = editing.isNew
      ? api.post("/bills", { ...payload, matchKey: "" })
      : api.put(`/bills/${editing.id}`, { ...payload, matchKey: editing.matchKey });

    request
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((err) => {
        console.error(err);
        alert(editing.isNew ? "Failed to add bill." : "Failed to update bill.");
      });
  };

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <div className="loader-text">Loading bills...</div>
      </div>
    );
  }

  // Card bills come pre-filtered by the server (unpaid, due within 7 days or overdue).
  const dueSoon = [...cardBills, ...bills.filter((b) => !b.paidThisCycle && b.daysUntilDue <= 7)]
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  // ── Summary metrics for the hero strip ──
  // Normalized per-month equivalent: weekly ×52/12, quarterly ÷3, yearly ÷12.
  const monthlyTotal = bills.reduce(
    (sum, b) => sum + (b.expectedAmount || 0) * (PER_MONTH[b.cadence] ?? 1), 0);
  const paidCount = bills.filter((b) => b.paidThisCycle).length;
  const nextUnpaid = bills
    .filter((b) => !b.paidThisCycle)
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue)[0];

  const TABS = [
    { key: "due", label: "Due soon", count: dueSoon.length },
    { key: "bills", label: "Your bills", count: bills.length },
    { key: "suggestions", label: "Suggested", count: suggestions.length },
  ];

  return (
    <div style={{ marginRight: selectedBill ? drawerWidth : 0, transition: "margin-right 0.2s ease" }}>
      <style>{`
        .bill-head {
          display: grid;
          grid-template-columns: minmax(0,1fr) 80px 120px 150px 120px 80px;
          gap: 16px;
          padding: 12px 20px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--text-faint);
          border-bottom: 1px solid var(--border-color);
          background: var(--surface-2);
        }
        .bill-row {
          display: grid;
          grid-template-columns: minmax(0,1fr) 80px 120px 150px 120px 80px;
          align-items: center;
          gap: 16px;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: background 0.12s;
        }
        .bill-row:hover { background: var(--surface-2); }
        .bill-row:last-child { border-bottom: none; }
        @media (max-width: 760px) {
          .bill-head, .bill-row { grid-template-columns: minmax(0,1fr) 130px 110px 70px; }
          .bill-col-day, .bill-col-next { display: none; }
        }
      `}</style>

      {/* ── Summary strip ── */}
      {bills.length > 0 && (
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "24px" }}>
          <StatCard
            label="Monthly total"
            value={currencyFormatter.format(monthlyTotal)}
            sub={`${bills.length} recurring bill${bills.length === 1 ? "" : "s"} · per-month equivalent`}
          />
          <StatCard
            label="Due soon"
            value={dueSoon.length.toString()}
            valueColor={dueSoon.length > 0 ? "#fbbf24" : undefined}
            sub={dueSoon.length > 0 ? "within 7 days" : "nothing due"}
            accent={dueSoon.length > 0 ? "#fbbf24" : undefined}
          />
          <StatCard
            label="Paid this cycle"
            value={`${paidCount} / ${bills.length}`}
            valueColor={paidCount === bills.length ? "#34d399" : undefined}
            sub={paidCount === bills.length ? "all caught up" : `${bills.length - paidCount} outstanding`}
            accent={paidCount === bills.length ? "#34d399" : undefined}
          />
          <StatCard
            label="Next bill"
            value={nextUnpaid ? currencyFormatter.format(nextUnpaid.expectedAmount) : "—"}
            sub={nextUnpaid ? `${maskName(nextUnpaid.name)} · ${fmtDate(nextUnpaid.nextDueDate)}` : "nothing scheduled"}
          />
        </div>
      )}

      {/* ── Tab bar + Add bill ── */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "24px", gap: "12px", flexWrap: "wrap" }}>
        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} variant="underline" />
        <button
          className="btn primary"
          onClick={openAdd}
          style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px", whiteSpace: "nowrap" }}
        >
          <FiPlus size={15} /> Add bill
        </button>
      </div>

      {/* ── Due soon ── */}
      {activeTab === "due" && (
      <section>
        {dueSoon.length === 0 ? (
          <EmptyState icon="🎉" title="All clear" message="No bills due in the next 7 days." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" }}>
            {dueSoon.map((b) => {
              const urgent = b.daysUntilDue <= 2;
              return (
                <div
                  key={b.id}
                  onClick={() => (isCardBill(b) ? navigate("/") : openBill(b))}
                  title={isCardBill(b) ? "View card summary" : "View transactions"}
                  style={{ ...cardBase, borderLeft: `4px solid ${urgent ? "var(--danger)" : "var(--warning)"}` }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
                    <Avatar name={maskName(b.name)} />
                    <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--text-main)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {maskName(b.name)}
                    </div>
                  </div>
                  <div className="tnum" style={{ fontSize: "24px", fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.5px" }}>
                    {currencyFormatter.format(b.expectedAmount)}
                  </div>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "12px",
                    fontSize: "12px", fontWeight: 700,
                    color: urgent ? "var(--danger)" : "var(--warning)",
                    background: urgent ? "var(--danger-light)" : "var(--warning-light)",
                    padding: "4px 10px", borderRadius: "999px",
                  }}>
                    <FiCalendar size={12} /> {dueLabel(b.daysUntilDue)} · {fmtDate(b.nextDueDate)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* ── Your bills ── */}
      {activeTab === "bills" && (
      <section>
        {bills.length === 0 ? (
          <EmptyState
            icon="🔔"
            title="No bills yet"
            message="Add a bill manually, or confirm a detected one in the Suggested tab to start getting reminders."
            action={
              <button className="btn primary" onClick={openAdd} style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "14px" }}>
                <FiPlus size={15} /> Add your first bill
              </button>
            }
          />
        ) : (
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border-color)",
            borderRadius: "14px", boxShadow: "var(--shadow-sm)", overflow: "hidden",
          }}>
            <div className="bill-head">
              <span>Bill</span>
              <span className="bill-col-day" style={{ textAlign: "center" }}>Due day</span>
              <span className="bill-col-next">Next due</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>Amount</span>
              <span />
            </div>
            <div style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
              {bills.map((b) => (
                <div key={b.id} className="bill-row" onClick={() => openBill(b)} title="View transactions">
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                    <Avatar name={maskName(b.name)} />
                    <div style={{ fontWeight: 700, color: "var(--text-main)", fontSize: "14px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {maskName(b.name)}
                    </div>
                    {b.cadence && b.cadence !== "Monthly" && (
                      <span style={{ ...metaChip, flexShrink: 0 }}>{b.cadence}</span>
                    )}
                  </div>
                  <div className="bill-col-day" style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                    {b.dueDayOfMonth}
                  </div>
                  <div className="bill-col-next" style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                    {fmtDate(b.nextDueDate)}
                  </div>
                  <div>
                    {b.paidThisCycle ? (
                      <Badge variant="green">Paid this cycle</Badge>
                    ) : b.daysUntilDue <= 7 ? (
                      <Badge variant="purple">{dueLabel(b.daysUntilDue)}</Badge>
                    ) : (
                      <Badge variant="blue">{dueLabel(b.daysUntilDue)}</Badge>
                    )}
                  </div>
                  <div className="tnum" style={{ textAlign: "right", fontWeight: 800, color: "var(--text-main)", fontSize: "15px", letterSpacing: "-0.3px" }}>
                    {currencyFormatter.format(b.expectedAmount)}
                  </div>
                  <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                    <button onClick={(e) => { e.stopPropagation(); setEditing({ ...b }); }} title="Edit" style={iconBtn}>
                      <FiEdit2 size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteBill(b); }} title="Remove" style={{ ...iconBtn, color: "var(--danger)" }}>
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      )}

      {/* ── Suggested bills ── */}
      {activeTab === "suggestions" && (
      <section>
        <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: 0, marginBottom: "16px" }}>
          Detected from your transaction history — debits that recur weekly, monthly, quarterly or
          yearly with a similar amount (subscriptions, SIPs, EMIs, premiums).
        </p>
        {suggestions.length === 0 ? (
          <EmptyState icon="🔍" title="Nothing new" message="No new recurring bills detected." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
            {suggestions.map((s) => {
              const active = selectedBill === s;
              return (
                <div
                  key={s.matchKey}
                  onClick={() => openSuggestion(s)}
                  title="View transactions"
                  style={{
                    ...cardBase,
                    border: `1px dashed ${active ? "var(--primary)" : "var(--border-color)"}`,
                    background: active ? "var(--primary-light)" : "var(--surface)",
                    borderLeft: `1px dashed ${active ? "var(--primary)" : "var(--border-color)"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
                    <Avatar name={maskName(s.name)} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {maskName(s.name)}
                      </div>
                      <div className="tnum" style={{ fontSize: "18px", fontWeight: 800, color: "var(--text-main)", marginTop: "2px", letterSpacing: "-0.5px" }}>
                        {currencyFormatter.format(s.expectedAmount)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px" }}>
                    <span style={{ ...metaChip, color: "var(--primary)", borderColor: "var(--primary)" }}>
                      {s.cadence || "Monthly"}
                    </span>
                    {s.cadence !== "Weekly" && <span style={metaChip}>~day {s.dueDayOfMonth}</span>}
                    <span style={metaChip}>seen {s.occurrenceCount}×</span>
                    <span style={metaChip}>last {fmtDate(s.lastSeenDate)}</span>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="btn primary" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }} onClick={(e) => { e.stopPropagation(); confirmSuggestion(s); }}>
                      <FiCheck size={14} /> Confirm
                    </button>
                    <button className="btn" style={{ display: "flex", alignItems: "center", gap: "6px" }} onClick={(e) => { e.stopPropagation(); dismissSuggestion(s); }}>
                      <FiX size={14} /> Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* ── Edit modal ── */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={
          editing && (
            <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Avatar name={editing.name || "?"} size={36} />
              {editing.isNew ? "Add a bill" : "Edit bill"}
            </span>
          )
        }
        width={380}
        footer={
          <>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn primary" onClick={saveEdit}>Save</button>
          </>
        }
      >
        {editing && (
          <>
            <label style={editLabel}>Name</label>
            <input className="field-input" autoFocus placeholder="e.g. Netflix, Rent, Electricity" style={{ width: "100%", marginBottom: "12px" }} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <label style={editLabel}>Expected amount</label>
            <input className="field-input" type="number" placeholder="0" style={{ width: "100%", marginBottom: "12px" }} value={editing.expectedAmount} onChange={(e) => setEditing({ ...editing, expectedAmount: e.target.value })} />
            <label style={editLabel}>Repeats</label>
            <select
              className="field-input"
              style={{ width: "100%", marginBottom: "12px" }}
              value={editing.cadence || "Monthly"}
              onChange={(e) => setEditing({ ...editing, cadence: e.target.value })}
            >
              {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label style={editLabel}>Due day of month</label>
            <input className="field-input" type="number" min="1" max="31" style={{ width: "100%" }} value={editing.dueDayOfMonth} onChange={(e) => setEditing({ ...editing, dueDayOfMonth: e.target.value })} />
          </>
        )}
      </Modal>

      {/* ── Transactions drawer — matches the Transactions page RHS panel ── */}
      <Drawer
        open={!!selectedBill}
        onClose={closeBill}
        title={selectedKind === "suggestion" ? "Suggested bill" : "Bill transactions"}
        width={drawerWidth}
        onWidthChange={setDrawerWidth}
        modal={false}
      >
        {selectedBill && (
          <>
            {/* Summary header, like a transaction's amount header */}
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
              padding: "8px 0 22px", borderBottom: "1px solid var(--border-color)", marginBottom: "24px",
            }}>
              <Avatar name={maskName(selectedBill.name)} size={52} />
              <div className="tnum" style={{ fontSize: "34px", fontWeight: 800, letterSpacing: "-0.5px", color: "var(--danger)" }}>
                {currencyFormatter.format(selectedBill.expectedAmount)}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "15px", fontWeight: 600, textAlign: "center" }}>
                {maskName(selectedBill.name)}
              </div>
              <div style={{ color: "var(--text-faint)", fontSize: "13px", textAlign: "center" }}>
                {selectedKind === "suggestion"
                  ? `~day ${selectedBill.dueDayOfMonth} · seen ${selectedBill.occurrenceCount}× · last ${fmtDate(selectedBill.lastSeenDate)}`
                  : `~day ${selectedBill.dueDayOfMonth} · next due ${fmtDate(selectedBill.nextDueDate)}`}
              </div>
            </div>

            {loadingTxns ? (
              <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "40px" }}>Loading transactions...</div>
            ) : billTxns.length === 0 ? (
              <EmptyState icon="📭" title="No payments" message="No matching transactions found for this bill." />
            ) : (
              <>
                <div style={{ fontSize: "11px", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "12px" }}>
                  {billTxns.length} payment{billTxns.length === 1 ? "" : "s"}
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {billTxns.map((tx, idx) => (
                    <div
                      key={`${tx.bankReference}-${idx}`}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        padding: "12px 0",
                        borderBottom: idx < billTxns.length - 1 ? "1px solid var(--border-subtle)" : "none",
                      }}
                    >
                      <Avatar name={maskName(tx.description || selectedBill.name)} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: "var(--text-main)", fontSize: "13px" }}>
                          {new Date(tx.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {maskName(tx.description) || tx.mode || "Transfer"}
                        </div>
                      </div>
                      <div className="tnum" style={{ fontWeight: 800, fontSize: "14px", color: "var(--danger)", whiteSpace: "nowrap" }}>
                        −{currencyFormatter.format(tx.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}

const cardBase = {
  border: "1px solid var(--border-color)",
  borderRadius: "14px",
  padding: "18px",
  background: "var(--surface)",
  boxShadow: "var(--shadow-sm)",
  cursor: "pointer",
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

const iconBtn = {
  background: "var(--surface-2)",
  border: "1px solid var(--border-color)",
  borderRadius: "8px",
  width: "32px",
  height: "32px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "var(--text-muted)",
};

const editLabel = { display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "4px" };
