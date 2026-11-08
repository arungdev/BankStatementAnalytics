import { Children, cloneElement, isValidElement, useState } from 'react';
import Pagination from './Pagination';
import TablePageTransition from './TablePageTransition';
import usePagePreference from '../hooks/usePagePreference';
import { preferenceValidators } from '../utils/viewPreferences';

// Summary/preview tables already contain aggregate or local-file rows. Bound their
// rendered rows without requesting raw transactions just to display a summary.
export default function PaginatedTable({ children, preferenceId = 'summary', ...tableProps }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePagePreference('tables', preferenceId, 20, { validate: preferenceValidators.pageSize });
  const sections = Children.toArray(children);
  const body = sections.find(child => isValidElement(child) && child.type === 'tbody');
  const rows = Children.toArray(body?.props.children);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const visible = rows.slice(start, start + pageSize);
  return <>
    <TablePageTransition pageKey={`${currentPage}|${pageSize}`}>
      <table {...tableProps}>{sections.map(child => child === body ? cloneElement(body, {}, visible) : child)}</table>
    </TablePageTransition>
    {rows.length > 5 && <Pagination currentPage={currentPage} totalPages={totalPages} itemsPerPage={pageSize}
      currentCount={visible.length} totalCount={rows.length} startIndex={start} itemLabel="rows"
      onPageChange={setPage} onItemsPerPageChange={value => { setPageSize(value); setPage(1); }} />}
  </>;
}
