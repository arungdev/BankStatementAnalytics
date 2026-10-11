export function searchResultPath(item) {
  if (item.type === 'nav') return item.data.path;
  const params = new URLSearchParams();
  if (item.type === 'merchant') {
    params.set('search', item.data.name);
  } else {
    params.set('search', item.data.bankReference || item.data.description || '');
    if (item.data.accountId != null) params.set('accountId', item.data.accountId);
  }
  return `/transactions?${params}`;
}
