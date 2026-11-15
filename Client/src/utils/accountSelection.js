// A saved browser preference grants no account access. Resolve it only against
// the current workspace's server-provided account list.
export function resolveAccountSelection(saved, accounts) {
  const ids = accounts.filter(account => typeof account.id === 'number').map(account => account.id);
  if (!ids.length) return null;
  if (saved === 'all') return 'all';
  return ids.includes(Number(saved)) ? Number(saved) : ids[0];
}
