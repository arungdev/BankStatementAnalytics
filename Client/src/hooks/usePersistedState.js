import { useEffect, useState } from 'react';

// A useState that mirrors its value to localStorage so it survives page reloads.
// Values are JSON-encoded; if nothing is stored yet, `defaultValue` is used.
// `key` is expected to be a stable string constant.
export default function usePersistedState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? defaultValue : JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      if (value === null || value === undefined)
        localStorage.removeItem(key);
      else
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode / quota) — ignore */
    }
  }, [key, value]);

  return [value, setValue];
}
