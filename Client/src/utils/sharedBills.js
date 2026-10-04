export function sharedBillReportRange(type, period) {
  if (type === 'year' || type === 'annual') {
    return /^\d{4}$/.test(period) ? { startDate: `${period}-01-01`, endDate: `${period}-12-31` } : null;
  }
  if (type !== 'month' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return null;
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { startDate: `${period}-01`, endDate: `${period}-${lastDay}` };
}
