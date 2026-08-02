import { useEffect } from "react";
import { showDesktopNotification } from "@common/client";
import api from "../api/client";
import { getAutoImports } from "../api/statements";
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

// Auto-import failures already notified, as one capped list rather than a key per
// failure: a watch folder that keeps rejecting the same file gets a fresh
// CreatedAt (and so a fresh key) on every retry, which would grow without bound.
const NOTIFIED_IMPORTS_KEY = "notify.importsNotified";
const NOTIFIED_IMPORTS_CAP = 100;

// Same identity the bell uses (NotificationBell.notificationKey): the retry endpoint
// refreshes CreatedAt, so a retry that fails again is a new, notifiable failure.
const importKey = (h) => `import.${h.id}.${h.createdAt}`;

const loadNotifiedImports = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIFIED_IMPORTS_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

const saveNotifiedImports = (set) => {
  localStorage.setItem(
    NOTIFIED_IMPORTS_KEY,
    JSON.stringify([...set].slice(-NOTIFIED_IMPORTS_CAP))
  );
};

/**
 * Fires a desktop toast for each watch-folder import that failed, once per attempt.
 * Polled rather than fired once on load: the backend sweeps every 60s
 * (WatchFolderImportService.SweepInterval), so a failure usually happens while the
 * app is already open and would otherwise sit silently in the bell until a reload.
 */
export function useImportFailureNotifications() {
  useEffect(() => {
    if (!remindersEnabled()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    let cancelled = false;

    const check = async () => {
      let failures;
      try {
        const res = await getAutoImports();
        failures = (res.data || []).filter((h) => h.status === "Failed");
      } catch {
        return; // offline or restarting — try again on the next tick
      }
      if (cancelled) return;

      const notified = loadNotifiedImports();
      for (const h of failures) {
        const key = importKey(h);
        if (notified.has(key)) continue;
        // Mark before awaiting so overlapping ticks can't double-notify.
        notified.add(key);
        saveNotifiedImports(notified);
        showDesktopNotification("Statement import failed", `${h.fileName} — ${h.error || "see the app for details"}`, key)
          .then((res2) => {
            if (!res2.ok) {
              const back = loadNotifiedImports();
              back.delete(key);
              saveNotifiedImports(back);
            }
          });
      }
    };

    check();
    const timer = setInterval(check, 60_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
}
