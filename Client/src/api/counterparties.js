import api from "./client";

export const getCounterParty = (id) =>
  api.get(`/counterparties/${id}`);