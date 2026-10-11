import Pagination from './Pagination';

export default function PagedRowsControls({ data }) {
  return <>
    {data.error && <button className="btn btn--outline" onClick={data.onRetry}>Retry loading page</button>}
    <Pagination currentPage={data.page} totalPages={Math.max(1, Math.ceil(data.totalCount / data.pageSize))}
    itemsPerPage={data.pageSize} currentCount={data.items.length} totalCount={data.totalCount}
    startIndex={(data.page - 1) * data.pageSize} itemLabel="transactions" loading={data.loading}
    onPageChange={data.onPageChange} onItemsPerPageChange={data.onPageSizeChange} />
  </>;
}
