import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiCheck, FiChevronDown, FiSearch, FiClock, FiSlash, FiPlus } from "react-icons/fi";

/*
 * CategoryPicker — a custom, theme-aware replacement for the native <select>
 * used to assign a category/sub-category to a transaction. Unlike a native
 * select the open menu is fully styleable: it gets a search box, grouped
 * headers, a "Frequently used" section, hover states and a check on the
 * current value. Positioned via a body portal so table-row overflow never
 * clips it.
 *
 * onChange receives the raw value string (a sub-category name, a top-level
 * category name, or '' for Uncategorized) — the same contract the old
 * <select> onChange had, so callers keep resolving category vs sub-category.
 *
 * onCreate (optional) enables inline category creation: when the user types a
 * name that doesn't match any existing category/sub-category, a "Create '…'"
 * button appears. The caller receives the trimmed name and is responsible for
 * persisting the new category and selecting it.
 */
export default function CategoryPicker({
  value = "",
  categories = [],
  frequentCategories = [],
  onChange,
  onCreate,
  disabled = false,
  size = "sm",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState(null);
  const [flipUp, setFlipUp] = useState(false);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);

  const hasValue = !!value;

  // Position the portal popover relative to the trigger; flip above when the
  // menu would overflow the viewport bottom.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const measure = () => {
      const r = triggerRef.current.getBoundingClientRect();
      const menuH = Math.min(360, window.innerHeight - 24);
      setFlipUp(r.bottom + menuH > window.innerHeight && r.top > menuH);
      setRect({ top: r.top, bottom: r.bottom, left: r.left, width: r.width });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (
        !popRef.current?.contains(e.target) &&
        !triggerRef.current?.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const id = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Flatten to searchable rows, preserving grouping for display.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s) => !q || s.toLowerCase().includes(q);

    const out = [];
    const freq = frequentCategories.filter(match);
    if (freq.length) out.push({ key: "__freq", label: "Frequently used", icon: true, items: freq });

    for (const cat of categories) {
      if (cat.subCategories?.length > 0) {
        const subs = cat.subCategories.filter(match);
        // Keep the group if its header matches even when no sub does.
        if (subs.length) out.push({ key: cat.id, label: cat.name, items: subs });
        else if (match(cat.name)) out.push({ key: cat.id, label: cat.name, items: cat.subCategories });
      } else if (match(cat.name)) {
        out.push({ key: `cat-${cat.id}`, label: null, items: [cat.name] });
      }
    }
    return out;
  }, [categories, frequentCategories, query]);

  const select = (val) => {
    onChange?.(val);
    setOpen(false);
  };

  // Inline-create affordance: offer to create the typed name unless it already
  // exists (as a category, a sub-category, or the "Uncategorized" sentinel).
  const trimmedQuery = query.trim();
  const nameExists = useMemo(() => {
    if (!trimmedQuery) return false;
    const q = trimmedQuery.toLowerCase();
    if (q === "uncategorized") return true;
    return categories.some(
      (cat) =>
        cat.name.toLowerCase() === q ||
        cat.subCategories?.some((s) => s.toLowerCase() === q)
    );
  }, [categories, trimmedQuery]);
  const canCreate = !!onCreate && trimmedQuery.length > 0 && !nameExists;

  const create = () => {
    onCreate?.(trimmedQuery);
    setOpen(false);
  };

  const label = hasValue ? value : "Uncategorized";

  return (
    <>
      <style>{catPickerCss}</style>
      <button
        type="button"
        ref={triggerRef}
        className={`catp-trigger catp-${size} ${hasValue ? "" : "is-empty"} ${open ? "is-open" : ""}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setQuery("");
          setOpen((o) => !o);
        }}
      >
        <span className="catp-trigger-label">{label}</span>
        <FiChevronDown className="catp-chevron" size={size === "sm" ? 13 : 15} />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={popRef}
            className="catp-menu"
            style={{
              position: "fixed",
              left: rect.left,
              width: Math.max(rect.width, 248),
              ...(flipUp
                ? { bottom: window.innerHeight - rect.top + 6 }
                : { top: rect.bottom + 6 }),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="catp-search">
              <FiSearch size={14} className="catp-search-ic" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search categories…"
                spellCheck={false}
              />
            </div>

            <div className="catp-list">
              <button
                type="button"
                className={`catp-opt catp-uncat ${!hasValue ? "is-active" : ""}`}
                onClick={() => select("")}
              >
                <FiSlash size={13} className="catp-opt-ic" />
                <span className="catp-opt-label">Uncategorized</span>
                {!hasValue && <FiCheck size={14} className="catp-opt-check" />}
              </button>

              {groups.map((g) => (
                <div key={g.key} className="catp-group">
                  {g.label && (
                    <div className="catp-group-head">
                      {g.icon && <FiClock size={11} />}
                      {g.label}
                    </div>
                  )}
                  {g.items.map((item) => {
                    const active = item === value;
                    return (
                      <button
                        type="button"
                        key={`${g.key}-${item}`}
                        className={`catp-opt ${active ? "is-active" : ""}`}
                        onClick={() => select(item)}
                      >
                        <span className="catp-opt-label">{item}</span>
                        {active && <FiCheck size={14} className="catp-opt-check" />}
                      </button>
                    );
                  })}
                </div>
              ))}

              {groups.length === 0 && !canCreate && (
                <div className="catp-empty">No categories match “{query}”</div>
              )}

              {canCreate && (
                <button
                  type="button"
                  className="catp-opt catp-create"
                  onClick={create}
                >
                  <FiPlus size={14} className="catp-opt-ic" />
                  <span className="catp-opt-label">
                    Create “{trimmedQuery}”
                  </span>
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

const catPickerCss = `
  .catp-trigger {
    display: inline-flex; align-items: center; gap: 6px;
    width: 100%; max-width: 100%;
    border: 1px solid var(--border-color); border-radius: 8px;
    background: var(--surface); color: var(--text-main);
    font-family: inherit; font-weight: 600; cursor: pointer;
    text-align: left; line-height: 1.2;
    transition: border-color .15s, box-shadow .15s, background .15s;
  }
  .catp-trigger.catp-sm { padding: 5px 8px; font-size: 12px; }
  .catp-trigger.catp-md { padding: 9px 12px; font-size: 14px; }
  .catp-trigger:hover:not(:disabled) { border-color: var(--primary); }
  .catp-trigger.is-open {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-light);
  }
  .catp-trigger.is-empty { color: var(--text-faint); font-weight: 500; }
  .catp-trigger:disabled { opacity: .6; cursor: default; }
  .catp-trigger-label {
    flex: 1; min-width: 0; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .catp-chevron { flex-shrink: 0; opacity: .55; transition: transform .18s; }
  .catp-trigger.is-open .catp-chevron { transform: rotate(180deg); opacity: .9; }

  .catp-menu {
    z-index: 4000;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
    display: flex; flex-direction: column;
    max-height: min(360px, calc(100vh - 24px));
    overflow: hidden;
    animation: catp-in .12s ease;
  }
  @keyframes catp-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .catp-search {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 12px; border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .catp-search-ic { color: var(--text-faint); flex-shrink: 0; }
  .catp-search input {
    flex: 1; border: none; outline: none; background: transparent;
    font-family: inherit; font-size: 13px; color: var(--text-main);
  }
  .catp-search input::placeholder { color: var(--text-faint); }

  .catp-list { overflow-y: auto; padding: 6px; }

  .catp-group { padding-top: 2px; }
  .catp-group + .catp-group { margin-top: 2px; }
  .catp-group-head {
    display: flex; align-items: center; gap: 5px;
    padding: 8px 10px 4px; font-size: 10.5px; font-weight: 700;
    letter-spacing: .06em; text-transform: uppercase;
    color: var(--text-faint);
  }

  .catp-opt {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 7px 10px; border: none; border-radius: 7px;
    background: transparent; color: var(--text-main);
    font-family: inherit; font-size: 13px; font-weight: 500;
    text-align: left; cursor: pointer; transition: background .1s;
  }
  .catp-opt:hover { background: var(--surface-2); }
  .catp-opt.is-active { background: var(--primary-light); color: var(--primary); font-weight: 600; }
  .catp-opt-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .catp-opt-ic { flex-shrink: 0; opacity: .55; }
  .catp-opt-check { flex-shrink: 0; color: var(--primary); }

  .catp-create { color: var(--primary); font-weight: 600; }
  .catp-create:hover { background: var(--primary-light); }
  .catp-create .catp-opt-ic { opacity: 1; color: var(--primary); }
  .catp-group + .catp-create, .catp-uncat + .catp-create {
    border-top: 1px solid var(--border-subtle); margin-top: 4px; padding-top: 10px;
  }

  .catp-uncat { color: var(--text-muted); }
  .catp-group + .catp-group, .catp-uncat + .catp-group { border-top: 1px solid var(--border-subtle); margin-top: 4px; padding-top: 6px; }

  .catp-empty { padding: 18px 12px; text-align: center; font-size: 13px; color: var(--text-faint); }
`;
