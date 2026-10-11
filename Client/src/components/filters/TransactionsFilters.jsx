import { FilterGroup } from "../../components/PageHeader";
import DateRangePicker from "../../components/Daterangepicker";



export default function TransactionsFilters({ dateRange, setDateRange }) {
  return (
    <FilterGroup style={{ position: 'relative', zIndex: 500 }}>
      <DateRangePicker
        value={dateRange}
        onChange={setDateRange}
        showTime={false}
        align="left"
        placeholder="All Time"
      />
    </FilterGroup>
  );
}
