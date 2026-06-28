import { useState } from 'react';
import Header from '../components/Header';
import Trends from '../pages/Trends';
import { TrendsHeader } from '../pages/Trends';

export default function TrendsLayout() {
  const [period, setPeriod]       = useState('week');
  const [dateRange, setDateRange] = useState({ start: null, end: null, preset: 'ALL', label: 'All Time' });

  return (
    <>
      <Header>
        <TrendsHeader
          period={period}
          setPeriod={setPeriod}
          dateRange={dateRange}
          setDateRange={setDateRange}
        />
      </Header>

      <Trends
        period={period}
        dateRange={dateRange}
      />
    </>
  );
}