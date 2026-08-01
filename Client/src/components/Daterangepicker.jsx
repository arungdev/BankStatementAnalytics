import { useState, useRef, useEffect, useCallback } from 'react';
import './filter-chip.css';

/* ─── Constants ─────────────────────────────────────────────────────────── */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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
const startOfDay = (d) => { const n = new Date(d); n.setHours(0,0,0,0); return n; };
const endOfDay   = (d) => { const n = new Date(d); n.setHours(23,59,59,999); return n; };
const addDays    = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const isSameDay  = (a, b) => a && b && a.toDateString() === b.toDateString();
const isBetween  = (d, s, e) => d && s && e && d > s && d < e;

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

const fmt = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const pad = (n) => String(n).padStart(2, '0');

/* ─── Single Month Calendar ─────────────────────────────────────────────── */
function MonthCalendar({ year, month, onMonthChange, start, end, hovered, onDayClick, onDayHover }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: prevDays - firstDay + 1 + i, cur: false });
  for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, cur: true });
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) cells.push({ day: i, cur: false });

  const rangeEnd = hovered && start && !end ? hovered : end;

  return (
    <div style={{ minWidth: 196 }}>
      {/* Month nav */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8 }}>
        <button onClick={() => onMonthChange(-1)} style={navBtn}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-main)' }}>
          {MONTHS[month]} {year}
        </span>
        <button onClick={() => onMonthChange(1)} style={navBtn}>›</button>
      </div>
      {/* Day headers */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', marginBottom: 2 }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign:'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', padding: '2px 0' }}>{d}</div>
        ))}
      </div>
      {/* Day cells */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap: '1px 0' }}>
        {cells.map((cell, idx) => {
          if (!cell.cur) {
            return <div key={idx} style={{ textAlign:'center', padding: '4px 0', fontSize: 11, color: 'var(--gray-300)' }}>{cell.day}</div>;
          }
          const date = new Date(year, month, cell.day);
          const isStart    = isSameDay(date, start);
          const isEnd      = isSameDay(date, rangeEnd);
          const inRange    = isBetween(date, start, rangeEnd) || isBetween(date, rangeEnd, start);
          const isEndpoint = isStart || isEnd;
          const today      = isSameDay(date, new Date());

          let bg = 'transparent', color = 'var(--text-main)';
          let rangeBg = 'transparent', rangeR = '0', rangeL = '0';

          if (isEndpoint) { bg = 'var(--primary)'; color = '#fff'; }
          else if (today) { color = 'var(--primary)'; }

          if (inRange || isEndpoint) {
            const s2 = start && rangeEnd ? (start < rangeEnd ? start : rangeEnd) : start;
            const e2 = start && rangeEnd ? (start < rangeEnd ? rangeEnd : start) : rangeEnd;
            rangeBg = 'var(--primary-light)';
            if (isStart || isSameDay(date, s2)) rangeL = '50%';
            if (isEnd   || isSameDay(date, e2)) rangeR = '50%';
          }

          return (
            <div key={idx}
              onClick={() => onDayClick(date)}
              onMouseEnter={() => onDayHover(date)}
              style={{
                position: 'relative', textAlign: 'center', cursor: 'pointer',
                background: rangeBg,
                borderTopLeftRadius:    rangeL,
                borderBottomLeftRadius: rangeL,
                borderTopRightRadius:   rangeR,
                borderBottomRightRadius:rangeR,
              }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 23, height: 23, borderRadius: '50%',
                background: bg, color,
                fontSize: 11, fontWeight: isEndpoint ? 700 : today ? 600 : 400,
                transition: 'background 0.1s',
              }}>
                {cell.day}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const navBtn = {
  background: 'none', border: '1px solid var(--border-color)', borderRadius: 5,
  width: 22, height: 22, cursor: 'pointer', fontSize: 13,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-muted)', lineHeight: 1,
};

/* ─── Time Input ────────────────────────────────────────────────────────── */
function TimeInput({ hours, minutes, onChange }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap: 3, margin: '6px 0 8px', fontSize: 11, color: 'var(--text-muted)' }}>
      <span>HH:</span>
      <input
        type="number" min={0} max={23} value={pad(hours)}
        onChange={e => onChange('h', Math.min(23, Math.max(0, +e.target.value)))}
        style={timeInputStyle}
      />
      <span style={{ color:'var(--primary)', fontWeight:700 }}>:</span>
      <span>MM:</span>
      <input
        type="number" min={0} max={59} value={pad(minutes)}
        onChange={e => onChange('m', Math.min(59, Math.max(0, +e.target.value)))}
        style={timeInputStyle}
      />
    </div>
  );
}

