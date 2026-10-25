// Workspace editing is separate from server/user administration.
export function canEditWorkspace(role) {
  return role === 'Admin' || role === 'User';
}
