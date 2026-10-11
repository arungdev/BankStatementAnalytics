export const isInstallingUpdate = (status) => status?.state === "Installing" || status?.state === 6;

const normalizeVersion = (version) => typeof version === "string"
  ? version.trim().replace(/^v/i, "").split("+")[0]
  : null;

export function getUpdateOutcome(status, restart, now = Date.now()) {
  if (!restart) return "idle";
  const target = normalizeVersion(restart.target);
  const current = normalizeVersion(status?.updateInfo?.currentVersion);
  if (!isInstallingUpdate(status) && target && current === target) return "complete";
  if (status?.state === "Failed" || status?.state === "Error") return "failed";
  return now - restart.startedAt >= 180000 ? "timeout" : "waiting";
}
