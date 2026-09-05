import { useState, useRef, useEffect } from "react";
import { FiChevronDown } from "react-icons/fi";
import "../components/filter-chip.css";

/**
 * AmountFilterChip — a filter-chip trigger with a popover for min/max amount inputs.
 *
 * Props:
 *   minAmount    — current minimum (number | null)
 *   maxAmount    — current maximum (number | null)
 *   onChange     — ({ min, max }) => void — called when user applies or clears
 *   currencySymbol — defaults to '₹'
 */
export default function AmountFilterChip({ minAmount, maxAmount, onChange, currencySymbol = "₹" }) {
  const [open, setOpen] = useState(false);
  // Local draft values — initialised from props each time the popover opens.
  const [draftMin, setDraftMin] = useState("");
  const [draftMax, setDraftMax] = useState("");
  const wrapperRef = useRef(null);

  // Sync drafts when popover opens.
  useEffect(() => {
    if (open) {
      setDraftMin(minAmount != null ? String(minAmount) : "");
      setDraftMax(maxAmount != null ? String(maxAmount) : "");
    }
  }, [open, minAmount, maxAmount]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const hasFilter = minAmount != null || maxAmount != null;

  const formatLabel = () => {
    if (minAmount != null && maxAmount != null)
      return `${currencySymbol}${minAmount.toLocaleString("en-IN")} – ${currencySymbol}${maxAmount.toLocaleString("en-IN")}`;
    if (minAmount != null) return `≥ ${currencySymbol}${minAmount.toLocaleString("en-IN")}`;
    if (maxAmount != null) return `≤ ${currencySymbol}${maxAmount.toLocaleString("en-IN")}`;
    return "All";
  };

  const handleApply = () => {
    const min = draftMin !== "" ? Number(draftMin) : null;
    const max = draftMax !== "" ? Number(draftMax) : null;
    // Ignore invalid / NaN entries.
    onChange({
      min: min != null && !isNaN(min) ? min : null,
      max: max != null && !isNaN(max) ? max : null,
    });
    setOpen(false);
  };

  const handleClear = () => {
    onChange({ min: null, max: null });
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleApply();
    if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        className={`filter-chip${open ? " open" : ""}${hasFilter ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Filter by amount range"
        style={hasFilter ? { borderColor: "var(--primary)", background: "var(--primary-light)" } : undefined}
      >
        <span className="filter-chip-prefix">Amount</span>
        {formatLabel()}
        <FiChevronDown size={14} className="filter-chip-caret" />
      </button>

      {open && (
        <div className="filter-chip-menu" style={{ padding: "12px", minWidth: "220px" }}>
          <div style={{ marginBottom: "10px" }}>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--text-faint)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "4px",
              }}
            >
              Min ({currencySymbol})
            </label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="No minimum"
              value={draftMin}
              onChange={(e) => setDraftMin(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              style={{
                width: "100%",
                padding: "7px 10px",
                border: "1px solid var(--border-color)",
                borderRadius: "7px",
                background: "var(--surface)",
                color: "var(--text-main)",
                fontFamily: "inherit",
                fontSize: "13px",
                fontWeight: 600,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--text-faint)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "4px",
              }}
            >
              Max ({currencySymbol})
            </label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="No maximum"
              value={draftMax}
              onChange={(e) => setDraftMax(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{
                width: "100%",
                padding: "7px 10px",
                border: "1px solid var(--border-color)",
                borderRadius: "7px",
                background: "var(--surface)",
                color: "var(--text-main)",
                fontFamily: "inherit",
                fontSize: "13px",
                fontWeight: 600,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handleApply}
              style={{
                flex: 1,
                padding: "7px 0",
                border: "none",
                borderRadius: "7px",
                background: "var(--primary)",
                color: "#fff",
                fontFamily: "inherit",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Apply
            </button>
            <button
              onClick={handleClear}
              style={{
                flex: 1,
                padding: "7px 0",
                border: "1px solid var(--border-color)",
                borderRadius: "7px",
                background: "var(--surface)",
                color: "var(--text-main)",
                fontFamily: "inherit",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
