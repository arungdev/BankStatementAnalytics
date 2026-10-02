import api from "./client";

// Get all confirmed/created split groups
export const getSplitGroups = () => api.get("/split-groups");

// Get auto-detected GPay / UPI split candidate clusters
export const getSplitSuggestions = () => api.get("/split-groups/suggestions");

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