const timeInputStyle = {
  width: 34, textAlign:'center', border:'1px solid var(--border-color)',
  borderRadius: 5, padding:'2px 3px', fontSize: 11,
  color: 'var(--primary)', fontWeight: 700, outline: 'none',
  background: 'var(--surface-2)', fontFamily: 'inherit',
};

/* ─── Main DateRangePicker ──────────────────────────────────────────────── */
/**
 * DateRangePicker
 *
 * Props:
 *   value         : { start: Date|null, end: Date|null, preset: string }
 *   onChange      : ({ start, end, preset, label }) => void
 *   showTime?     : boolean  (default true)
 *   align?        : 'left' | 'right'  (dropdown alignment, default 'left')
 *   placeholder?  : string
 *   size?         : 'sm' | 'md'  (default 'sm' — compact). 'md' restores the original larger layout.
 *
 * Usage:
 *   const [range, setRange] = useState({ start: null, end: null, preset: 'LAST_30' });
 *   <DateRangePicker value={range} onChange={setRange} />
 */
export default function DateRangePicker({
  value,
  onChange,
  showTime = true,
  align = 'left',
  placeholder = 'Select date range',
  size = 'sm',
  prefixLabel = 'Period',   // muted label inside the trigger chip; pass null to hide
}) {
  const compact = size === 'sm';

  const [open, setOpen]         = useState(false);
  const [preset, setPreset]     = useState(value?.preset ?? 'LAST_30');
  const [customN, setCustomN]   = useState('');

  // Calendar state
  const now = new Date();
  const [leftYear,  setLeftYear]  = useState(now.getFullYear());
  const [leftMonth, setLeftMonth] = useState(now.getMonth() === 0 ? 11 : now.getMonth() - 1);
  const [rightYear, setRightYear] = useState(now.getFullYear());
  const [rightMonth,setRightMonth]= useState(now.getMonth());

  // Selection state
  const [selStart, setSelStart] = useState(value?.start ?? null);
  const [selEnd,   setSelEnd]   = useState(value?.end   ?? null);
  const [hovered,  setHovered]  = useState(null);
  const [picking,  setPicking]  = useState('start'); // 'start' | 'end'

  // Time state
  const [startH, setStartH] = useState(0);
  const [startM, setStartM] = useState(0);
  const [endH,   setEndH]   = useState(23);
  const [endM,   setEndM]   = useState(59);

  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Sync left/right months so they're always consecutive
  const syncMonths = useCallback((s, e) => {
    if (s) {
      const sy = s.getFullYear(), sm = s.getMonth();
      setLeftYear(sy); setLeftMonth(sm);
      if (e && (e.getFullYear() > sy || e.getMonth() > sm)) {
        setRightYear(e.getFullYear()); setRightMonth(e.getMonth());
      } else {
        const nm = sm === 11 ? 0 : sm + 1;
        const ny = sm === 11 ? sy + 1 : sy;
        setRightYear(ny); setRightMonth(nm);
      }
    }
  }, []);

  const applyPreset = (p) => {
    setPreset(p);
    if (p === 'CUSTOM') return;
    const { start, end } = resolvePreset(p);
    setSelStart(start); setSelEnd(end); setPicking('start');
    if (start) syncMonths(start, end);
  };

  const handleDayClick = (date) => {
    if (picking === 'start' || !selStart) {
      setSelStart(date); setSelEnd(null);
      setPicking('end'); setPreset('CUSTOM');
    } else {
      if (date < selStart) { setSelStart(date); setSelEnd(selStart); }
      else                  { setSelEnd(date); }
      setPicking('start'); setPreset('CUSTOM');
    }
  };

  const navigateLeft = (dir) => {
    let m = leftMonth + dir, y = leftYear;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setLeftMonth(m); setLeftYear(y);
    let rm = m + 1, ry = y;
    if (rm > 11) { rm = 0; ry++; }
    setRightMonth(rm); setRightYear(ry);
  };

  const navigateRight = (dir) => {
    let m = rightMonth + dir, y = rightYear;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setRightMonth(m); setRightYear(y);
    let lm = m - 1, ly = y;
    if (lm < 0) { lm = 11; ly--; }
    setLeftMonth(lm); setLeftYear(ly);
  };

  const applyCustomN = () => {
    const n = parseInt(customN);
    if (!isNaN(n) && n > 0) {
      const s = addDays(startOfDay(new Date()), -(n-1));
      const e = endOfDay(new Date());
      setSelStart(s); setSelEnd(e); setPreset('CUSTOM'); syncMonths(s, e);
    }
  };

  const handleApply = () => {
    // Merge time into dates
    const s = selStart ? new Date(selStart) : null;
    const e = selEnd   ? new Date(selEnd)   : null;
    if (s) { s.setHours(startH, startM, 0, 0); }
    if (e) { e.setHours(endH, endM, 59, 999); }

    const label = PRESETS.find(p => p.value === preset)?.label ?? 'Custom Range';
    onChange?.({ start: s, end: e, preset, label });
    setOpen(false);
  };

  const handleCancel = () => {
    setSelStart(value?.start ?? null);
    setSelEnd(value?.end ?? null);
    setPreset(value?.preset ?? 'LAST_30');
    setOpen(false);
  };

  // Trigger label
  const activeLabel = (() => {
    if (!value?.start && !value?.end) return placeholder;
    if (value.preset && value.preset !== 'CUSTOM') return PRESETS.find(p => p.value === value.preset)?.label ?? placeholder;
    if (value.start && value.end) return `${fmt(value.start)} → ${fmt(value.end)}`;
    return placeholder;
  })();

  /* ── Size-dependent layout numbers ──────────────────────────────────── */
  const dims = compact
    ? { dropdownWidth: 480, sidebarWidth: 124, bodyPad: '10px 14px', sideTitlePad: '2px 6px 6px',
        presetPad: '5px 8px', presetFont: 11, footerPad: '8px 14px', dateFieldPad: '5px 9px',
        dateFieldFont: 12, gapBetweenCals: 14, gapBetweenFields: 10 }
    : { dropdownWidth: 700, sidebarWidth: 160, bodyPad: '16px 20px', sideTitlePad: '4px 8px 8px',
        presetPad: '7px 10px', presetFont: 13, footerPad: '12px 20px', dateFieldPad: '7px 12px',
        dateFieldFont: 13, gapBetweenCals: 24, gapBetweenFields: 16 };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', fontFamily: "'Inter','system-ui',sans-serif" }}>
      <style>{`
        .drp-preset:hover { background: var(--gray-100) !important; }
        .drp-preset.active { background: var(--primary) !important; color: #fff !important; }
        .drp-cancel:hover { background: var(--gray-100) !important; }
        .drp-apply:hover  { background: var(--primary-hover) !important; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>

      {/* ── Trigger button — shares .filter-chip with AccountFilter ───── */}
      <button
        className={`filter-chip${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        style={compact ? undefined : { height: 38, fontSize: 14 }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalIcon small={compact} />
        {prefixLabel && <span className="filter-chip-prefix">{prefixLabel}</span>}
        {activeLabel}
        <ChevronIcon open={open} />
      </button>

      {/* ── Dropdown ──────────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'absolute', zIndex: 'var(--z-dropdown)', marginTop: 6,
          [align === 'right' ? 'right' : 'left']: 0,
          background: 'var(--surface)', borderRadius: 10,
          border: '1px solid var(--border-color)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.14)',
          display: 'flex', flexDirection: 'column',
          minWidth: dims.dropdownWidth,
          overflow: 'hidden',
        }}>

          {/* Main body: sidebar + calendars */}
          <div style={{ display: 'flex' }}>

            {/* ── Preset sidebar ──────────────────────────────────────── */}
            <div style={{
              width: dims.sidebarWidth, borderRight: '1px solid var(--border-subtle)',
              padding: compact ? '8px 6px' : '12px 8px', display: 'flex', flexDirection: 'column', gap: 1,
              maxHeight: compact ? 400 : 'none', overflowY: compact ? 'auto' : 'visible',
            }}>
              {PRESET_GROUPS.map((group, gi) => (
                <div key={group.title ?? gi} style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: gi === 0 ? 0 : 6 }}>
                  {group.title && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: dims.sideTitlePad }}>{group.title}</div>
                  )}
                  {group.items.map(p => (
                    <button
                      key={p.value}
                      className={`drp-preset${preset === p.value ? ' active' : ''}`}
                      onClick={() => applyPreset(p.value)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: dims.presetPad, border: 'none', borderRadius: 5,
                        cursor: 'pointer', fontSize: dims.presetFont,
                        background: preset === p.value ? 'var(--primary)' : 'transparent',
                        color: preset === p.value ? '#fff' : 'var(--gray-700)',
                        fontWeight: preset === p.value ? 700 : 400,
                        transition: 'background 0.12s',
                        fontFamily: 'inherit',
                        lineHeight: 1.3,
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              ))}

              {/* Last N days custom input */}
              <div style={{ marginTop: 6, padding: '5px 6px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Last</span>
                  <input
                    type="number" min={1} value={customN}
                    onChange={e => setCustomN(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && applyCustomN()}
                    placeholder="N"
                    style={{
                      width: 32, border: '1.5px solid var(--border-color)', borderRadius: 4,
                      padding: '2px 4px', fontSize: 11, textAlign: 'center',
                      outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Days</span>
                </div>
              </div>
            </div>

            {/* ── Calendars ───────────────────────────────────────────── */}
            <div style={{ flex: 1, padding: dims.bodyPad }}>

              {/* Date inputs */}
              <div style={{ display: 'flex', gap: dims.gapBetweenFields, marginBottom: 10 }}>
                {/* Start */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>START DATE</div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    border: `1.5px solid ${picking === 'start' ? 'var(--primary)' : 'var(--border-color)'}`,
                    borderRadius: 7, padding: dims.dateFieldPad, background: 'var(--surface)',
                    cursor: 'pointer', fontSize: dims.dateFieldFont, color: selStart ? 'var(--text-main)' : 'var(--text-faint)',
                    fontWeight: selStart ? 600 : 400,
                    boxShadow: picking === 'start' ? '0 0 0 3px var(--primary-light)' : 'none',
                  }} onClick={() => setPicking('start')}>
                    <CalIcon small />
                    {selStart ? fmt(selStart) : 'Start date'}
                  </div>
                  {showTime && selStart && (
                    <TimeInput hours={startH} minutes={startM} onChange={(t,v) => t==='h' ? setStartH(v) : setStartM(v)} />
                  )}
                </div>

                {/* End */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>END DATE</div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    border: `1.5px solid ${picking === 'end' ? 'var(--primary)' : 'var(--border-color)'}`,
                    borderRadius: 7, padding: dims.dateFieldPad, background: 'var(--surface)',
                    cursor: 'pointer', fontSize: dims.dateFieldFont, color: selEnd ? 'var(--text-main)' : 'var(--text-faint)',
                    fontWeight: selEnd ? 600 : 400,
                    boxShadow: picking === 'end' ? '0 0 0 3px var(--primary-light)' : 'none',
                  }} onClick={() => setPicking('end')}>
                    <CalIcon small />
                    {selEnd ? fmt(selEnd) : 'End date'}
                  </div>
                  {showTime && selEnd && (
                    <TimeInput hours={endH} minutes={endM} onChange={(t,v) => t==='h' ? setEndH(v) : setEndM(v)} />
                  )}
                </div>
              </div>

              {/* Dual calendars */}
              <div style={{ display: 'flex', gap: dims.gapBetweenCals }}>
                <MonthCalendar
                  year={leftYear} month={leftMonth}
                  onMonthChange={navigateLeft}
                  start={selStart} end={selEnd} hovered={hovered}
                  onDayClick={handleDayClick}
                  onDayHover={d => { if (selStart && !selEnd) setHovered(d); }}
                />
                <div style={{ width: 1, background: 'var(--border-subtle)', flexShrink: 0 }} />
                <MonthCalendar
                  year={rightYear} month={rightMonth}
                  onMonthChange={navigateRight}
                  start={selStart} end={selEnd} hovered={hovered}
                  onDayClick={handleDayClick}
                  onDayHover={d => { if (selStart && !selEnd) setHovered(d); }}
                />
              </div>
            </div>
          </div>

          {/* ── Footer ────────────────────────────────────────────────── */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
            gap: 8, padding: dims.footerPad,
            borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-2)',
          }}>
            {selStart && selEnd && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 'auto' }}>
                {fmt(selStart)} → {fmt(selEnd)}
              </span>
            )}
            <button className="drp-cancel" onClick={handleCancel} style={{
              padding: compact ? '5px 14px' : '7px 20px', border: '1.5px solid var(--border-color)', borderRadius: 7,
              background: 'var(--surface)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              color: 'var(--gray-700)', transition: 'background 0.12s', fontFamily: 'inherit',
            }}>Cancel</button>
            <button className="drp-apply" onClick={handleApply} style={{
              padding: compact ? '5px 16px' : '7px 22px', border: 'none', borderRadius: 7,
              background: 'var(--primary)', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              color: '#fff', transition: 'background 0.12s', fontFamily: 'inherit',
              boxShadow: '0 2px 8px rgba(79,70,229,0.35)',
            }}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Icon helpers ──────────────────────────────────────────────────────── */
function CalIcon({ small }) {
  const s = small ? 12 : 15;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" style={{ color: 'var(--text-faint)' }} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="13" rx="2"/>
      <path d="M1 6h14M5 1v2M11 1v2"/>
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg width={11} height={11} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
      <path d="M2 4l4 4 4-4"/>
    </svg>
  );
}