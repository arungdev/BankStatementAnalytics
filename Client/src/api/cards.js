import api from "./client";

// Credit-card-only endpoints (404 for non-CC accounts).

// Latest parsed statement summary + utilization + current billing cycle
export const getCardSummary = (accountId) =>
  api.get(`/cards/${accountId}/summary`);

// Spend per billing cycle, oldest first, ending with the current (partial) cycle
export const getCardCycles = (accountId, count = 6) =>
  api.get(`/cards/${accountId}/cycles`, { params: { count } });

// Manual fallback for credit limit / statement day
export const updateCardSettings = (accountId, body) =>
  api.put(`/cards/${accountId}/settings`, body);

// Unpaid card bills due soon — same item shape as /bills/upcoming
export const getCardReminders = (withinDays = 7) =>
  api.get("/cards/upcoming", { params: { withinDays } });
