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

// Module-level flag kept in sync by PrivacyProvider so non-React consumers
// (chart tooltip callbacks, desktop notifications) also honour masking.
let amountsMasked = false;
export const setAmountMasking = (on) => { amountsMasked = !!on; };
export const isAmountMasked = () => amountsMasked;

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
