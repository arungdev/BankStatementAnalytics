import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiBell, FiCalendar } from "react-icons/fi";
import api from "../api/client";
import { currencyFormatter } from "../utils/format";

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const dueLabel = (days) => {
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
};

/**
 * Header bell: shows a badge with the number of bills due soon and, on click, a dropdown
 * listing those reminders. Data comes from GET /bills/upcoming (same source as the sidebar badge).
 */
export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/bills/upcoming")
      .then((res) => setItems(res.data || []))
      .catch(() => setItems([]));
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const goToBills = () => {
    setOpen(false);
    navigate("/bills");
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((p) => !p)}
        title="Reminders"
        style={{
          cursor: "pointer",
          position: "relative",
          background: "#f3f4f6",
          border: "1px solid #d1d5db",
          borderRadius: "50%",
          width: "36px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#374151",
          transition: "background-color 0.2s",
          flexShrink: 0,
        }}
        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#e5e7eb")}
        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#f3f4f6")}
      >
        <FiBell size={17} />
        {items.length > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              background: "#ef4444",
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
              border: "2px solid #fff",
            }}
          >
            {items.length}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "44px",
            right: 0,
            width: "320px",
            maxHeight: "420px",
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "10px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
            zIndex: 500,
          }}
        >
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: 700, fontSize: "13px", color: "#111827" }}>
            Reminders
          </div>

          {items.length === 0 ? (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
              No bills due soon.
            </div>
          ) : (
            items.map((b) => (
              <button
                key={b.id}
                onClick={goToBills}
                style={{
                  display: "flex",
                  width: "100%",
                  textAlign: "left",
                  gap: "10px",
                  padding: "12px 16px",
                  borderBottom: "1px solid #f3f4f6",
                  background: "none",
                  border: "none",
                  borderLeft: `3px solid ${b.daysUntilDue <= 2 ? "#ef4444" : "#f59e0b"}`,
                  cursor: "pointer",
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "13px", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {b.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", marginTop: "3px", color: b.daysUntilDue <= 2 ? "#ef4444" : "#b45309", fontWeight: 600 }}>
                    <FiCalendar size={11} /> {dueLabel(b.daysUntilDue)} · {fmtDate(b.nextDueDate)}
                  </div>
                </div>
                <div style={{ fontWeight: 800, fontSize: "13px", color: "#111827", whiteSpace: "nowrap" }}>
                  {currencyFormatter.format(b.expectedAmount)}
                </div>
              </button>
            ))
          )}

          <button
            onClick={goToBills}
            style={{
              display: "block",
              width: "100%",
              padding: "10px 16px",
              background: "none",
              border: "none",
              color: "#4f46e5",
              fontWeight: 700,
              fontSize: "12px",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            View all bills
          </button>
        </div>
      )}
    </div>
  );
}
