import { FiSun, FiType } from "react-icons/fi";
import { FONT_SIZE_OPTIONS } from "@common/client";

export default function AppearanceSettings({ SettingCard, THEME_OPTIONS, fontSize, preference, setFontSize, setPreference }) {
  return (<div className="settings-stack">
      <SettingCard
        anchor="theme"
        icon={<FiSun size={18} />}
        title="Theme"
        description="Applies instantly and is remembered on this device."
      >
        <div className="choice-grid" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.id}
              role="radio"
              aria-checked={preference === opt.id}
              className={`choice-tile${preference === opt.id ? ' active' : ''}`}
              onClick={() => setPreference(opt.id)}
            >
              <span className="choice-tile-icon">{opt.icon}</span>
              <span className="choice-tile-label">{opt.label}</span>
              <span className="choice-tile-sub">{opt.sub}</span>
            </button>
          ))}
        </div>
      </SettingCard>

      <SettingCard
        anchor="text-size"
        icon={<FiType size={18} />}
        title="Text size"
        description="Scales all text across the app — useful if the default feels small."
      >
        <div className="choice-grid compact" role="radiogroup" aria-label="Text size">
          {FONT_SIZE_OPTIONS.map(opt => (
            <button
              key={opt.id}
              role="radio"
              aria-checked={fontSize === opt.id}
              className={`choice-tile center${fontSize === opt.id ? ' active' : ''}`}
              onClick={() => setFontSize(opt.id)}
            >
              <span className="choice-tile-preview" style={{ fontSize: `${opt.scale}em` }}>Aa</span>
              <span className="choice-tile-label">{opt.label}</span>
            </button>
          ))}
        </div>
      </SettingCard>
    </div>);
}
