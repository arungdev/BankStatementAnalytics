import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiBell, FiCalendar, FiCheck, FiRotateCcw, FiAlertCircle } from "react-icons/fi";
import api from "../api/client";
import { getAutoImports } from "../api/statements";
import { useAccount } from "../context/useAccount";
import { currencyFormatter, maskName } from "../utils/format";
import Drawer from "./ui/Drawer";
import EmptyState from "./ui/EmptyState";

const READ_KEY = "bills.readReminders";

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const fmtDateTime = (d) =>
  new Date(d).toLocaleString("en-IN",
    { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const dueLabel = (days) => {
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
};

// A reminder is identified per bill + due-cycle so a new month's bill is "unread" again.
const reminderKey = (b) => {
  const c = new Date(b.nextDueDate);
  return `${b.id}.${c.getFullYear()}-${c.getMonth() + 1}`;
};

// Failed imports use their attempt timestamp, which the retry endpoint refreshes,
// so a retry that fails again surfaces as unread rather than staying dismissed.
const notificationKey = (n) =>
  n.kind === "import" ? `import.${n.id}.${n.createdAt}` : reminderKey(n);

const loadReadSet = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

const saveReadSet = (set) => {
  localStorage.setItem(READ_KEY, JSON.stringify([...set]));
};

/**
 * Header bell: opens a right-hand-side panel listing bills due soon and statement
 * imports that failed. Each notification can be marked read/unread (persisted in
 * localStorage); the badge counts only unread ones. The panel is docked (non-modal)
 * like the other RHS drawers — onDockChange reports the occupied width so the layout
 * can shift the page content beside it.
 */
export default function NotificationBell({ onDockChange, accounts = [] }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(420);
  const [readSet, setReadSet] = useState(loadReadSet);
  const navigate = useNavigate();
  const { setSelectedAccountId } = useAccount();

  useEffect(() => {
    onDockChange?.(open ? width : 0);
  }, [open, width, onDockChange]);

  // Two kinds of notification, tagged by `kind`: due-date reminders (recurring
  // bills plus unpaid credit-card statements, ids prefixed "cc-") and statement
  // imports that failed. Failed imports need the user to act, so they lead.
  const load = () =>
    Promise.all([
      api.get("/bills/upcoming").then((res) => res.data || []).catch(() => []),
      api.get("/cards/upcoming").then((res) => res.data || []).catch(() => []),
      getAutoImports()
        .then((res) => (res.data || []).filter((h) => h.status === "Failed"))
        .catch(() => []),
    ]).then(([bills, cards, fails]) => {
      const due = [...bills, ...cards]
        .map((b) => ({ ...b, kind: "bill" }))
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
      const failed = fails
        .map((f) => ({ ...f, kind: "import" }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setItems([...failed, ...due]);
    });

  useEffect(() => {
    load();
  }, []);

  const openPanel = () => {
    load(); // refresh on open
    setOpen(true);
  };

  const goToBills = () => {
    setOpen(false);
    navigate("/bills");
  };

  // Failed imports open the Transactions upload history (where "Try again" lives)
  // on their own account; card-bill reminders live on the Overview page's credit
  // card panel, not in Bills.
  const goToItem = (n) => {
    setOpen(false);
    if (n.kind === "import") {
      // Transactions shows one account at a time — switch to the failed file's
      // account first, or its history drawer would open on a different one.
      if (n.accountId != null) setSelectedAccountId(n.accountId);
      navigate("/transactions?uploads=1");
      return;
    }
    navigate(String(n.id).startsWith("cc-") ? "/" : "/bills");
  };

  const accountLabel = (accountId) => {
    const acc = accounts.find((a) => a.id === accountId);
    return acc ? (acc.accountHolderName || acc.bankName) : null;
  };

  const isRead = (n) => readSet.has(notificationKey(n));

  const setRead = (n, read) => {
    setReadSet((prev) => {
      const next = new Set(prev);
      if (read) next.add(notificationKey(n));
      else next.delete(notificationKey(n));
      saveReadSet(next);
      return next;
    });
  };

  const markAllRead = () => {
    setReadSet((prev) => {
      const next = new Set(prev);
      items.forEach((n) => next.add(notificationKey(n)));
      saveReadSet(next);
      return next;
    });
  };

  const unreadCount = items.filter((n) => !isRead(n)).length;

  return (
    <>
      <button
        onClick={openPanel}
        title="Reminders"
        className="btn icon"
        style={{
          position: "relative",
          borderRadius: "50%",
          width: "36px",
          height: "36px",
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        <FiBell size={17} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              background: "var(--danger)",
              color: "#fff",
              borderRadius: "999px",
              fontSize: "10px",
              fontWeight: 700,
              minWidth: "16px",
              height: "16px",
              padding: "0 4px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid var(--surface)",
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Reminders"
        width={width}
        onWidthChange={setWidth}
        modal={false}
      >
        {items.length === 0 ? (
          <EmptyState message="You're all caught up — no bills due soon and no import problems." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>
                {unreadCount} unread · {items.length} total
              </span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  style={{ background: "none", border: "none", color: "var(--primary)", fontWeight: 700, fontSize: "12px", cursor: "pointer" }}
                >
                  Mark all as read
                </button>
              )}
            </div>

            {items.map((n) => {
              const read = isRead(n);
              const isImport = n.kind === "import";
              const accent = read
                ? "var(--border-color)"
                : isImport || n.daysUntilDue <= 2 ? "var(--danger)" : "var(--warning)";
              return (
                <div
                  key={notificationKey(n)}
                  style={{
                    display: "flex",
                    gap: "12px",
                    padding: "14px",
                    borderRadius: "10px",
                    border: "1px solid var(--border-color)",
                    borderLeft: `4px solid ${accent}`,
                    background: read ? "var(--surface-2)" : "var(--surface)",
                    opacity: read ? 0.7 : 1,
                  }}
                >
                  {/* Unread dot */}
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      marginTop: "6px",
                      flexShrink: 0,
                      background: read ? "transparent" : "var(--primary)",
                    }}
                  />

                  {/* Clickable body → upload history for imports, bills page
                      (or Overview for card bills) for due-date reminders */}
                  <button
                    onClick={() => goToItem(n)}
                    title={isImport ? "Open upload history to retry" : "View bill"}
                    style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    {isImport ? (
                      <>
                        <div style={{ fontWeight: read ? 500 : 700, fontSize: "14px", color: "var(--text-main)", wordBreak: "break-all" }}>
                          {n.fileName}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", marginTop: "4px", color: read ? "var(--text-muted)" : "var(--danger)", fontWeight: 600 }}>
                          <FiAlertCircle size={12} /> Import failed
                          {accountLabel(n.accountId) && <> · {maskName(accountLabel(n.accountId))}</>}
                        </div>
                        {n.error && (
                          <div style={{ fontSize: "12px", marginTop: "6px", color: "var(--text-muted)" }}>
                            {n.error}
                          </div>
                        )}
                        <div style={{ fontSize: "11px", marginTop: "6px", color: "var(--text-faint)" }}>
                          {fmtDateTime(n.createdAt)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontWeight: read ? 500 : 700, fontSize: "14px", color: "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {maskName(n.name)}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", marginTop: "4px", color: n.daysUntilDue <= 2 && !read ? "var(--danger)" : "var(--warning)", fontWeight: 600 }}>
                          <FiCalendar size={12} /> {dueLabel(n.daysUntilDue)} · {fmtDate(n.nextDueDate)}
                        </div>
                      </>
                    )}
                  </button>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                    {!isImport && (
                      <div style={{ fontWeight: 800, fontSize: "15px", color: "var(--text-main)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                        {currencyFormatter.format(n.expectedAmount)}
                      </div>
                    )}
                    <button
                      onClick={() => setRead(n, !read)}
                      title={read ? "Mark as unread" : "Mark as read"}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        background: "none",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        padding: "3px 8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {read ? <><FiRotateCcw size={11} /> Unread</> : <><FiCheck size={11} /> Read</>}
                    </button>
                  </div>
                </div>
              );
            })}

            {items.some((n) => n.kind === "bill") && (
            <button
              onClick={goToBills}
              style={{
                marginTop: "4px",
                padding: "10px",
                background: "none",
                border: "none",
                color: "var(--primary)",
                fontWeight: 700,
                fontSize: "13px",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              View all bills
            </button>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
