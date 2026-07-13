const ITEMS_PER_PAGE_OPTIONS = [5, 10, 20, 50, 100];

/**
 * Reusable "items per page" + "Showing X to Y of Z" + Prev/Next pagination bar.
 * Renders nothing when totalCount is 0.
 */
export default function Pagination({
  currentPage,
  totalPages,
  itemsPerPage,
  currentCount,
  totalCount,
  startIndex,
  itemLabel = 'transactions',
  onPageChange,
  onItemsPerPageChange,
}) {
  if (totalCount === 0) return null;

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '16px', background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        {totalPages > 1 && (
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Items per page:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
              style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '13px', outline: 'none', background: 'var(--surface-2)', color: 'var(--text-main)' }}
            >
              {ITEMS_PER_PAGE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {totalPages > 1
            ? <>Showing <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{currentCount > 0 ? startIndex + 1 : 0}</span> to <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{startIndex + currentCount}</span> of <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{totalCount}</span> {itemLabel}</>
            : <><span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{totalCount}</span> {itemLabel.replace(/s$/, '')}{totalCount !== 1 ? 's' : ''}</>
          }
        </div>
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn small" disabled={currentPage === 1} onClick={() => onPageChange(Math.max(1, currentPage - 1))}>
            Previous
          </button>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', padding: '0 8px' }}>
            Page {currentPage} of {totalPages}
          </span>
          <button className="btn small" disabled={currentPage >= totalPages || totalPages === 0} onClick={() => onPageChange(Math.min(totalPages || 1, currentPage + 1))}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
