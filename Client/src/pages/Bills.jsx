import { useEffect, useState, useCallback } from "react";
import { FiBell, FiCheck, FiX, FiTrash2, FiEdit2, FiCalendar } from "react-icons/fi";
import api from "../api/client";
import { currencyFormatter } from "../utils/format";
import EmptyState from "../components/ui/EmptyState";
import Badge from "../components/ui/Badge";
import Drawer from "../components/ui/Drawer";

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const dueLabel = (days) => {
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
};

export default function Bills() {
  const [bills, setBills] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // bill being edited
  const [selectedBill, setSelectedBill] = useState(null); // bill whose transactions are shown
  const [billTxns, setBillTxns] = useState([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(450);

  const load = useCallback(() => {
    return Promise.all([
      api.get("/bills").then((r) => r.data || []),
      api.get("/bills/suggestions").then((r) => r.data || []),
    ])
      .then(([b, s]) => {
        setBills(b);
        setSuggestions(s);
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
    setBillTxns([]);
    setLoadingTxns(true);
    api
      .get(`/bills/${bill.id}/transactions`)
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

  const saveEdit = () => {
    api
      .put(`/bills/${editing.id}`, {
        name: editing.name,
        matchKey: editing.matchKey,
        expectedAmount: Number(editing.expectedAmount) || 0,
        dueDayOfMonth: Number(editing.dueDayOfMonth) || 1,
      })
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((err) => {
        console.error(err);
        alert("Failed to update bill.");
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

  const dueSoon = bills.filter((b) => !b.paidThisCycle && b.daysUntilDue <= 7);

  return (
    <div style={{ marginRight: selectedBill ? drawerWidth : 0, transition: "margin-right 0.2s ease" }}>
      {/* ── Due soon ── */}
      <section style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <FiBell size={18} />
          <h2 style={{ margin: 0, fontSize: "18px" }}>Due soon</h2>
          {dueSoon.length > 0 && <Badge variant="purple">{dueSoon.length}</Badge>}
        </div>
        {dueSoon.length === 0 ? (
          <EmptyState message="No bills due in the next 7 days." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "16px" }}>
            {dueSoon.map((b) => (
              <div
                key={b.id}
                onClick={() => openBill(b)}
                title="View transactions"
                style={{
                  border: "1px solid var(--border-color, #e5e7eb)",
                  borderLeft: `4px solid ${b.daysUntilDue <= 2 ? "#ef4444" : "#f59e0b"}`,
                  borderRadius: "10px",
                  padding: "16px",
                  background: "var(--surface, #fff)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--text-main, #111827)" }}>{b.name}</div>
                <div style={{ fontSize: "22px", fontWeight: 800, margin: "6px 0", color: "var(--text-main, #111827)" }}>
                  {currencyFormatter.format(b.expectedAmount)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: b.daysUntilDue <= 2 ? "#ef4444" : "#b45309", fontWeight: 600 }}>
                  <FiCalendar size={13} /> {dueLabel(b.daysUntilDue)} · {fmtDate(b.nextDueDate)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Your bills ── */}
      <section style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "18px", marginBottom: "16px" }}>Your bills</h2>
        {bills.length === 0 ? (
          <EmptyState message="No recurring bills yet. Confirm a suggestion below to start getting reminders." />
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Amount</th>
                  <th>Due day</th>
                  <th>Next due</th>
                  <th>Status</th>
                  <th style={{ width: "90px" }}></th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} onClick={() => openBill(b)} style={{ cursor: "pointer" }} title="View transactions">
                    <td style={{ fontWeight: 700, color: "var(--text-main)" }}>{b.name}</td>
                    <td>{currencyFormatter.format(b.expectedAmount)}</td>
                    <td>{b.dueDayOfMonth}</td>
                    <td>{fmtDate(b.nextDueDate)}</td>
                    <td>
                      {b.paidThisCycle ? (
                        <Badge variant="green">Paid this cycle</Badge>
                      ) : b.daysUntilDue <= 7 ? (
                        <Badge variant="purple">{dueLabel(b.daysUntilDue)}</Badge>
                      ) : (
                        <Badge variant="blue">{dueLabel(b.daysUntilDue)}</Badge>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditing({ ...b }); }}
                          title="Edit"
                          style={iconBtn}
                        >
                          <FiEdit2 size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteBill(b); }}
                          title="Remove"
                          style={{ ...iconBtn, color: "#ef4444" }}
                        >
                          <FiTrash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Suggested bills ── */}
      <section>
        <h2 style={{ fontSize: "18px", marginBottom: "6px" }}>Suggested bills</h2>
        <p style={{ color: "var(--gray-600, #6b7280)", fontSize: "13px", marginTop: 0, marginBottom: "16px" }}>
          Detected from your transaction history — monthly debits that recur on a similar date and amount.
        </p>
        {suggestions.length === 0 ? (
          <EmptyState message="No new recurring bills detected." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" }}>
            {suggestions.map((s) => (
              <div
                key={s.matchKey}
                style={{
                  border: "1px dashed var(--border-color, #d1d5db)",
                  borderRadius: "10px",
                  padding: "16px",
                  background: "var(--surface, #fff)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--text-main, #111827)" }}>{s.name}</div>
                <div style={{ fontSize: "20px", fontWeight: 800, margin: "6px 0", color: "var(--text-main, #111827)" }}>
                  {currencyFormatter.format(s.expectedAmount)}
                </div>
                <div style={{ fontSize: "12px", color: "var(--gray-600, #6b7280)", marginBottom: "12px" }}>
                  ~day {s.dueDayOfMonth} · seen {s.occurrenceCount}× · last {fmtDate(s.lastSeenDate)}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="btn primary" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }} onClick={() => confirmSuggestion(s)}>
                    <FiCheck size={14} /> Confirm
                  </button>
                  <button className="btn" style={{ display: "flex", alignItems: "center", gap: "6px" }} onClick={() => dismissSuggestion(s)}>
                    <FiX size={14} /> Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Edit modal ── */}
      {editing && (
        <>
          <div onClick={() => setEditing(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10000 }} />
          <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "360px", background: "#fff", padding: "24px", borderRadius: "8px", zIndex: 10001, boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <h3 style={{ marginTop: 0 }}>Edit bill</h3>
            <label style={editLabel}>Name</label>
            <input className="field-input" style={{ width: "100%", marginBottom: "12px" }} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <label style={editLabel}>Expected amount</label>
            <input className="field-input" type="number" style={{ width: "100%", marginBottom: "12px" }} value={editing.expectedAmount} onChange={(e) => setEditing({ ...editing, expectedAmount: e.target.value })} />
            <label style={editLabel}>Due day of month</label>
            <input className="field-input" type="number" min="1" max="31" style={{ width: "100%", marginBottom: "20px" }} value={editing.dueDayOfMonth} onChange={(e) => setEditing({ ...editing, dueDayOfMonth: e.target.value })} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </>
      )}

      {/* ── Transactions drawer — matches the Transactions page RHS panel ── */}
      <Drawer
        open={!!selectedBill}
        onClose={closeBill}
        title="Bill transactions"
        width={drawerWidth}
        onWidthChange={setDrawerWidth}
        modal={false}
      >
        {selectedBill && (
          <>
            {/* Summary header, like a transaction's amount header */}
            <div style={{ textAlign: "center", padding: "16px 0", borderBottom: "1px solid var(--border-color)", marginBottom: "24px" }}>
              <div style={{ fontSize: "36px", fontWeight: 700, color: "var(--danger)" }}>
                {currencyFormatter.format(selectedBill.expectedAmount)}
              </div>
              <div style={{ color: "var(--gray-600)", marginTop: "8px", fontSize: "16px", fontWeight: 500 }}>
                {selectedBill.name}
              </div>
              <div style={{ color: "var(--text-muted)", marginTop: "4px", fontSize: "13px" }}>
                ~day {selectedBill.dueDayOfMonth} · next due {fmtDate(selectedBill.nextDueDate)}
              </div>
            </div>

            {loadingTxns ? (
              <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "40px" }}>Loading transactions...</div>
            ) : billTxns.length === 0 ? (
              <EmptyState message="No matching transactions found for this bill." />
            ) : (
              <>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", marginBottom: "12px" }}>
                  {billTxns.length} payment{billTxns.length === 1 ? "" : "s"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {billTxns.map((tx, idx) => (
                    <div key={`${tx.bankReference}-${idx}`} className="card" style={{ padding: "14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: "var(--text-main)", fontSize: "14px" }}>
                            {new Date(tx.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </div>
                          <div style={{ fontSize: "13px", color: "var(--gray-600)", marginTop: "3px", wordBreak: "break-word" }}>
                            {tx.description || "-"}
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
                            {tx.mode || "Transfer"}
                          </div>
                        </div>
                        <div className="text-red" style={{ fontWeight: 700, fontSize: "15px", whiteSpace: "nowrap" }}>
                          -{currencyFormatter.format(tx.amount)}
                        </div>
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

const iconBtn = {
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  width: "30px",
  height: "30px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "#374151",
};

const editLabel = { display: "block", fontSize: "12px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" };
