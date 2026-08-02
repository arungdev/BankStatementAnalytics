import { useMemo } from 'react';
import { getToken, useChartTheme as useSharedChartTheme } from '@common/client';

// Chart colors resolved from CSS tokens at render time. The generic slots
// (palette, grid, ticks, tooltip) come from @common/client; the income/spend
// pair is this app's own — those tokens are defined in index.css because they
// only mean something for a finance app.
export { getToken };

export function useChartTheme() {
  const shared = useSharedChartTheme();

  return useMemo(() => ({
    ...shared,
    income: getToken('chart-income'),
    spend: getToken('chart-spend'),
  }), [shared]);
}
