// Recognize explicit GPay import annotations, not arbitrary merchant text.
export function getGPayContext(note) {
  if (typeof note !== 'string') return [];
  return note.split(/\s+\|\s+|\r?\n/).map(value => value.trim())
    .filter(value => /^(?:GPay(?:\s+(?:Sent|Paid|Received))?:|Google Pay earned reward\b)/i.test(value))
    .map(text => ({ text, sourceId: text.match(/\(Ref:\s*([^)]+)\)/i)?.[1]?.trim() || text.match(/;\s*source\s+([^;]+);/i)?.[1]?.trim() || null }));
}
