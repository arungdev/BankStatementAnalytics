import api from "./client";

// Get all confirmed/created split groups
export const getSplitGroups = (filter) => api.get("/split-groups", { params: filter ? { filter } : {} });

// Get auto-detected GPay / UPI split candidate clusters
export const getSplitSuggestions = () => api.get("/split-groups/suggestions");

// Fetch candidate transactions (type = 'debit' or 'credit') for picking from bank statement
export const getCandidateTransactions = (type, search) =>
  api.get("/split-groups/transactions", { params: { type, search } });

// Get single split group detail
export const getSplitGroupById = (id) => api.get(`/split-groups/${id}`);

// Create a split group (manual or from an auto-detected candidate)
export const createSplitGroup = (data) => api.post("/split-groups", data);

// Update a split group (title, total, user share, status)
export const updateSplitGroup = (id, data) => api.put(`/split-groups/${id}`, data);

// Add a participant and assign split amount
export const addSplitMember = (groupId, data) => api.post(`/split-groups/${groupId}/members`, data);

// Update participant's assigned split amount or settlement status
export const updateSplitMember = (groupId, memberId, data) =>
  api.put(`/split-groups/${groupId}/members/${memberId}`, data);

// Link a bank transaction to a participant's assigned split amount
export const linkTransactionToMember = (groupId, memberId, data) =>
  api.post(`/split-groups/${groupId}/members/${memberId}/link-transaction`, data);

// Unlink bank transaction from a participant's assigned split amount
export const unlinkTransactionFromMember = (groupId, memberId) =>
  api.post(`/split-groups/${groupId}/members/${memberId}/unlink-transaction`);

// Delete participant from a split group
export const deleteSplitMember = (groupId, memberId) =>
  api.delete(`/split-groups/${groupId}/members/${memberId}`);

// Delete a split group
export const deleteSplitGroup = (id) => api.delete(`/split-groups/${id}`);

// ── Smart Participant Suggestions ──
export const getParticipantSuggestions = (query = '') =>
  api.get('/split-groups/participants/suggest', { params: { q: query } });

// ── Persistent GPay-Style Bill Groups ──
export const getBillGroups = () => api.get('/split-groups/bill-groups');
export const getBillGroupById = (id) => api.get(`/split-groups/bill-groups/${id}`);
export const createBillGroup = (data) => api.post('/split-groups/bill-groups', data);
export const updateBillGroup = (id, data) => api.put(`/split-groups/bill-groups/${id}`, data);
export const deleteBillGroup = (id) => api.delete(`/split-groups/bill-groups/${id}`);
export const addBillGroupMember = (groupId, data) =>
  api.post(`/split-groups/bill-groups/${groupId}/members`, data);
export const removeBillGroupMember = (groupId, memberId) =>
  api.delete(`/split-groups/bill-groups/${groupId}/members/${memberId}`);

// ── Google Pay Takeout Import ──
export const getTakeoutStatus = () => api.get('/split-groups/import-takeout/status');
export const importTakeoutPath = (filePath, expectedArchiveHash) => api.post('/split-groups/import-takeout-path', { filePath, expectedArchiveHash });
export const importTakeoutUpload = (formData) =>
  api.post('/split-groups/import-takeout', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

// ── Google Pay Auto-Import (Watch Folder) ──
export const getGPayAutoImportConfig = () => api.get('/split-groups/auto-import');
export const updateGPayAutoImportConfig = (data) => api.put('/split-groups/auto-import', data);
export const triggerGPayAutoImportSweep = () => api.post('/split-groups/auto-import/sweep');
