// Legacy imports already store these source markers; no reimport is needed.
export const isImportedGPayExpense = expense =>
  !!expense?.sourceKey || expense?.description?.startsWith('Google Pay expense created by ') === true;

export const isImportedGPayGroup = group =>
  /^Google Pay Group \(\d+ expenses?\)$/.test(group?.description || '')
  || (group?.splits || []).some(isImportedGPayExpense);

// Imported expenses can contain participants absent from the saved group roster.
// Keep this display list separate from editable members, which need database IDs.
export function getGroupDisplayMembers(group) {
  const members = [];
  const normalize = value => (value || '').trim().toLowerCase();

  const add = (name, vpa, isUser = false) => {
    const cleanName = (name || '').trim();
    if (!cleanName && !isUser) return;
    const existing = members.find(member =>
      (isUser && member.isUser)
      || (normalize(vpa) && normalize(member.vpa) === normalize(vpa))
      || (cleanName && normalize(member.name) === normalize(cleanName)));
    if (existing) {
      existing.isUser ||= isUser;
      existing.vpa ||= vpa;
      return;
    }
    members.push({ name: cleanName || 'You', vpa, isUser });
  };

  for (const member of group.members || []) add(member.name, member.vpa);
  for (const split of group.splits || []) {
    for (const member of split.members || []) {
      add(member.participantName, member.participantVpa, member.isUser);
    }
  }
  return members;
}
