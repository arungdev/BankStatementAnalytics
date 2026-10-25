// Use local calendar dates: parsing ISO midnight as UTC can shift a statement day.
export function calendarDate(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(+match[1], +match[2] - 1, +match[3]);
  return date.getFullYear() === +match[1] && date.getMonth() === +match[2] - 1
    && date.getDate() === +match[3] ? date : null;
}
export const isCreditCard = account => account?.bankName === 'HDFCCreditCard';
export function billingDates(year, month, data) {
  const actual = (data?.statements ?? []).map(s => calendarDate(s.statementDate))
    .filter(d => d && d.getFullYear() === year && d.getMonth() === month);
  if (actual.length) return [...new Map(actual.map(d => [d.getTime(), d])).values()];
  const day = Number(data?.statementDay);
  return Number.isInteger(day) && day >= 1 && day <= 31
    ? [new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()))] : [];
}
export function billingCycles(data, today = new Date()) {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const boundaries = [];
  for (let offset = -3; offset <= 2; offset++) {
    const month = new Date(date.getFullYear(), date.getMonth() + offset, 1);
    boundaries.push(...billingDates(month.getFullYear(), month.getMonth(), data));
  }
  boundaries.sort((a, b) => a - b);
  const nextIndex = boundaries.findIndex(d => d > date);
  if (nextIndex < 2) return null;
  const previous = boundaries[nextIndex - 1], upcoming = boundaries[nextIndex];
  const cycle = (before, end) => {
    const actual = data?.statements?.find(s => calendarDate(s.statementDate)?.getTime() === end.getTime());
    const start = new Date(before); start.setDate(start.getDate() + 1);
    return { start: calendarDate(actual?.periodStart) ?? start, end: calendarDate(actual?.periodEnd) ?? end };
  };
  return { previous, upcoming, current: cycle(previous, upcoming),
    last: cycle(boundaries[nextIndex - 2], previous) };
}
