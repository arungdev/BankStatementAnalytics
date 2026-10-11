import { useEffect, useState } from 'react';
import api from '../api/client';

export default function usePagedRows(url) {
  const [attempt, setAttempt] = useState(0);
  const [selection, setSelection] = useState({ url: null, page: 1, pageSize: 20 });
  const [response, setResponse] = useState({ key: null, url: null, data: null, error: null });
  const page = selection.url === url ? selection.page : 1;
  const pageSize = selection.pageSize;
  const key = `${url}|${page}|${pageSize}|${attempt}`;
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let live = true;
    api.get(url, { params: { page, pageSize }, signal: controller.signal })
      .then(result => { if (live) setResponse({ key, url, data: result.data, error: null }); })
      .catch(error => { if (live) setResponse({ key, url, data: null, error: error.response?.data?.message || 'Could not load this page. Please try again.' }); });
    return () => { live = false; controller.abort(); };
  }, [url, page, pageSize, key]);
  const data = response.url === url ? response.data : null;
  return {
    items: data?.items || [], totalCount: data?.totalCount || 0,
    credits: data?.credits || 0, debits: data?.debits || 0, totalAmount: data?.totalAmount || 0,
    page: data?.page ?? page, pageSize, pageKey: response.key,
    loading: Boolean(url && response.key !== key), error: response.key === key ? response.error : null,
    onPageChange: value => setSelection({ url, page: value, pageSize }),
    onPageSizeChange: value => setSelection({ url, page: 1, pageSize: value }),
    onRetry: () => setAttempt(value => value + 1)
  };
}
