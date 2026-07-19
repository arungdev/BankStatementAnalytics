const intlCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
});

const intlCurrencyFull = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

export const MASKED_AMOUNT = '₹••••';

// Module-level flags kept in sync by PrivacyProvider so non-React consumers
// (chart tooltip callbacks, desktop notifications) also honour masking.
let amountsMasked = false;
export const setAmountMasking = (on) => { amountsMasked = !!on; };
export const isAmountMasked = () => amountsMasked;

// Name masking is opt-in via Settings → Privacy and only active while the
// privacy toggle (eye icon) is on; PrivacyProvider combines both flags.
let namesMasked = false;
export const setNameMasking = (on) => { namesMasked = !!on; };
export const isNameMasked = () => namesMasked;

// Reduces "Swiggy" to "S•••" while name masking is active; passes the value
// through untouched otherwise, so call sites can wrap unconditionally.
export const maskName = (name) => {
  if (!namesMasked || !name) return name;
  const first = String(name).trim().charAt(0).toUpperCase();
  return first ? `${first}•••` : name;
};

export const currencyFormatter = {
  format: (v) => (amountsMasked ? MASKED_AMOUNT : intlCurrency.format(v)),
};

export const currencyFormatterFull = {
  format: (v) => (amountsMasked ? MASKED_AMOUNT : intlCurrencyFull.format(v)),
};

export const formatDate = (dateString) => {
  const date = new Date(dateString);
  // Produces "03 Jun 2026"
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};
