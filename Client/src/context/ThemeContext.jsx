/* eslint-disable react-refresh/only-export-components */
import { createContext, useEffect, useMemo, useState } from 'react';
import usePersistedState from '../hooks/usePersistedState';

export const ThemeContext = createContext(null);

const THEME_COLORS = { light: '#4f46e5', dark: '#0f1117' };

// Discrete text-size steps surfaced in Settings → Appearance. The value is the
// multiplier applied to every --text-* token (and the body base) via --font-scale.
export const FONT_SIZE_OPTIONS = [
  { id: 'small', label: 'Small', scale: 0.9 },
  { id: 'default', label: 'Default', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.1 },
  { id: 'xlarge', label: 'Extra large', scale: 1.2 },
];

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  // 'system' | 'light' | 'dark'
  const [preference, setPreference] = usePersistedState('themePreference', 'system');
  const [system, setSystem] = useState(systemTheme);

  // 'small' | 'default' | 'large' | 'xlarge' — drives --font-scale globally.
  const [fontSize, setFontSize] = usePersistedState('fontSizePreference', 'default');

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystem(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme = preference === 'system' ? system : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
  }, [theme]);

  useEffect(() => {
    const opt = FONT_SIZE_OPTIONS.find(o => o.id === fontSize) ?? FONT_SIZE_OPTIONS[1];
    document.documentElement.style.setProperty('--font-scale', String(opt.scale));
  }, [fontSize]);

  const value = useMemo(
    () => ({ theme, preference, setPreference, fontSize, setFontSize }),
    [theme, preference, setPreference, fontSize, setFontSize]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
