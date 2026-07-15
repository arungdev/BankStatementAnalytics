import { useMemo } from 'react';
import useTheme from '../context/useTheme';

// Read a CSS custom property off the root element — the token blocks in
// index.css stay the single source of truth for chart colors.
export function getToken(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--${name}`)
    .trim();
}

// Theme-aware colors for chart.js / recharts, which consume JS values.
// chart.js consumers must include `theme` in the useMemo deps that build
// data/options (and pass key={theme}) so a toggle triggers a clean redraw.
export function useChartTheme() {
  const { theme } = useTheme();

  return useMemo(() => ({
    theme,
    palette: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => getToken(`chart-${i}`)),
    income: getToken('chart-income'),
    spend: getToken('chart-spend'),
    grid: getToken('chart-grid'),
    axisTick: getToken('chart-tick'),
    tooltipBg: theme === 'dark' ? getToken('surface-2') : getToken('gray-900'),
    tooltipText: theme === 'dark' ? getToken('text-main') : '#ffffff',
  }), [theme]);
}
