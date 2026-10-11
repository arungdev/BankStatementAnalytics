import { FilterGroup, FilterPill } from "../../components/PageHeader";
import DateRangePicker from "../../components/Daterangepicker";



export default function TrendsFilters({ period, setPeriod, dateRange, setDateRange, isCreditCard }) {
  const periods = ['day', 'week', 'month'];
  if (isCreditCard) periods.push('billing_month');
  return (
    <>
      <FilterGroup style={{ position: 'relative', zIndex: 500 }}>
        <DateRangePicker
          value={dateRange}
          onChange={setDateRange}
          showTime={false}
          align="left"
          placeholder="All Time"
        />
      </FilterGroup>

      <FilterGroup label="View">
        {periods.map(p => (
          <FilterPill key={p} active={period === p} onClick={() => setPeriod(p)}>
            {p === 'billing_month' ? 'Billing Month' : p.charAt(0).toUpperCase() + p.slice(1)}
          </FilterPill>
        ))}
      </FilterGroup>
    </>
  );
}
