/**
 * Deterministic avatar colours + initials, derived from a name so a given
 * merchant / counterparty always renders in the same colour across the app.
 */

const PALETTE = [
  ['#eef2ff', '#4f46e5'],
  ['#ecfeff', '#0891b2'],
  ['#f0fdf4', '#16a34a'],
  ['#fef2f2', '#dc2626'],
  ['#fffbeb', '#d97706'],
  ['#faf5ff', '#9333ea'],
  ['#fdf2f8', '#db2777'],
  ['#eff6ff', '#2563eb'],
  ['#f0fdfa', '#0d9488'],
];

const hashCode = (str = '') => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const avatarColors = (name) => PALETTE[hashCode(name || '?') % PALETTE.length];

export const initials = (name = '') => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
