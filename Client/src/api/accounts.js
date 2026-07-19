import api from "./client";

// Configure the watch folder swept by the backend auto-importer for an account.
// body: { watchFolderPath, statementPassword } — password null = unchanged, "" = clear.
export const updateAutoImport = (accountId, body) =>
  api.put(`/accounts/${accountId}/auto-import`, body);

// Server-side folder browser for the auto-import folder picker.
// No path lists drives; otherwise lists that folder's subfolders.
export const browseFolders = (path) =>
  api.get("/accounts/browse-folders", { params: path ? { path } : {} });
