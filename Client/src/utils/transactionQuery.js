export function buildTransactionParams({ page = 1, pageSize = 10, accountIds, startDate, endDate,
  uploadId, uncategorizedOnly, search, sortBy = 'date', sortDir = 'desc', minAmount, maxAmount, category }) {
  const params = new URLSearchParams({ page, pageSize });
  if (accountIds) params.set('accountIds', accountIds);
  if (uploadId) params.set('uploadId', uploadId);
  else {
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
  }
  if (uncategorizedOnly) params.set('uncategorizedOnly', 'true');
  if (search) params.set('search', search);
  params.set('sortBy', sortBy);
  params.set('sortDir', sortDir);
  if (minAmount != null) params.set('minAmount', minAmount);
  if (maxAmount != null) params.set('maxAmount', maxAmount);
  if (category) params.set('category', category);
  return params;
}
