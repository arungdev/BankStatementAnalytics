import { useEffect, useState } from "react";
import api from "../api/client";
import { useAccount } from "../context/useAccount";
import { FiDownload } from "react-icons/fi";
// ── Replaced native date inputs with custom DateRangePicker ──────────────
import DateRangePicker from "../components/DateRangePicker"; // adjust path as needed

export default function Transactions() {
  const { selectedAccountId, selectedAccount } = useAccount();
  console.log('selectedAccount:', selectedAccount);
  const [tx, setTx] = useState([]);
  const [loading, setLoading] = useState(!selectedAccountId);
  const [totalTransactions, setTotalTransactions] = useState(0);

  // Categories from API
  const [categories, setCategories] = useState([]);

  // ── Date filter state — now driven by DateRangePicker ─────────────────
  // dateRange holds { start: Date|null, end: Date|null, preset: string }
  const [dateRange, setDateRange] = useState({ start: null, end: null, preset: 'ALL' });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Sidebar state
  const [selectedTx, setSelectedTx] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(450);
  const [isResizing, setIsResizing] = useState(false);
  const [tags, setTags] = useState([]);

  useEffect(() => {
    api.get('/categories')
      .then(res => setCategories(res.data || []))
      .catch(err => console.error("Failed to load categories", err));

    api.get('/tags')
      .then(res => setTags(res.data || []))
      .catch(err => console.error("Failed to load tags", err));
  }, []);

  // Handle dragging the sidebar to resize
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 300 && newWidth <= window.innerWidth - 50) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // ── Helper: Date → "yyyy-MM-dd" string in local time ──────────────────
  const toLocalDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedAccountId) return;
    setLoading(true);

    const { start: startDate, end: endDate } = dateRange;

    const params = new URLSearchParams({ page: currentPage, pageSize: itemsPerPage });

    if (startDate) params.append('startDate', toLocalDate(startDate));
    if (endDate)   params.append('endDate',   toLocalDate(endDate));

    api.get(`/statements/${selectedAccountId}?${params.toString()}`)
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
  }, [selectedAccountId, currentPage, dateRange, itemsPerPage]);

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <div className="loader-text">Loading transactions...</div>
      </div>
    );
  }

  // Pagination logic
  const totalPages = Math.ceil(totalTransactions / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;

  // ── When date range changes, reset to page 1 ──────────────────────────
  const handleDateRangeChange = (range) => {
    setDateRange(range);
    setCurrentPage(1);
  };

  const handleItemsPerPageChange = (e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); };

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
      AccountId: selectedAccountId,
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
      AccountId: selectedAccountId,
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

  const handleExportCSV = () => {
    const { start: startDate, end: endDate } = dateRange;
    const params = new URLSearchParams({ pageSize: 0 });
    if (startDate) params.append('startDate', toLocalDate(startDate));
    if (endDate)   params.append('endDate',   toLocalDate(endDate));

    api.get(`/statements/${selectedAccountId}?${params.toString()}`)
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
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <h1 style={{ marginBottom: 0 }}>All Transactions</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>

          <button
            onClick={handleExportCSV}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '13px', backgroundColor: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', color: '#374151', fontWeight: 500 }}
          >
            <FiDownload size={14} /> Export CSV
          </button>

          {/* ── DateRangePicker replaces the old filter controls ─────── */}
          <DateRangePicker
            value={dateRange}
            onChange={handleDateRangeChange}
            showTime={false}
            placeholder="Filter by date range"
            size="sm"
            align="right"
          />

          <div className="badge blue" style={{ padding: '10px 18px', fontSize: '13px', fontWeight: 700 }}>
            {totalTransactions} Total Transactions
          </div>
        </div>
      </div>

      <div className="table-container" style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
        <table>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f9fafb', zIndex: 10, boxShadow: 'inset 0 -1px 0 #e5e7eb' }}>
            <tr>
              <th>Date</th>
              <th>Merchant</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Category</th>
              <th>Tags</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tx.map((t, index) => (
              <tr
                key={t.id || index}
                onClick={() => setSelectedTx(t)}
                style={{ cursor: 'pointer', transition: 'background-color 0.2s' }}
                onMouseOver={e => e.currentTarget.style.backgroundColor = '#f9fafb'}
                onMouseOut={e => e.currentTarget.style.backgroundColor = ''}
              >
                <td style={{ fontWeight: 600 }}>{new Date(t.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td style={{ fontWeight: 600 }}>{t.merchant}</td>
                <td className="text-red">{t.debit ? `₹${t.debit.toLocaleString('en-IN')}` : "-"}</td>
                <td className="text-green">{t.credit ? `₹${t.credit.toLocaleString('en-IN')}` : "-"}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    value={t.subCategory || t.category || ''}
                    onChange={(e) => handleCategoryChange(t, e.target.value)}
                    style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '12px', color: t.category ? '#374151' : '#9ca3af', background: '#fff' }}
                  >
                    {renderCategoryOptions()}
                  </select>
                </td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {(t.tags || []).map(tag => (
                      <span key={tag} style={{ backgroundColor: '#eff6ff', color: '#2563eb', padding: '2px 7px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td><span className="badge green">Completed</span></td>
              </tr>
            ))}
            {tx.length === 0 && (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '48px 24px', color: '#9ca3af', fontStyle: 'italic' }}>
                  No transactions found for the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalTransactions > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '16px', background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            {totalPages > 1 && (
              <div style={{ fontSize: '13px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Items per page:</span>
                <select
                  value={itemsPerPage}
                  onChange={handleItemsPerPageChange}
                  style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px', outline: 'none', background: '#f9fafb' }}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            )}
            <div style={{ fontSize: '13px', color: '#6b7280' }}>
              {totalPages > 1
                ? <>Showing <span style={{ fontWeight: 600, color: '#111827' }}>{tx.length > 0 ? startIndex + 1 : 0}</span> to <span style={{ fontWeight: 600, color: '#111827' }}>{startIndex + tx.length}</span> of <span style={{ fontWeight: 600, color: '#111827' }}>{totalTransactions}</span> transactions</>
                : <><span style={{ fontWeight: 600, color: '#111827' }}>{totalTransactions}</span> transaction{totalTransactions !== 1 ? 's' : ''}</>
              }
            </div>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button className="btn small" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
                Previous
              </button>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151', padding: '0 8px' }}>
                Page {currentPage} of {totalPages}
              </span>
              <button className="btn small" disabled={currentPage >= totalPages || totalPages === 0} onClick={() => setCurrentPage(p => Math.min(totalPages || 1, p + 1))}>
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* RHS Sidebar Overlay */}
      {selectedTx && (
        <>
          <div
            onClick={() => setSelectedTx(null)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 999 }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: `${sidebarWidth}px`, maxWidth: '100vw',
            backgroundColor: '#fff', boxShadow: '-4px 0 15px rgba(0,0,0,0.1)',
            zIndex: 1000, display: 'flex', flexDirection: 'column'
          }}>
            {/* Resize Handle */}
            <div
              onMouseDown={() => setIsResizing(true)}
              style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px', cursor: 'ew-resize', backgroundColor: isResizing ? '#3b82f6' : 'transparent', zIndex: 1001, transition: 'background-color 0.2s' }}
            />

            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f9fafb' }}>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#111827' }}>Transaction Details</h2>
              <button onClick={() => setSelectedTx(null)} style={{ cursor: 'pointer', background: 'none', border: 'none', fontSize: '28px', color: '#6b7280', lineHeight: 1 }}>&times;</button>
            </div>

            {/* Content */}
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ textAlign: 'center', padding: '16px 0', borderBottom: '1px solid #e5e7eb', marginBottom: '24px' }}>
                <div style={{ fontSize: '36px', fontWeight: 700, color: selectedTx.credit ? '#10b981' : '#ef4444' }}>
                  {selectedTx.credit ? '+' : '-'}₹{Math.max(selectedTx.credit, selectedTx.debit).toLocaleString('en-IN')}
                </div>
                <div style={{ color: '#4b5563', marginTop: '8px', fontSize: '16px', fontWeight: 500 }}>
                  {selectedTx.merchant}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Date</div>
                  <div style={{ marginTop: '4px', color: '#111827', fontWeight: 500 }}>{new Date(selectedTx.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Mode</div>
                  <div style={{ marginTop: '4px', color: '#111827', fontWeight: 500 }}>{selectedTx.mode || '-'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Reference / UPI ID</div>
                  <div style={{ marginTop: '4px', color: '#111827', fontWeight: 500, wordBreak: 'break-all' }}>{selectedTx.upiReference || '-'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Balance</div>
                  <div style={{ marginTop: '4px', color: '#111827', fontWeight: 500 }}>{selectedTx.balance ? `₹${selectedTx.balance.toLocaleString('en-IN')}` : '-'}</div>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Description / Notes</div>
                  <div style={{ marginTop: '4px', color: '#111827', fontWeight: 500 }}>{selectedTx.description || '-'}</div>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Category</div>
                  <div style={{ marginTop: '8px' }}>
                    <select
                      value={selectedTx.subCategory || selectedTx.category || ''}
                      onChange={(e) => handleCategoryChange(selectedTx, e.target.value)}
                      style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', color: selectedTx.category ? '#374151' : '#9ca3af', background: '#fff', width: '100%' }}
                    >
                      {renderCategoryOptions()}
                    </select>
                  </div>
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Tags</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {(selectedTx.tags || []).map(tag => (
                      <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', backgroundColor: '#eff6ff', color: '#2563eb', padding: '3px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                        #{tag}
                        <span onClick={() => handleRemoveTag(tag)} style={{ cursor: 'pointer', color: '#93c5fd', fontWeight: 700, fontSize: '14px', lineHeight: 1 }}>×</span>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    list={`tags-list-${selectedTx.id}`}
                    placeholder="+ Add a tag"
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
                    style={{ marginTop: '8px', width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                  />
                  <datalist id={`tags-list-${selectedTx.id}`}>
                    {tags.filter(tag => !(selectedTx.tags || []).includes(tag.name)).map(tag => (
                      <option key={tag.id} value={tag.name} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}