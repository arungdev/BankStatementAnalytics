import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import api from "../api/client";
import usePersistedState from "../hooks/usePersistedState";
import { useAccount } from "../context/useAccount";
import { ALL_ACCOUNTS } from "../components/AccountFilter";
import { useAuth } from "../context/useAuth";
import { FiDownload, FiUploadCloud, FiFileText, FiRotateCcw } from "react-icons/fi";
import UploadStatement from "./UploadStatement";
import { getUploads, revertStatement } from "../api/statements";
// ── Same DateRangePicker component used on Insights/Trends ──────────────
import DateRangePicker from "../components/Daterangepicker";
import { FilterGroup } from "../components/PageHeader";
import Pagination from "../components/Pagination";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import Drawer from "../components/ui/Drawer";
import Avatar from "../components/ui/Avatar";
import { currencyFormatter } from "../utils/format";

/* ─── Design tokens — aligned with Overview / Merchants / Insights ───────── */
const T = {
  indigo:     '#4f46e5',
  indigoDim:  '#eef2ff',
  surface:    '#ffffff',
  bg:         '#f3f4f6',
  border:     '#e5e7eb',
  borderSub:  '#f0f1f3',
  text:       '#111827',
  muted:      '#6b7280',
  faint:      '#9ca3af',
  red:        '#ef4444',
  green:      '#10b981',
  blue:       '#2563eb',
  blueDim:    '#eff6ff',
};

/* ─── TransactionsFilters — rendered in Layout's PageHeader filter row ──── */
export function TransactionsFilters({ dateRange, setDateRange }) {
  return (
    <FilterGroup label="Period" style={{ position: 'relative', zIndex: 500 }}>
      <DateRangePicker
        value={dateRange}
        onChange={setDateRange}
        showTime={false}
        align="left"
        placeholder="All Time"
      />
    </FilterGroup>
  );
}

