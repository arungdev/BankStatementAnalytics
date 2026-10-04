// Recognize explicit GPay import annotations, not arbitrary merchant text.
const isGPayAnnotation = text => /^(?:GPay(?:\s+(?:Sent|Paid|Received))?:|Google Pay earned reward\b)/i.test(text);

export function getGPayContext(note) {
  if (typeof note !== 'string') return [];
  return note.split(/\s+\|\s+|\r?\n/).map(value => value.trim())
    .filter(isGPayAnnotation)
    .map(text => ({ text, sourceId: text.match(/\(Ref:\s*([^)]+)\)/i)?.[1]?.trim() || text.match(/;\s*source\s+([^;]+);/i)?.[1]?.trim() || null }));
}

export function getPersonalTransactionNote(note) {
  if (typeof note !== 'string') return '';
  const parts = note.split(/(\s+\|\s+|\r?\n)/);
  let personal = '';
  for (let index = 0; index < parts.length; index += 2) {
    const text = parts[index].trim();
    if (!text || isGPayAnnotation(text)) continue;
    personal += (personal ? parts[index - 1] : '') + text;
  }
  return personal;
}

// Editing a personal note must retain the imported payment context and source IDs.
export function withPersonalTransactionNote(note, personalNote) {
  const personal = (personalNote ?? '').trim();
  if (personal === getPersonalTransactionNote(note)) return note || '';
  return [personal, ...getGPayContext(note).map(item => item.text)]
    .filter(Boolean).join(' | ');
}
