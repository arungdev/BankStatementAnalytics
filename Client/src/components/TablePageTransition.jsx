import './TablePageTransition.css';

export default function TablePageTransition({ loading = false, pageKey, children, className = '' }) {
  return <div className={`table-page-transition ${className}`} aria-busy={loading}>
    <div key={pageKey} className={`table-page-content${loading ? ' is-loading' : ''}`} inert={loading ? true : undefined}>{children}</div>
    {loading && <div className="table-page-loading" role="status"><span className="table-page-spinner" aria-hidden="true" />Loading page…</div>}
  </div>;
}
