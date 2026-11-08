import { PRESETS, resolvePreset } from './dateRanges.js';

export const DEFAULT = { start: null, end: null, preset: 'ALL', label: 'All Time' };

function labelFor(preset) {
  return PRESETS.find(p => p.value === preset)?.label ?? 'Custom Range';
}

export function hydrate(stored) {
  if (!stored || !stored.preset) return DEFAULT;
  const { preset } = stored;

  if (preset === 'ALL') return { ...DEFAULT };

  if (preset === 'CUSTOM') {
    const start = stored.start ? new Date(stored.start) : null;
    const end = stored.end ? new Date(stored.end) : null;
    if (start && !Number.isFinite(start.getTime()) || end && !Number.isFinite(end.getTime()) || start && end && start > end) return { ...DEFAULT };
    return {
      start,
      end,
      preset: 'CUSTOM',
      label: typeof stored.label === 'string' ? stored.label : labelFor('CUSTOM'),
    };
  }

  // Removed/unknown preset (e.g. from an older build) — reset to default.
  if (!PRESETS.some(p => p.value === preset)) return { ...DEFAULT };

  // Relative preset — recompute from today.
  const { start, end } = resolvePreset(preset);
  return { start, end, preset, label: labelFor(preset) };
}

export function dehydrate(range) {
  if (!range) return DEFAULT;
  return {
    preset: range.preset ?? 'ALL',
    label: range.label,
    // Only meaningful for CUSTOM; harmless otherwise. Dates -> ISO via JSON.
    start: range.preset === 'CUSTOM' ? range.start : null,
    end: range.preset === 'CUSTOM' ? range.end : null,
  };
}
