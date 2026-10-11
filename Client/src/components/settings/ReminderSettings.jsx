import { FiBell, FiAlertCircle, FiClock } from "react-icons/fi";
import { Badge, Switch } from "@common/client";

export default function ReminderSettings({ REMINDER_PRESETS, SettingCard, handleTestNotification, notifPermission, remEnabled, remWindow, toggleReminders, updateWindow }) {
  return (<div className="settings-stack">
      <SettingCard
        anchor="reminders-enable"
        icon={<FiBell size={18} />}
        title="Desktop notifications"
        status={remEnabled ? <Badge variant="green">On</Badge> : null}
        description="Pops up a notification when a confirmed bill is due within your reminder window, and when a watch-folder statement fails to import. Notifications fire while the app is open."
        control={
          <>
            <button className="btn small" onClick={handleTestNotification}>Send test</button>
            <Switch
              checked={remEnabled}
              onChange={toggleReminders}
              label="Enable desktop notifications"
            />
          </>
        }
      >
        {notifPermission === 'denied' && (
          <p className="setting-note danger">
            <FiAlertCircle size={14} />
            Notifications are blocked in your browser. Allow them for this site (click the icon in the
            address bar), then turn this back on.
          </p>
        )}
        <p className="setting-note">
          Not seeing a toast? Turn off Focus assist / Do not disturb in Windows and make sure
          notifications are allowed for your browser — the toast may also be waiting in the Action Center.
        </p>
      </SettingCard>

      <SettingCard
        anchor="reminder-window"
        icon={<FiClock size={18} />}
        title="Reminder window"
        description="How many days ahead of the due date you want to be reminded."
      >
        <div className="segmented" role="group" aria-label="Reminder window presets">
          {REMINDER_PRESETS.map(d => (
            <button
              key={d}
              className={`segmented-option${remWindow === d ? ' active' : ''}`}
              aria-pressed={remWindow === d}
              onClick={() => updateWindow(d)}
            >
              {d} days
            </button>
          ))}
          <label className="segmented-custom">
            <span>Custom</span>
            <input
              type="number"
              min="1"
              max="31"
              value={remWindow}
              onChange={(e) => updateWindow(e.target.value)}
              className="field-input"
              aria-label="Reminder window in days"
            />
          </label>
        </div>
      </SettingCard>
    </div>);
}
