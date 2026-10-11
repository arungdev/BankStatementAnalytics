import { useCallback, useEffect, useState } from 'react';
import { startGuardedRequest } from '../utils/guardedRequest';

// A memoized loader identifies the resource. Cleanup guards both cancelled
// requests and promises that resolved just before a filter changed.
export default function useAsyncResource(load, initialData) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(() => ({ load, attempt, data: initialData, loading: true, hasLoaded: false, error: null }));
  if (state.load !== load || state.attempt !== attempt)
    setState({ load, attempt, data: state.data, loading: true, hasLoaded: state.hasLoaded, error: null });
  useEffect(() => {
    return startGuardedRequest(load,
      data => setState({ load, attempt, data, loading: false, hasLoaded: true, error: null }),
      error => setState(previous => ({ ...previous, load, attempt, loading: false, hasLoaded: true, error })));
  }, [load, attempt]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const updateData = useCallback(update => setState(previous => previous.load !== load ? previous :
    { ...previous, data: typeof update === 'function' ? update(previous.data) : update }), [load]);
  return { data: state.data, loading: state.loading, hasLoaded: state.hasLoaded, error: state.error, retry, updateData };
}
