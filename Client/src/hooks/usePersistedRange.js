import { useEffect, useState } from 'react';
import { PRESETS, resolvePreset } from '../components/Daterangepicker';

// Persists a DateRangePicker value ({ start: Date|null, end: Date|null, preset, label })
// across reloads. Relative presets (Last 7 Days, This Month, …) are re-resolved
// against *today* on load so they stay correct as time passes; only CUSTOM ranges
// store their absolute start/end dates.

const DEFAULT = { start: null, end: null, preset: 'ALL', label: 'All Time' };

function labelFor(preset) {
  return PRESETS.find(p => p.value === preset)?.label ?? 'Custom Range';
}

function hydrate(stored) {
  if (!stored || !stored.preset) return DEFAULT;
  const { preset } = stored;

  if (preset === 'ALL') return { ...DEFAULT };

  if (preset === 'CUSTOM') {
    return {
      start: stored.start ? new Date(stored.start) : null,
      end: stored.end ? new Date(stored.end) : null,
      preset: 'CUSTOM',
      label: stored.label ?? labelFor('CUSTOM'),
    };
  }

  // Relative preset — recompute from today.
  const { start, end } = resolvePreset(preset);
  return { start, end, preset, label: labelFor(preset) };
}

function dehydrate(range) {
  if (!range) return DEFAULT;
  return {
    preset: range.preset ?? 'ALL',
    label: range.label,
    // Only meaningful for CUSTOM; harmless otherwise. Dates -> ISO via JSON.
    start: range.preset === 'CUSTOM' ? range.start : null,
    end: range.preset === 'CUSTOM' ? range.end : null,
  };
}

export default function usePersistedRange(key) {
  const [range, setRange] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? { ...DEFAULT } : hydrate(JSON.parse(raw));
    } catch {
      return { ...DEFAULT };
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(dehydrate(range)));
    } catch {
      /* storage unavailable — ignore */
    }
  }, [key, range]);

  return [range, setRange];
}
