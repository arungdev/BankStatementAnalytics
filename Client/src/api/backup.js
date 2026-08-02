import api from "./client";

// Whether backup is available on this deployment, plus the sizes shown before downloading.
export const getBackupStatus = () => api.get("/backup/status");

// The zip is fetched as a blob (so the session cookie applies) and handed to the browser as a
// normal file download, the same way the report PDF is. Returns the filename that was saved.
export const downloadBackup = async () => {
  const res = await api.get("/backup/download", { responseType: "blob" });

  // Prefer the server's timestamped name from Content-Disposition; fall back to our own.
  const disposition = res.headers["content-disposition"] || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const fileName = match
    ? decodeURIComponent(match[1])
    : `BankStatementAnalytics-backup-${new Date().toISOString().slice(0, 10)}.zip`;

  const url = URL.createObjectURL(new Blob([res.data], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return fileName;
};

export const restoreBackup = (file, onUploadProgress) => {
  const formData = new FormData();
  formData.append("file", file);

  return api.post("/backup/restore", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    // A restore runs pg_restore over the whole database - well past axios's default timeout.
    timeout: 0,
    ...(typeof onUploadProgress === "function" ? { onUploadProgress } : {}),
  });
};

/**
 * Server errors arrive as a Blob on the download call (responseType: 'blob'), so the usual
 * err.response.data.message is an unreadable Blob rather than the JSON body. Unwraps either shape.
 */
export const readApiError = async (err, fallback) => {
  const data = err?.response?.data;
  try {
    if (data instanceof Blob) {
      const parsed = JSON.parse(await data.text());
      return parsed.message || fallback;
    }
  } catch {
    return fallback;
  }
  return data?.message || fallback;
};
