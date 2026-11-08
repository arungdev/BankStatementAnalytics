export const preferenceValidators = {
  pageSize: value => [5, 10, 20, 50, 100].includes(value),
  amount: value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0,
  width: value => typeof value === 'number' && Number.isFinite(value) && value >= 300 && value <= 1600,
  page: value => Number.isInteger(value) && value >= 0 && value <= 100000,
};

export const oneOf = (...values) => value => values.includes(value);

export function viewPreferenceKey(user, scope, page, field) {
  return ['bsa-view-v1', user || 'anonymous', scope ?? 'workspace', page, field].map(value => encodeURIComponent(String(value))).join(':');
}

function matchesDefault(value, fallback) {
  if (fallback === null) return value === null;
  if (typeof value !== typeof fallback || value === null) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 1000;
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (typeof fallback === 'object') return !Array.isArray(value) && Object.keys(fallback).every(key => matchesDefault(value[key], fallback[key]));
  return typeof value === 'boolean';
}

export function readViewPreference(storage, key, fallback, validate, legacyKey) {
  try {
    const raw = storage.getItem(key) ?? (legacyKey ? storage.getItem(legacyKey) : null);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    return (validate ? validate(value) : matchesDefault(value, fallback)) ? value : fallback;
  } catch { return fallback; }
}

export function writeViewPreference(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* Keep the current view usable when storage is unavailable. */ }
}
