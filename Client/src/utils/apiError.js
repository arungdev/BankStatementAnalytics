/**
 * Turns an axios error into a string that is safe to show a user.
 *
 * `err.response.data` is only a plain sentence when a controller returned one. It is
 * also: undefined when the request never reached the server, "" when the rate limiter
 * rejects with an empty 429 body, a ProblemDetails *object* on model-binding failures,
 * and a whole page of HTML when an unhandled 500 falls through to the SPA fallback.
 * Rendering those verbatim is misleading at best, and an object thrown straight into
 * JSX crashes the page - React cannot render an object as a child.
 */
export function apiErrorMessage(err, fallback = "Something went wrong. Please try again.") {
  // No response at all - the server is down, unreachable, or the request timed out.
  // Never fall back to a credential/validation message here: the user's input was fine.
  if (err && !err.response) {
    return err.code === "ECONNABORTED" || err.code === "ETIMEDOUT"
      ? "The server took too long to respond. Please try again."
      : "Can't reach the server. Check that it's running and try again.";
  }

  return readable(err?.response?.data) || fallback;
}

/** Pulls a short, human sentence out of a response body, or null if there isn't one. */
function readable(data) {
  if (typeof data === "string") {
    const text = data.trim();
    // Anything markup-shaped or essay-length is a framework/proxy page, not a message for us.
    if (!text || text.startsWith("<") || text.length > 300) return null;
    return text;
  }

  if (data && typeof data === "object") {
    // ProblemDetails (title/detail) and this app's { message } error bodies.
    const direct = data.message ?? data.detail ?? data.title;
    if (typeof direct === "string" && direct.trim()) return direct.trim();

    // ValidationProblemDetails: { errors: { Field: ["msg", ...] } }
    const first = Object.values(data.errors ?? {}).flat().find(m => typeof m === "string" && m.trim());
    if (first) return first.trim();
  }

  return null;
}
