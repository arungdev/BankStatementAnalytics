import { useState, useEffect } from "react";
import api from "../../api/client";
import { FilterGroup, FilterPill, FilterDropdownChip } from "../../components/PageHeader";
import { FiCalendar } from "react-icons/fi";



export default function ReportsFilters({ reportType, setReportType, reportPeriod, setReportPeriod }) {
  const [periods, setPeriods] = useState({ months: [], years: [] });

  useEffect(() => {
    api.get('/reports/periods')
      .then(res => setPeriods(res.data || { months: [], years: [] }))
      .catch(() => setPeriods({ months: [], years: [] }));
  }, []);

  // Months render under a per-year header with month-only rows; the trigger
  // still shows the full "June 2026" label. Years stay a flat list.
  const options = (reportType === 'year' || reportType === 'annual')
    ? (periods.years || []).map(y => ({ value: String(y), label: String(y) }))
    : (periods.months || []).map(m => ({
        value: `${m.year}-${m.month}`,
        label: m.label,
        menuLabel: new Date(m.year, m.month - 1, 1).toLocaleString('en-US', { month: 'long' }),
        group: String(m.year),
      }));

  // Keep the selection valid for the active type (e.g. after toggling Month ↔ Year).
  useEffect(() => {
    if (options.length === 0) return;
    if (!options.some(o => o.value === reportPeriod))
      setReportPeriod(options[0].value);
  }, [options, reportPeriod, setReportPeriod]);

  return (
    <>
      <FilterGroup label="Report">
        <FilterPill active={reportType === 'month'} onClick={() => setReportType('month')}>
          Monthly
        </FilterPill>
        <FilterPill active={reportType === 'year'} onClick={() => setReportType('year')}>
          Yearly
        </FilterPill>
        <FilterPill active={reportType === 'annual'} onClick={() => setReportType('annual')}>
          Year-in-Review
        </FilterPill>
      </FilterGroup>

      <FilterGroup style={{ position: 'relative', zIndex: 'var(--z-dropdown)' }}>
        <FilterDropdownChip
          prefix="Period"
          icon={<FiCalendar size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />}
          value={reportPeriod}
          options={options}
          onSelect={setReportPeriod}
          placeholder="No data"
        />
      </FilterGroup>
    </>
  );
}
