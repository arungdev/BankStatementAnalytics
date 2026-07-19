import api from "./client";

// Accounts
export const getAccounts = () => api.get("/statements/accounts");

// Transactions by account
export const getAccountTransactions = (id) => api.get(`/statements/${id}`);

// Upload statement (password: optional, for protected PDF statements)
export const uploadStatement = (accountId, file, onUploadProgress, password) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("accountId", accountId);
  if (password) formData.append("password", password);

  const config = {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  };

  if (typeof onUploadProgress === "function") {
    config.onUploadProgress = onUploadProgress;
  }

  return api.post("/statements/upload", formData, config);
};

// Revert (delete) uploaded statement by id
export const revertStatement = (id) => {
  if (!id) return Promise.reject(new Error("Missing statement id"));
  return api.delete(`/statements/upload/${id}`);
};

// Get all uploads
export const getUploads = () => api.get("/statements/uploads");

// Watch-folder auto-import attempts, including failures (which leave no upload row)
export const getAutoImports = (accountId) =>
  api.get("/statements/auto-imports", { params: accountId ? { accountId } : {} });

// Run the watch-folder sweep now instead of waiting for the next interval
export const triggerAutoImportSweep = () => api.post("/statements/auto-imports/sweep");
