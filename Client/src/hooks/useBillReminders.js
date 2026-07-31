import { useEffect } from "react";
import api from "../api/client";
import { currencyFormatter, maskName } from "../utils/format";

// localStorage keys (preferences are client-side; there is no per-user settings table).
export const REMINDERS_ENABLED_KEY = "bills.remindersEnabled";
export const REMINDER_WINDOW_KEY = "bills.reminderWindow";

export const remindersEnabled = () =>
  typeof window !== "undefined" && localStorage.getItem(REMINDERS_ENABLED_KEY) === "true";

export const reminderWindow = () => {
  const raw = typeof window !== "undefined" ? localStorage.getItem(REMINDER_WINDOW_KEY) : null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 7;
};

/**
 * Ensures notification permission is granted, requesting it if still undecided.
 * Returns the final permission string ("granted" | "denied" | "default" | "unsupported").
 */
export async function ensurePermission() {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
  return Notification.permission;
}

/**
 * Shows a desktop toast now. Returns { ok, reason } so callers can give feedback.
 * reason is one of: "unsupported" | "denied" | "default" | "error".
 */
export async function showDesktopNotification(title, body, tag) {
  const perm = await ensurePermission();
  if (perm !== "granted") return { ok: false, reason: perm === "unsupported" ? "unsupported" : perm };
  try {
    const n = new Notification(title, { body, tag, icon: "/icon-192.png", badge: "/favicon-32.png" });
    // Focus this tab if the user clicks the toast.
    n.onclick = () => { try { window.focus(); } catch { /* ignore */ } };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "error", error: String(e) };
  }
}

/**
 * Fires a sample reminder immediately — used by the "Send test notification" button.
 * Uses a unique tag each time so repeated clicks always pop a fresh toast (a reused tag
 * would silently replace the previous notification instead of re-alerting).
 */
export function sendTestNotification() {
  return showDesktopNotification(
    "Test reminder",
    "This is how your bill reminders will appear.",
    `bills.test.${Date.now()}`
  );
}

/**
 * On app load, fires a desktop toast (Web Notifications API) once per bill per due-cycle for
 * every confirmed bill due within the reminder window. De-duped via localStorage so the same
 * bill isn't re-notified on every page load.
 */
export default function useBillReminders() {
  useEffect(() => {
    if (!remindersEnabled()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    let cancelled = false;
    api
      .get(`/bills/upcoming?withinDays=${reminderWindow()}`)
      .then((res) => {
        if (cancelled) return;
        for (const bill of res.data || []) {
          const cycle = new Date(bill.nextDueDate);
          const dedupeKey = `bills.notified.${bill.id}.${cycle.getFullYear()}-${cycle.getMonth() + 1}`;
          if (localStorage.getItem(dedupeKey)) continue;

          const days = bill.daysUntilDue;
          const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
          showDesktopNotification(
            "Bill due soon",
            `${maskName(bill.name)} ${currencyFormatter.format(bill.expectedAmount)} due ${when}`,
            dedupeKey
          ).then((res2) => {
            if (res2.ok) localStorage.setItem(dedupeKey, "1");
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);
}