export default function Transactions() {
  const { isAdmin } = useAuth();
  const { selectedAccountId, selectedAccount } = useAccount();
  console.log('selectedAccount:', selectedAccount);

  // ── Date filter now lives in Layout, shared with the header row ───────
  const {
    accounts = [],
    transactionsRange: dateRange = { start: null, end: null, preset: 'ALL' },
  } = useOutletContext() ?? {};

  // Transactions are viewed one account at a time. "All accounts" isn't offered
  // here, so fall back to the first account rather than a dead-end state.
  const effectiveAccountId =
    selectedAccountId === ALL_ACCOUNTS ? (accounts[0]?.id ?? null) : selectedAccountId;

  const [tx, setTx] = useState([]);
  const [loading, setLoading] = useState(!effectiveAccountId);
  const [totalTransactions, setTotalTransactions] = useState(0);

  // Categories from API
  const [categories, setCategories] = useState([]);

  // Pagination state (itemsPerPage persists across reloads; page resets to 1)
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = usePersistedState('transactionsPerPage', 10);

  // Sidebar state
  const [selectedTx, setSelectedTx] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(450);
  const [tags, setTags] = useState([]);

  // Upload modal + a bump to force the transaction list to re-fetch after an upload
  const [showUpload, setShowUpload] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Upload-history RHS drawer
  const [uploads, setUploads] = useState([]);
  const [showUploadHistory, setShowUploadHistory] = useState(false);
  const [loadingUploads, setLoadingUploads] = useState(false);

  const openUploadHistory = () => {
    setSelectedTx(null);            // only one RHS panel at a time
    setShowUploadHistory(true);
    setLoadingUploads(true);
    getUploads()
      .then(res => {
        const forAccount = (res.data || [])
          .filter(u => String(u.accountId) === String(effectiveAccountId))
          .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        setUploads(forAccount);
      })
      .catch(() => setUploads([]))
      .finally(() => setLoadingUploads(false));
  };

  const handleRevert = async (upload) => {
    if (!upload?.id) return;
    if (!window.confirm(`Revert "${upload.fileName}"? Its imported transactions will be removed.`)) return;
    try {
      await revertStatement(upload.id);
      setUploads(prev => prev.filter(u => u.id !== upload.id));
      setRefreshKey(k => k + 1);
    } catch {
      alert("Could not revert this upload. Please try again.");
    }
  };

  useEffect(() => {
    api.get('/categories')
      .then(res => setCategories(res.data || []))
      .catch(err => console.error("Failed to load categories", err));

    api.get('/tags')
      .then(res => setTags(res.data || []))
      .catch(err => console.error("Failed to load tags", err));
  }, []);

  // ── Helper: Date → "yyyy-MM-dd" string in local time ──────────────────
  const toLocalDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ── Date range now changes from the header — reset to page 1 when it does ──
  useEffect(() => {
    setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.start, dateRange.end]);

  useEffect(() => {
    if (!effectiveAccountId) {
      setLoading(false);
      setTx([]);
      setTotalTransactions(0);
      return;
    }
    setLoading(true);

    const { start: startDate, end: endDate } = dateRange;

    const params = new URLSearchParams({ page: currentPage, pageSize: itemsPerPage });

    if (startDate) params.append('startDate', toLocalDate(startDate));
    if (endDate)   params.append('endDate',   toLocalDate(endDate));

    api.get(`/statements/${effectiveAccountId}?${params.toString()}`)
      .then(res => {
        let allTx = [];
        let isServerPaginated = false;

        if (Array.isArray(res.data)) {
          allTx = res.data;
        } else if (res.data) {
          allTx = res.data.transactions || [];
          if (typeof res.data.totalCount === 'number') {
            isServerPaginated = true;
          }
        }

        if (!isServerPaginated) {
          // Client-side date filtering
          allTx = allTx.filter(t => {
            if (!startDate && !endDate) return true;
            const txDate = new Date(t.transactionDate);
            if (startDate) {
              const s = new Date(startDate); s.setHours(0, 0, 0, 0);
              if (txDate < s) return false;
            }
            if (endDate) {
              const e = new Date(endDate); e.setHours(23, 59, 59, 999);
              if (txDate > e) return false;
            }
            return true;
          });

          setTotalTransactions(allTx.length);
          const startIdx = (currentPage - 1) * itemsPerPage;
          setTx(allTx.slice(startIdx, startIdx + itemsPerPage));
        } else {
          setTx(allTx);
          setTotalTransactions(res.data.totalCount);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [effectiveAccountId, currentPage, dateRange, itemsPerPage, refreshKey]);

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <div className="loader-text">Loading transactions...</div>
      </div>
    );
  }

  if (!effectiveAccountId) {
    return (
      <EmptyState
        title="No account selected"
        message="Add or select an account to see transactions."
      />
    );
  }

  // Pagination logic
  const totalPages = Math.ceil(totalTransactions / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;

  const handleCategoryChange = (t, selectedValue) => {
    const previousCategory = t.category;
    const previousSubCategory = t.subCategory;
    console.log('Transaction object:', JSON.stringify(t, null, 2));
    let resolvedCategory = selectedValue;
    let resolvedSubCategory = null;

    if (selectedValue) {
      for (const cat of categories) {
        if (cat.subCategories?.includes(selectedValue)) {
          resolvedCategory = cat.name;
          resolvedSubCategory = selectedValue;
          break;
        }
      }
    } else {
      resolvedCategory = null;
      resolvedSubCategory = null;
    }

    const displayLabel = resolvedSubCategory || resolvedCategory || '';

    setTx(prev => prev.map(item =>
      item.id === t.id
        ? { ...item, category: displayLabel, subCategory: resolvedSubCategory }
        : item
    ));

    setSelectedTx(prev =>
      prev && prev.id === t.id
        ? { ...prev, category: displayLabel, subCategory: resolvedSubCategory }
        : prev
    );

    api.patch(`/transactions/category`, {
      AccountId: effectiveAccountId,
      BankReference: t.id,
      BankType: t.bankType,
      Category: resolvedCategory,
      SubCategory: resolvedSubCategory
    }).catch(err => {
      console.error("Failed to update category", err);
      alert("Failed to update category. Please try again.");
      setTx(prev => prev.map(item =>
        item.id === t.id
          ? { ...item, category: previousCategory, subCategory: previousSubCategory }
          : item
      ));
      setSelectedTx(prev =>
        prev && prev.id === t.id
          ? { ...prev, category: previousCategory, subCategory: previousSubCategory }
          : prev
      );
    });
  };

  const handleTagChange = (updatedTags) => {
    const previousTags = selectedTx.tags;

    setSelectedTx(prev => ({ ...prev, tags: updatedTags }));
    setTx(prev => prev.map(item =>
      item.id === selectedTx.id ? { ...item, tags: updatedTags } : item
    ));

    api.patch(`/transactions/tags`, {
      AccountId: effectiveAccountId,
      BankReference: selectedTx.id,
      BankType: selectedTx.bankType,
      Tags: updatedTags
    }).catch(err => {
      console.error("Failed to update tags", err);
      alert("Failed to update tags. Please try again.");
      setSelectedTx(prev => ({ ...prev, tags: previousTags }));
      setTx(prev => prev.map(item =>
        item.id === selectedTx.id ? { ...item, tags: previousTags } : item
      ));
    });
  };

  const handleRemoveTag = (tagToRemove) => {
    handleTagChange((selectedTx.tags || []).filter(t => t !== tagToRemove));
  };

  const handleNoteChange = (newNote) => {
    const trimmed = (newNote ?? '').trim();
    const previousNote = selectedTx.note;
    if (trimmed === (previousNote || '')) return; // nothing changed

    setSelectedTx(prev => ({ ...prev, note: trimmed }));
    setTx(prev => prev.map(item =>
      item.id === selectedTx.id ? { ...item, note: trimmed } : item
    ));

    api.patch(`/transactions/note`, {
      AccountId: effectiveAccountId,
      BankReference: selectedTx.id,
      BankType: selectedTx.bankType,
      Note: trimmed
    }).catch(err => {
      console.error("Failed to update note", err);
      alert("Failed to update note. Please try again.");
      setSelectedTx(prev => ({ ...prev, note: previousNote }));
      setTx(prev => prev.map(item =>
        item.id === selectedTx.id ? { ...item, note: previousNote } : item
      ));
    });
  };

  const handleExportCSV = () => {
    const { start: startDate, end: endDate } = dateRange;
    const params = new URLSearchParams({ pageSize: 0 });
    if (startDate) params.append('startDate', toLocalDate(startDate));
    if (endDate)   params.append('endDate',   toLocalDate(endDate));

    api.get(`/statements/${effectiveAccountId}?${params.toString()}`)
      .then(res => {
        let allTx = Array.isArray(res.data) ? res.data : (res.data.transactions || []);
        if (allTx.length === 0) return alert("No transactions to export.");

        const headers = ["Date", "Merchant", "Category", "Description", "Debit", "Credit", "Balance", "Mode", "UPI Reference"];
        const csvRows = [headers.join(",")];

        allTx.forEach(t => {
          const row = [
            new Date(t.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
            `"${(t.merchant || '-').replace(/"/g, '""')}"`,
            `"${(t.category || '-').replace(/"/g, '""')}"`,
            `"${(t.description || '-').replace(/"/g, '""')}"`,
            t.debit || 0,
            t.credit || 0,
            t.balance || 0,
            `"${t.mode || ''}"`,
            `"${t.upiReference || ''}"`
          ];
          csvRows.push(row.join(","));
        });

        const blob = new Blob([csvRows.join("\n")], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `Transactions_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      })
      .catch(err => {
        console.error("Export failed", err);
        alert("Failed to export transactions.");
      });
  };

  const renderCategoryOptions = () => (
    <>
      <option value="">Uncategorized</option>
      {categories.map(cat =>
        cat.subCategories?.length > 0 ? (
          <optgroup key={cat.id} label={cat.name}>
            {cat.subCategories.map(sub => (
              <option key={sub} value={sub}>{sub}</option>
            ))}
          </optgroup>
        ) : (
          <option key={cat.id} value={cat.name}>{cat.name}</option>
        )
      )}
    </>
  );

  return (
    <div style={{ marginRight: (selectedTx || showUploadHistory) ? sidebarWidth : 0, transition: 'margin-right 0.2s ease' }}>
      <style>{`
        .tx-row {
          display: grid;
          grid-template-columns: 76px minmax(0,1fr) 168px 128px;
          align-items: center;
          gap: 16px;
          padding: 13px 20px;
          border-bottom: 1px solid ${T.borderSub};
          cursor: pointer;
          transition: background 0.12s;
        }
        .tx-row:hover { background: ${T.bg}; }
        .tx-row.selected { background: ${T.indigoDim}; }
        .tx-row:last-child { border-bottom: none; }
        .tx-head {
          display: grid;
          grid-template-columns: 76px minmax(0,1fr) 168px 128px;
          gap: 16px;
          padding: 12px 20px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: ${T.faint};
          border-bottom: 1px solid ${T.border};
          background: ${T.bg};
        }
        .tx-cat-select {
          width: 100%; max-width: 100%;
          padding: 5px 8px; font-size: 12px; font-weight: 600;
          border: 1px solid ${T.border}; border-radius: 8px;
          background: ${T.surface}; font-family: inherit;
          outline: none; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s;
        }
        .tx-cat-select:focus { border-color: ${T.indigo}; box-shadow: 0 0 0 3px ${T.indigoDim}; }
        .tx-tag {
          display: inline-flex; align-items: center; gap: 4px;
          background: ${T.blueDim}; color: ${T.blue};
          padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600;
        }
        @media (max-width: 720px) {
          .tx-row, .tx-head { grid-template-columns: 60px minmax(0,1fr) 110px; }
          .tx-col-cat { display: none; }
        }
      `}</style>

      {/* ── Action strip — title/date-filter now live in the shared header ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        {isAdmin && (
          <Button onClick={() => setShowUpload(true)} style={{ fontSize: 'var(--text-sm)' }}>
            <FiUploadCloud size={14} /> Upload Statement
          </Button>
        )}
        <Button onClick={openUploadHistory} style={{ fontSize: 'var(--text-sm)' }}>
          <FiFileText size={14} /> Upload History
        </Button>
        <Button onClick={handleExportCSV} style={{ fontSize: 'var(--text-sm)' }}>
          <FiDownload size={14} /> Export CSV
        </Button>

        <Badge variant="blue">{totalTransactions} Total Transactions</Badge>
      </div>

      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)', overflow: 'hidden',
      }}>
        <div className="tx-head">
          <span>Date</span>
          <span>Merchant</span>
          <span className="tx-col-cat">Category</span>
          <span style={{ textAlign: 'right' }}>Amount</span>
        </div>

        <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
          {tx.length === 0 ? (
            <EmptyState icon="🧾" title="No transactions" message="No transactions found for the selected filters." />
          ) : (
            tx.map((t, index) => {
              const isCredit = t.credit > 0;
              const d = new Date(t.transactionDate);
              const catValue = t.subCategory || t.category || '';
              const tags = t.tags || [];
              return (
                <div
                  key={t.id || index}
                  className={`tx-row${selectedTx && selectedTx.id === t.id ? ' selected' : ''}`}
                  onClick={() => { setShowUploadHistory(false); setSelectedTx(t); }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '17px', fontWeight: 800, color: T.text, lineHeight: 1.1 }}>
                      {d.toLocaleDateString('en-IN', { day: '2-digit' })}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: T.faint, textTransform: 'uppercase' }}>
                      {d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <Avatar name={t.merchant || '?'} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: '14px', fontWeight: 700, color: T.text,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {t.merchant || '—'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', minWidth: 0 }}>
                        <span style={{ fontSize: '12px', color: T.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.mode || 'Transfer'}
                        </span>
                        {tags.slice(0, 2).map(tag => (
                          <span key={tag} className="tx-tag">#{tag}</span>
                        ))}
                        {tags.length > 2 && <span style={{ fontSize: '11px', color: T.faint }}>+{tags.length - 2}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="tx-col-cat" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={catValue}
                      onChange={(e) => handleCategoryChange(t, e.target.value)}
                      className="tx-cat-select"
                      style={{ color: t.category ? T.text : T.faint }}
                    >
                      {renderCategoryOptions()}
                    </select>
                  </div>

                  <div style={{ textAlign: 'right', fontSize: '15px', fontWeight: 800, color: isCredit ? T.green : T.red, letterSpacing: '-0.3px' }}>
                    {isCredit ? '+' : '−'}{currencyFormatter.format(Math.max(t.credit, t.debit))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Pagination Controls */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        itemsPerPage={itemsPerPage}
        currentCount={tx.length}
        totalCount={totalTransactions}
        startIndex={startIndex}
        itemLabel="transactions"
        onPageChange={setCurrentPage}
        onItemsPerPageChange={(size) => { setItemsPerPage(size); setCurrentPage(1); }}
      />

      {/* RHS detail drawer — non-modal so the list & sidebar stay interactive */}
      <Drawer
        open={!!selectedTx}
        onClose={() => setSelectedTx(null)}
        title="Transaction Details"
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        modal={false}
      >
        {selectedTx && (
          <>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
              padding: '8px 0 22px', borderBottom: `1px solid ${T.border}`, marginBottom: '24px',
            }}>
              <Avatar name={selectedTx.merchant || '?'} size={52} />
              <div style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-0.5px', color: selectedTx.credit ? T.green : T.red }}>
                {selectedTx.credit ? '+' : '−'}{currencyFormatter.format(Math.max(selectedTx.credit, selectedTx.debit))}
              </div>
              <div style={{ color: T.muted, fontSize: '15px', fontWeight: 600, textAlign: 'center' }}>
                {selectedTx.merchant}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Date</div>
                <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500 }}>{new Date(selectedTx.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Mode</div>
                <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500 }}>{selectedTx.mode || '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Reference / UPI ID</div>
                <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500, wordBreak: 'break-all' }}>{selectedTx.upiReference || '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Balance</div>
                <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500 }}>{selectedTx.balance ? currencyFormatter.format(selectedTx.balance) : '-'}</div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Description</div>
                <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500 }}>{selectedTx.description || '-'}</div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Category</div>
                <div style={{ marginTop: '8px' }}>
                  <select
                    value={selectedTx.subCategory || selectedTx.category || ''}
                    onChange={(e) => handleCategoryChange(selectedTx, e.target.value)}
                    className="field-select"
                    disabled={!isAdmin}
                    style={{ color: selectedTx.category ? 'var(--gray-700)' : 'var(--gray-400)' }}
                  >
                    {renderCategoryOptions()}
                  </select>
                </div>
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Tags</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                  {(selectedTx.tags || []).map(tag => (
                    <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', backgroundColor: '#eff6ff', color: '#2563eb', padding: '3px 8px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: 600 }}>
                      #{tag}
                      {isAdmin && (
                        <span onClick={() => handleRemoveTag(tag)} style={{ cursor: 'pointer', color: '#93c5fd', fontWeight: 700, fontSize: '14px', lineHeight: 1 }}>×</span>
                      )}
                    </span>
                  ))}
                </div>
                {isAdmin && (
                <input
                  type="text"
                  list={`tags-list-${selectedTx.id}`}
                  placeholder="+ Add a tag"
                  className="field-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      const newTag = e.target.value.trim().toLowerCase();
                      const currentTags = selectedTx.tags || [];
                      if (!currentTags.includes(newTag)) handleTagChange([...currentTags, newTag]);
                      e.target.value = '';
                      e.preventDefault();
                    }
                  }}
                  onChange={(e) => {
                    const matched = tags.find(t => t.name.toLowerCase() === e.target.value.toLowerCase());
                    if (matched) {
                      const currentTags = selectedTx.tags || [];
                      if (!currentTags.includes(matched.name)) handleTagChange([...currentTags, matched.name]);
                      e.target.value = '';
                    }
                  }}
                  style={{ marginTop: '8px' }}
                />
                )}
                <datalist id={`tags-list-${selectedTx.id}`}>
                  {tags.filter(tag => !(selectedTx.tags || []).includes(tag.name)).map(tag => (
                    <option key={tag.id} value={tag.name} />
                  ))}
                </datalist>
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Note</div>
                {isAdmin ? (
                  <textarea
                    key={selectedTx.id}
                    defaultValue={selectedTx.note || ''}
                    placeholder="Add a note for this transaction…"
                    className="field-input"
                    rows={3}
                    onBlur={(e) => handleNoteChange(e.target.value)}
                    style={{ marginTop: '8px', width: '100%', resize: 'vertical' }}
                  />
                ) : (
                  <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500, whiteSpace: 'pre-wrap' }}>
                    {selectedTx.note || '-'}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Drawer>

      {/* Upload history — RHS drawer */}
      <Drawer
        open={showUploadHistory}
        onClose={() => setShowUploadHistory(false)}
        title="Upload History"
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        modal={false}
      >
        {loadingUploads ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>Loading...</div>
        ) : uploads.length === 0 ? (
          <EmptyState message="No statements have been uploaded for this account yet." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {uploads.map(u => (
              <div key={u.id} className="card" style={{ padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <FiFileText size={22} color="var(--primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '14px', wordBreak: 'break-all' }}>{u.fileName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {new Date(u.uploadedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                      <Badge variant="blue">{u.totalCount ?? u.transactionCount ?? 0} total</Badge>
                      <Badge variant="green">{u.newCount ?? 0} new</Badge>
                      {isAdmin && (
                        <button className="btn danger small" onClick={() => handleRevert(u)}>
                          <FiRotateCcw size={12} /> Revert
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {/* Upload statement modal — scoped to the selected account, refreshes the list on success */}
      {showUpload && (
        <div
          onClick={() => setShowUpload(false)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', zIndex: 20000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 16px' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', width: '760px', maxWidth: '100%', padding: '24px', position: 'relative' }}
          >
            <button
              className="modal-close"
              onClick={() => setShowUpload(false)}
              aria-label="Close"
              style={{ position: 'absolute', top: '16px', right: '20px', zIndex: 1 }}
            >&times;</button>
            <UploadStatement onUploaded={() => setRefreshKey(k => k + 1)} showHistory={false} />
          </div>
        </div>
      )}
    </div>
  );
}