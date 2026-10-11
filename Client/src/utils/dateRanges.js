export const PRESET_GROUPS = [
  {
    title: 'Quick',
    items: [
      { label: 'All Time',  value: 'ALL' },
      { label: 'Today',     value: 'TODAY' },
      { label: 'Yesterday', value: 'YESTERDAY' },
    ],
  },
  {
    title: 'Rolling',
    items: [
      { label: 'Last 7 Days',  value: 'LAST_7' },
      { label: 'Last 30 Days', value: 'LAST_30' },
      { label: 'Last 60 Days', value: 'LAST_60' },
    ],
  },
  {
    title: 'Calendar',
    items: [
      { label: 'This Week',  value: 'THIS_WEEK' },
      { label: 'Last Week',  value: 'LAST_WEEK' },
      { label: 'This Month', value: 'THIS_MONTH' },
      { label: 'Last Month', value: 'LAST_MONTH' },
    ],
  },
  {
    title: null,
    items: [
      { label: 'Custom Range', value: 'CUSTOM' },
    ],
  },
];

export const PRESETS = PRESET_GROUPS.flatMap(g => g.items);

/* ─── Date Helpers ──────────────────────────────────────────────────────── */
export const startOfDay = (d) => { const n = new Date(d); n.setHours(0,0,0,0); return n; };
export const endOfDay   = (d) => { const n = new Date(d); n.setHours(23,59,59,999); return n; };
export const addDays    = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

export function resolvePreset(value) {
  const now = new Date();
  const today = startOfDay(now);
  switch (value) {
    case 'ALL':        return { start: null, end: null };
    case 'TODAY':      return { start: startOfDay(now), end: endOfDay(now) };
    case 'YESTERDAY':  { const y = addDays(today, -1); return { start: y, end: endOfDay(y) }; }
    case 'LAST_7':     return { start: addDays(today, -6), end: endOfDay(now) };
    case 'LAST_30':    return { start: addDays(today, -29), end: endOfDay(now) };
    case 'LAST_60':    return { start: addDays(today, -59), end: endOfDay(now) };
    case 'THIS_WEEK':  { const s = new Date(today); s.setDate(today.getDate() - today.getDay()); return { start: s, end: endOfDay(now) }; }
    case 'LAST_WEEK':  { const s = new Date(today); s.setDate(today.getDate() - today.getDay() - 7); const e = new Date(s); e.setDate(s.getDate() + 6); return { start: s, end: endOfDay(e) }; }
    case 'THIS_MONTH': { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { start: s, end: endOfDay(now) }; }
    case 'LAST_MONTH': { const s = new Date(now.getFullYear(), now.getMonth()-1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); return { start: s, end: endOfDay(e) }; }
    default:           return { start: null, end: null };
  }
}

