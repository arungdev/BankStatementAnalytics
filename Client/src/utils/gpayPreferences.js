export function gpayPreferenceKey(name, profileId) {
  const base = `bsp_gpay_${name}`;
  return !profileId || ['default', 'all', 'custom'].includes(profileId) ? base : `${base}:${profileId}`;
}

export function readGPayPreference(name, profileId, fallback) {
  return localStorage.getItem(gpayPreferenceKey(name, profileId)) ?? fallback;
}
