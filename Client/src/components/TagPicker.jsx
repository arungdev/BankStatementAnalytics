import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown, FiSearch, FiClock, FiPlus, FiTag, FiSettings } from "react-icons/fi";

/**
 * TagPicker — a custom, theme-aware popover picker to add tags to a transaction.
 * Features:
 * - Search / filter existing tags
 * - "Recently used" tags section at top (with clock icon)
 * - "All tags" section
 * - Inline "+ Create '#{query}'" affordance for new tags
 * - Shortcut link to "Manage tags…"
 * - Portal positioning to avoid drawer / container clipping
 */
export default function TagPicker({
  tags = [],
  recentTags = [],
  selectedTags = [],
  onSelect,
  onCreate,
  onManage,
  disabled = false,
  size = "md",
  placeholder = "+ Add a tag",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState(null);
  const [flipUp, setFlipUp] = useState(false);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);

  // Position the portal popover relative to the trigger
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

  // Close on outside click / Escape
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

  // Focus search on open
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Clean query: strip leading '#' if user typed it
  const cleanQuery = useMemo(() => {
    const q = query.trim();
    return q.startsWith("#") ? q.slice(1).trim() : q;
  }, [query]);

  const selectedLower = useMemo(() => {
    return (selectedTags || []).map((t) => (typeof t === "string" ? t.toLowerCase() : t?.name?.toLowerCase()));
  }, [selectedTags]);

  // Filter recently used tags that are not yet selected on this transaction
  const recentFiltered = useMemo(() => {
    const q = cleanQuery.toLowerCase();
    return recentTags.filter((tag) => {
      const name = typeof tag === "string" ? tag : tag.name;
      if (!name) return false;
      const lower = name.toLowerCase();
      if (selectedLower.includes(lower)) return false;
      return !q || lower.includes(q);
    });
  }, [recentTags, selectedLower, cleanQuery]);

  // Filter all tags that are not yet selected and not already in recentFiltered
  const recentLowerSet = useMemo(() => {
    return new Set(recentFiltered.map((t) => (typeof t === "string" ? t.toLowerCase() : t.name.toLowerCase())));
  }, [recentFiltered]);

  const allFiltered = useMemo(() => {
    const q = cleanQuery.toLowerCase();
    return tags.filter((tag) => {
      const name = typeof tag === "string" ? tag : tag.name;
      if (!name) return false;
      const lower = name.toLowerCase();
      if (selectedLower.includes(lower)) return false;
      if (recentLowerSet.has(lower)) return false;
      return !q || lower.includes(q);
    });
  }, [tags, selectedLower, recentLowerSet, cleanQuery]);

  // Check if query matches any existing tag
  const tagExists = useMemo(() => {
    if (!cleanQuery) return false;
    const q = cleanQuery.toLowerCase();
    return tags.some((t) => {
      const name = typeof t === "string" ? t : t.name;
      return name?.toLowerCase() === q;
    });
  }, [tags, cleanQuery]);

  const canCreate = !!onCreate && cleanQuery.length > 0 && !tagExists;

  const handleSelectTag = (tag) => {
    const name = typeof tag === "string" ? tag : tag.name;
    onSelect?.(name);
    setOpen(false);
  };

  const handleCreateTag = () => {
    if (!cleanQuery) return;
    onCreate?.(cleanQuery);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (recentFiltered.length > 0) {
        handleSelectTag(recentFiltered[0]);
      } else if (allFiltered.length > 0) {
        handleSelectTag(allFiltered[0]);
      } else if (canCreate) {
        handleCreateTag();
      }
    }
  };

  return (
    <>
      <style>{tagPickerCss}</style>
      <button
        type="button"
        ref={triggerRef}
        className={`tagp-trigger tagp-${size} ${open ? "is-open" : ""}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setQuery("");
          setOpen((o) => !o);
        }}
        title="Add tag"
      >
        <span className="tagp-trigger-label">
          <FiPlus size={size === "sm" ? 12 : 14} style={{ marginRight: 4, opacity: 0.7 }} />
          {placeholder}
        </span>
        <FiChevronDown className="tagp-chevron" size={size === "sm" ? 13 : 15} />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={popRef}
            className="tagp-menu"
            style={{
              position: "fixed",
              left: rect.left,
              width: Math.max(rect.width, 240),
              ...(flipUp
                ? { bottom: window.innerHeight - rect.top + 6 }
                : { top: rect.bottom + 6 }),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tagp-search">
              <FiSearch size={14} className="tagp-search-ic" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search or add tag…"
                spellCheck={false}
              />
            </div>

            <div className="tagp-list">
              {/* Recently used tags */}
              {recentFiltered.length > 0 && (
                <div className="tagp-group">
                  <div className="tagp-group-head">
                    <FiClock size={11} /> Recently used
                  </div>
                  <div className="tagp-chips-grid">
                    {recentFiltered.map((tag) => {
                      const name = typeof tag === "string" ? tag : tag.name;
                      return (
                        <button
                          type="button"
                          key={`recent-${name}`}
                          className="tagp-chip-opt"
                          onClick={() => handleSelectTag(tag)}
                        >
                          #{name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* All remaining tags */}
              {allFiltered.length > 0 && (
                <div className="tagp-group">
                  <div className="tagp-group-head">
                    <FiTag size={11} /> All tags
                  </div>
                  {allFiltered.map((tag) => {
                    const name = typeof tag === "string" ? tag : tag.name;
                    return (
                      <button
                        type="button"
                        key={`all-${name}`}
                        className="tagp-opt"
                        onClick={() => handleSelectTag(tag)}
                      >
                        <span className="tagp-opt-label">#{name}</span>
                        {tag.usageCount > 0 && (
                          <span className="tagp-opt-count">{tag.usageCount}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Create new tag option */}
              {canCreate && (
                <button
                  type="button"
                  className="tagp-opt tagp-create"
                  onClick={handleCreateTag}
                >
                  <FiPlus size={14} className="tagp-opt-ic" />
                  <span className="tagp-opt-label">
                    Create <strong>“#{cleanQuery}”</strong>
                  </span>
                </button>
              )}

              {recentFiltered.length === 0 && allFiltered.length === 0 && !canCreate && (
                <div className="tagp-empty">
                  {cleanQuery ? `No tags match “${cleanQuery}”` : "All tags already added"}
                </div>
              )}
            </div>

            {/* Footer with Manage Tags link */}
            {onManage && (
              <div className="tagp-footer">
                <button
                  type="button"
                  className="tagp-manage-btn"
                  onClick={() => {
                    setOpen(false);
                    onManage();
                  }}
                >
                  <FiSettings size={12} /> Manage tags…
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

const tagPickerCss = `
  .tagp-trigger {
    display: inline-flex; align-items: center; gap: 6px;
    width: 100%; max-width: 100%;
    border: 1px solid var(--border-color); border-radius: 8px;
    background: var(--surface); color: var(--text-main);
    cursor: pointer; font-family: inherit; font-weight: 500;
    transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    user-select: none;
  }
  .tagp-trigger:hover:not(:disabled) {
    border-color: var(--primary);
  }
  .tagp-trigger:focus-visible, .tagp-trigger.is-open {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
  }
  .tagp-trigger:disabled {
    opacity: 0.6; cursor: not-allowed;
  }
  .tagp-sm {
    font-size: 12px; padding: 4px 8px; height: 28px;
  }
  .tagp-md {
    font-size: 13px; padding: 6px 10px; height: 34px;
  }
  .tagp-trigger-label {
    flex: 1; text-align: left;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    display: inline-flex; align-items: center;
  }
  .tagp-chevron {
    flex-shrink: 0; color: var(--text-muted);
    transition: transform 0.15s;
  }
  .tagp-trigger.is-open .tagp-chevron {
    transform: rotate(180deg);
  }

  .tagp-menu {
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    box-shadow: 0 10px 28px -4px rgba(0, 0, 0, 0.18), 0 4px 12px -2px rgba(0, 0, 0, 0.08);
    display: flex; flex-direction: column;
    max-height: 360px;
    z-index: 10000;
    overflow: hidden;
    animation: tagpFade 0.12s ease-out;
  }
  @keyframes tagpFade {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .tagp-search {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-color);
    background: var(--surface-2, var(--surface));
  }
  .tagp-search-ic {
    color: var(--text-muted); flex-shrink: 0;
  }
  .tagp-search input {
    width: 100%; border: none; background: transparent;
    color: var(--text-main); font-size: 12px; font-family: inherit;
    outline: none;
  }

  .tagp-list {
    overflow-y: auto; padding: 6px;
    display: flex; flex-direction: column; gap: 4px;
    max-height: 280px;
  }

  .tagp-group {
    display: flex; flex-direction: column; gap: 2px;
  }
  .tagp-group + .tagp-group {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border-color);
  }
  .tagp-group-head {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--text-muted);
    padding: 4px 8px 2px;
    display: flex; align-items: center; gap: 5px;
  }

  .tagp-chips-grid {
    display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 4px 4px;
  }
  .tagp-chip-opt {
    display: inline-flex; align-items: center; gap: 4px;
    border: 1px solid var(--border-color);
    background: var(--primary-light, rgba(99, 102, 241, 0.08));
    color: var(--primary);
    font-size: 11px; font-weight: 600; font-family: inherit;
    padding: 3px 8px; border-radius: 999px;
    cursor: pointer; transition: all 0.12s;
  }
  .tagp-chip-opt:hover {
    background: var(--primary);
    color: #fff;
    border-color: var(--primary);
  }

  .tagp-opt {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; border: none; background: transparent;
    color: var(--text-main); font-size: 12px; font-family: inherit;
    padding: 6px 8px; border-radius: 6px;
    cursor: pointer; text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .tagp-opt:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.05));
    color: var(--primary);
  }
  .tagp-opt-label {
    flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-weight: 500;
  }
  .tagp-opt-count {
    font-size: 10px; color: var(--text-muted);
    background: var(--surface-2, rgba(0,0,0,0.05));
    padding: 1px 5px; border-radius: 10px;
  }

  .tagp-create {
    color: var(--primary);
    font-weight: 600;
    gap: 6px;
    justify-content: flex-start;
    padding: 7px 8px;
    border-top: 1px dashed var(--border-color);
    margin-top: 4px;
  }
  .tagp-create:hover {
    background: var(--primary-light, rgba(99, 102, 241, 0.08));
  }
  .tagp-opt-ic {
    flex-shrink: 0;
  }

  .tagp-empty {
    padding: 12px 8px; text-align: center;
    font-size: 12px; color: var(--text-muted);
  }

  .tagp-footer {
    border-top: 1px solid var(--border-color);
    background: var(--surface-2, var(--surface));
    padding: 4px 6px;
  }
  .tagp-manage-btn {
    width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 5px; border: none; background: transparent;
    color: var(--text-muted); font-size: 11px; font-weight: 500; font-family: inherit;
    border-radius: 6px; cursor: pointer; transition: color 0.12s, background 0.12s;
  }
  .tagp-manage-btn:hover {
    color: var(--primary);
    background: var(--hover-bg, rgba(0,0,0,0.04));
  }
`;
