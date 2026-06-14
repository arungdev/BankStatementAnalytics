import { useEffect, useState } from "react";
import api from "../api/client";
import { useAccount } from "../context/useAccount";
import { FiDownload } from "react-icons/fi";

export default function Transactions() {
  const { selectedAccountId } = useAccount();
  const [tx, setTx] = useState([]);
  const [loading, setLoading] = useState(!selectedAccountId);
  const [totalTransactions, setTotalTransactions] = useState(0);

  // Date filter state
  const [dateFilterType, setDateFilterType] = useState('ALL');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  // Lowered default to 10 so you can actually see the pagination working with your 18 records!
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Sidebar state
  const [selectedTx, setSelectedTx] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(450);
  const [isResizing, setIsResizing] = useState(false);

  // Handle dragging the sidebar to resize
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      // Calculate new width based on mouse position from the right edge
      const newWidth = window.innerWidth - e.clientX;
      // Constrain the width between 300px and the window width minus 50px
      if (newWidth >= 300 && newWidth <= window.innerWidth - 50) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none'; // Prevent text selection while dragging
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedAccountId) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    const params = new URLSearchParams({
      page: currentPage,
      pageSize: itemsPerPage
    });

    if (dateFilterType === 'MONTH' && selectedMonth) {
      const [year, month] = selectedMonth.split('-');
      params.append('year', year);
      params.append('month', month);
    } else if (dateFilterType === 'CUSTOM') {
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
    }

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
          // Client-side fallback mode
          // Apply Filters Locally
          allTx = allTx.filter(t => {
            if (dateFilterType === 'ALL') return true;

            const txDate = new Date(t.transactionDate);
            if (dateFilterType === 'MONTH' && selectedMonth) {
              const [year, month] = selectedMonth.split('-');
              return txDate.getFullYear() === parseInt(year, 10) && (txDate.getMonth() + 1) === parseInt(month, 10);
            }
            if (dateFilterType === 'CUSTOM') {
              if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                if (txDate < start) return false;
              }
              if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                if (txDate > end) return false;
              }
              return true;
            }
            return true;
          });

          setTotalTransactions(allTx.length);

          // Apply Pagination Locally
          const startIdx = (currentPage - 1) * itemsPerPage;
          setTx(allTx.slice(startIdx, startIdx + itemsPerPage));
        } else {
          // Server-side mode
          setTx(allTx);
          setTotalTransactions(res.data.totalCount);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [selectedAccountId, currentPage, dateFilterType, selectedMonth, startDate, endDate, itemsPerPage]);

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

  // Handlers to prevent double-fetching on filter change
  const handleFilterTypeChange = (e) => { setDateFilterType(e.target.value); setCurrentPage(1); };
  const handleMonthChange = (e) => { setSelectedMonth(e.target.value); setCurrentPage(1); };
  const handleStartDateChange = (e) => { setStartDate(e.target.value); setCurrentPage(1); };
  const handleEndDateChange = (e) => { setEndDate(e.target.value); setCurrentPage(1); };
  const handleItemsPerPageChange = (e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); };

  const handleExportCSV = () => {
    const params = new URLSearchParams({ pageSize: 0 });

    if (dateFilterType === 'MONTH' && selectedMonth) {
      const [year, month] = selectedMonth.split('-');
      params.append('year', year);
      params.append('month', month);
    } else if (dateFilterType === 'CUSTOM') {
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
    }

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

          {/* Date Filter Controls */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: '#f9fafb', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>Filter:</span>
            <select
              value={dateFilterType}
              onChange={handleFilterTypeChange}
              style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px', outline: 'none' }}
            >
              <option value="ALL">All Time</option>
              <option value="MONTH">By Month</option>
              <option value="CUSTOM">Custom Range</option>
            </select>

            {dateFilterType === 'MONTH' && (
              <input type="month" value={selectedMonth} onChange={handleMonthChange} style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px', outline: 'none' }} />
            )}

            {dateFilterType === 'CUSTOM' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="date" value={startDate} onChange={handleStartDateChange} style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px', outline: 'none' }} />
                <span style={{ fontSize: '12px', color: '#6b7280' }}>to</span>
                <input type="date" value={endDate} onChange={handleEndDateChange} style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px', outline: 'none' }} />
              </div>
            )}
          </div>

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
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tx.map((t, index) => (
              <tr key={t.id || index} onClick={() => setSelectedTx(t)} style={{ cursor: 'pointer', transition: 'background-color 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = '#f9fafb'} onMouseOut={e => e.currentTarget.style.backgroundColor = ''}>
                <td style={{ fontWeight: 600 }}>{new Date(t.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td style={{ fontWeight: 600 }}>{t.merchant}</td>
                <td className="text-red">{t.debit ? `₹${t.debit.toLocaleString('en-IN')}` : "-"}</td>
                <td className="text-green">{t.credit ? `₹${t.credit.toLocaleString('en-IN')}` : "-"}</td>
                <td><span className="badge green">Completed</span></td>
              </tr>
            ))}
            {tx.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '48px 24px', color: '#9ca3af', fontStyle: 'italic' }}>
                  No transactions found for the selected account.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
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
              <button
                className="btn small"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151', padding: '0 8px' }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn small"
                disabled={currentPage >= totalPages || totalPages === 0}
                onClick={() => setCurrentPage(p => Math.min(totalPages || 1, p + 1))}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
      {/* RHS Sidebar Overlay */}
      {selectedTx && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setSelectedTx(null)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 999 }}
          />

          {/* Sidebar */}
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: `${sidebarWidth}px`, maxWidth: '100vw',
            backgroundColor: '#fff', boxShadow: '-4px 0 15px rgba(0,0,0,0.1)',
            zIndex: 1000, display: 'flex', flexDirection: 'column'
          }}>
            {/* Resize Handle */}
            <div
              onMouseDown={() => setIsResizing(true)}
              style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px',
                cursor: 'ew-resize', backgroundColor: isResizing ? '#3b82f6' : 'transparent',
                zIndex: 1001, transition: 'background-color 0.2s'
              }}
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
                  <div style={{ marginTop: '4px', color: '#111827', fontWeight: 500 }}>
                    {selectedTx.category ? <span className="badge purple">{selectedTx.category}</span> : '-'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
