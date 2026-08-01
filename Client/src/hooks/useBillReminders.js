import { useEffect } from "react";
import { showDesktopNotification } from "@common/client";
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
