import { useCallback, useMemo } from 'react';
import usePagePreference from './usePagePreference';
import { DEFAULT, hydrate, dehydrate } from '../utils/dateRangePreferences';

// Persists a DateRangePicker value ({ start: Date|null, end: Date|null, preset, label })
// across reloads. Relative presets (Last 7 Days, This Month, …) are re-resolved
// against *today* on load so they stay correct as time passes; only CUSTOM ranges
// store their absolute start/end dates.

export default function usePersistedRange(key) {
  const [stored, setStored] = usePagePreference('dateRanges', key, DEFAULT, {
    legacyKey: key,
    validate: value => value !== null && typeof value === 'object' && typeof value.preset === 'string',
  });
  const range = useMemo(() => hydrate(stored), [stored]);
  const setRange = useCallback(value => setStored(previous => dehydrate(typeof value === 'function' ? value(hydrate(previous)) : value)), [setStored]);
  return [range, setRange];
}
