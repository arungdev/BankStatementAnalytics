import { FiEyeOff, FiLock } from "react-icons/fi";
import { Badge, Switch } from "@common/client";

export default function PrivacySettings({ SettingCard, maskAmounts, maskNamesEnabled, setMaskAmounts, setMaskNamesEnabled }) {
  return (<div className="settings-stack">
      <SettingCard
        anchor="privacy-amounts"
        icon={<FiEyeOff size={18} />}
        title="Hide amounts"
        status={maskAmounts ? <Badge variant="green">On</Badge> : null}
        description="Masks every rupee value on screen. The eye icon in any page header flips this same switch."
        control={
          <Switch checked={maskAmounts} onChange={setMaskAmounts} label="Hide amounts" />
        }
      />

      <SettingCard
        anchor="privacy-names"
        icon={<FiLock size={18} />}
        title="Also hide merchant names"
        description={'Reduces merchant and bill names to their first letter (e.g. "S•••") across transactions, merchants, bills and insights.'}
        control={
          <Switch checked={maskNamesEnabled} onChange={setMaskNamesEnabled} label="Also hide merchant names" />
        }
      >
        {maskNamesEnabled && !maskAmounts && (
          <p className="setting-note">Takes effect as soon as “Hide amounts” is on.</p>
        )}
      </SettingCard>
    </div>);
}
