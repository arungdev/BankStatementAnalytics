import { FiAlertCircle, FiGithub, FiExternalLink, FiLock, FiZap } from "react-icons/fi";

export default function HelpSettings({ GITHUB_REPO, SettingCard, newIssueUrl }) {
  return (<div className="settings-stack">
      <SettingCard
        anchor="issue-bug"
        icon={<FiAlertCircle size={18} />}
        title="Report a problem"
        description="A statement that parsed wrong, a page that errored, a number that looks off — this opens a bug report with the details already laid out."
        control={
          <a className="btn primary small" href={newIssueUrl('bug')} target="_blank" rel="noopener noreferrer">
            <FiGithub size={15} /> Report a bug <FiExternalLink size={13} />
          </a>
        }
      >
        <p className="setting-note danger">
          <FiLock size={14} />
          Issues on GitHub are public. Strip account numbers, balances and merchant names out of
          anything you paste or screenshot — a redacted example still shows the problem.
        </p>
      </SettingCard>

      <SettingCard
        anchor="issue-feature"
        icon={<FiZap size={18} />}
        title="Suggest a feature"
        description="Missing a bank, a chart, or a way to slice your spending? Ask for it — feature requests go in the same place."
        control={
          <a className="btn small" href={newIssueUrl('feature')} target="_blank" rel="noopener noreferrer">
            <FiGithub size={15} /> Request a feature <FiExternalLink size={13} />
          </a>
        }
      />

      <SettingCard
        anchor="issue-browse"
        icon={<FiGithub size={18} />}
        title="Browse existing issues"
        description="Worth a look first — your problem may already be reported, and you can follow that one for updates instead of opening a duplicate."
        control={
          <a className="btn small" href={`${GITHUB_REPO}/issues`} target="_blank" rel="noopener noreferrer">
            Open on GitHub <FiExternalLink size={13} />
          </a>
        }
      />
    </div>);
}
