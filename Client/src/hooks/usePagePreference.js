import { useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '@common/client';
import { AccountContext } from '../context/AccountContext';
import { readViewPreference, viewPreferenceKey, writeViewPreference } from '../utils/viewPreferences';

function browserStorage() { try { return globalThis.localStorage; } catch { return null; } }

// Restore synchronously when the workspace/account changes. An effect that only
// reloads after a key change can copy the old account's filters into the new one.
export default function usePagePreference(page, field, initialValue, options = {}) {
  const { username } = useAuth();
  const account = useContext(AccountContext);
  const key = viewPreferenceKey(username, options.scope ?? account?.selectedAccountId ?? 'pending', page, field);
  const fallback = typeof initialValue === 'function' ? initialValue() : initialValue;
  const read = () => readViewPreference(browserStorage(), key, fallback, options.validate, options.legacyKey);
  const [state, setState] = useState(() => ({ key, value: read() }));
  let current = state;
  if (state.key !== key) {
    current = { key, value: read() };
    setState(current);
  }
  useEffect(() => { writeViewPreference(browserStorage(), current.key, current.value); }, [current.key, current.value]);
  const setValue = useCallback(next => {
    setState(previous => {
      // Ignore an event from a view that has already switched account or profile.
      if (previous.key !== key) return previous;
      const value = typeof next === 'function' ? next(previous.value) : next;
      return Object.is(value, previous.value) ? previous : { key, value };
    });
  }, [key]);
  return [current.value, setValue];
}
