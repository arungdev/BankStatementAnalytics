import { Pagination as CommonPagination } from '@common/client';
export default function Pagination({ itemLabel = 'transactions', ...props }) {
  return <CommonPagination {...props} itemLabel={itemLabel} />;
}
