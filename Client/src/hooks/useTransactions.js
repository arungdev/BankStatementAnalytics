import { useCallback } from 'react';
import api from '../api/client';
import useAsyncResource from './useAsyncResource';
import { buildTransactionParams } from '../utils/transactionQuery';

export default function useTransactions(accountId, options, refreshKey) {
  const query = buildTransactionParams(options).toString();
  const load = useCallback(async signal => {
    void refreshKey;
    if (accountId == null) return { transactions: [], totalCount: 0 };
    const response = await api.get(`/statements/${accountId}?${query}`, { signal });
    return response.data;
  }, [accountId, query, refreshKey]);
  const resource = useAsyncResource(load, { transactions: [], totalCount: 0 });
  const { updateData } = resource;
  const setTransactions = useCallback(update => updateData(previous => ({ ...previous,
    transactions: typeof update === 'function' ? update(previous.transactions || []) : update })), [updateData]);
  return { ...resource, setTransactions };
}
