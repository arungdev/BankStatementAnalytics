import api from "./client";

export const getUpdateStatus = () => api.get("/update/status");

export const checkForUpdates = () => api.post("/update/check");

export const downloadUpdate = () => api.post("/update/download");

export const cancelDownload = () => api.post("/update/cancel-download");

export const applyUpdate = (silent = true) => api.post("/update/apply", { silent });

export const downloadUpdateBinary = async () => {
  const res = await api.get("/update/download-file", { responseType: "blob" });

  const disposition = res.headers["content-disposition"] || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const fileName = match
    ? decodeURIComponent(match[1])
    : "BankStatementAnalytics-Setup.exe";

  const url = URL.createObjectURL(new Blob([res.data], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return fileName;
};
