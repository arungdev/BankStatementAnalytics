import api from "./client";

/**
 * Reads current network access settings, local IP addresses, and URLs.
 */
export async function getNetworkAccessStatus() {
  const { data } = await api.get("/network-access/status");
  return data;
}

/**
 * Updates local network access (enable or disable). Requires admin role.
 */
export async function updateNetworkAccessStatus(enabled) {
  const { data } = await api.post("/network-access/status", { enabled });
  return data;
}
