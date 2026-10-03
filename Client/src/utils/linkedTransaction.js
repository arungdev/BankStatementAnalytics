export function findLinkedTransaction(rows, link) {
  const matches = rows.filter(row =>
    Number(row.accountId) === Number(link.accountId)
    && row.bankReference === link.bankReference
    && row.bankType === link.bankType
    && (!link.transactionType || (row.transactionType
      || (row.credit > 0 ? 'CR' : 'DR')) === link.transactionType));
  if (matches.length !== 1) throw new Error(matches.length
    ? 'More than one transaction matches this reference. Please review the bank statement.'
    : 'This linked transaction is no longer available. It may have been removed with a statement.');
  return matches[0];
}
