import { createApiClient } from "@common/client";

// The app's single axios instance. Everything else imports this module, not
// the factory, so there is exactly one configured client.
// /setup joins /login as a public route: an unauthenticated visitor belongs
// there, so a 401 must not bounce them away from it.
const api = createApiClient({
  baseURL: "/api",
  loginPath: "/login",
  publicPaths: ["/login", "/setup"],
});

export default api;
