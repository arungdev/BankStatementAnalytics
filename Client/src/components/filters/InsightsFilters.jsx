import { FilterGroup, FilterPill } from "../../components/PageHeader";
import DateRangePicker from "../../components/Daterangepicker";

const GROUP_TABS = [
  { key: 'byCategory', label: 'Categories', singular: 'Category' },
  { key: 'byMerchant', label: 'Merchants',  singular: 'Merchant'  },
  { key: 'byTag',      label: 'Tags',       singular: 'Tag'       },
  { key: 'byForex',    label: 'Forex / Intl', singular: 'Currency' },
];

export default function InsightsFilters({
  range, setRange,
  groupBy, setGroupBy,
}) {
  return (
    <>
      {/* Period */}
      <FilterGroup style={{ position: 'relative', zIndex: 'var(--z-dropdown)' }}>
        <DateRangePicker
          value={range}
          onChange={setRange}
          showTime={false}
          align="left"
          placeholder="All Time"
        />
      </FilterGroup>

      {/* Group by */}
      <FilterGroup label="Group by">
        {GROUP_TABS.map(g => (
          <FilterPill key={g.key} active={groupBy === g.key} onClick={() => setGroupBy(g.key)}>
            {g.label}
          </FilterPill>
        ))}
      </FilterGroup>
    </>
  );
}
