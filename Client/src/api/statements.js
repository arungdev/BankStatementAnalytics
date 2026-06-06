import api from "./client";

// Accounts
export const getAccounts = () => api.get("/statements/accounts");

// Transactions by account
export const getAccountTransactions = (id) =>
  api.get(`/statements/${id}`);

// Upload statement
export const uploadStatement = (accountId, file) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("accountId", accountId);

  return api.post("/statements/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
};