import { FiAlertCircle, FiCheckCircle, FiRefreshCw, FiZap, FiX, FiDownloadCloud, FiDownload, FiGithub, FiExternalLink } from "react-icons/fi";
import { Badge } from "@common/client";
import { formatDate } from "../../utils/format";

export default function UpdateSettings({ SettingCard, applyingUpdate, checkingUpdate, formatBytes, handleApplyUpdate, handleCancelDownload, handleCheckUpdate, handleDownloadUpdate, handleSaveFileDirectly, updateError, updateMessage, updateStatus }) {
    const info = updateStatus?.updateInfo;
    const currentVer = info?.currentVersion || '3.0.0';
    const latestVer = info?.latestVersion || currentVer;
    const isAvailable = !!info?.isUpdateAvailable;
    const state = updateStatus?.state;
    const isDownloading = state === 'Downloading' || state === 4;
    const isReady = state === 'ReadyToInstall' || state === 5;
    const isInstalling = state === 'Installing' || state === 6;
    const percent = updateStatus?.progressPercentage ?? 0;
    const bytesDownloaded = updateStatus?.bytesDownloaded ?? 0;
    const totalBytes = updateStatus?.totalBytes ?? 0;

    return (
      <div className="settings-stack">
        {updateError && (
          <p className="setting-note danger">
            <FiAlertCircle size={14} />
            {updateError}
          </p>
        )}

        {updateMessage && (
          <p className="setting-note" style={{ color: 'var(--success, #16a34a)', borderColor: 'var(--success-border, rgba(22, 163, 74, 0.2))' }}>
            <FiCheckCircle size={14} />
            {updateMessage}
          </p>
        )}

        {isInstalling && (
          <div className="card" style={{ padding: '20px', textAlign: 'center', borderColor: 'var(--primary)' }}>
            <FiRefreshCw size={28} className="spin" color="var(--primary)" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ margin: '0 0 6px', fontSize: '16px' }}>Upgrading Bank Statement Analytics...</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
              The application service is stopping, applying update files and database migrations, and restarting.
              This page will automatically reload once the server is back online.
            </p>
          </div>
        )}

        {/* Current status card */}
        <SettingCard
          anchor="updates-check"
          icon={<FiRefreshCw size={18} />}
          title={`Version v${currentVer}`}
          status={
            isAvailable
              ? <Badge variant="blue">Update available: v{latestVer}</Badge>
              : (state === 'Checking' ? <Badge variant="gray">Checking…</Badge> : <Badge variant="green">Up to date</Badge>)
          }
          description={
            isAvailable
              ? `A newer version (v${latestVer}) was released on ${info?.publishedAt ? formatDate(info.publishedAt) : 'GitHub'}. Upgrade to get the latest features and bug fixes.`
              : `You are running the latest version of Bank Statement Analytics. The app checks for new releases daily.`
          }
          control={
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className="btn small"
                onClick={handleCheckUpdate}
                disabled={checkingUpdate || isDownloading || isInstalling}
                title="Query GitHub Releases for the latest version"
              >
                <FiRefreshCw size={14} className={checkingUpdate ? 'spin' : ''} />
                {checkingUpdate ? 'Checking…' : 'Check for updates'}
              </button>
            </div>
          }
        >
          {updateStatus?.lastCheckedAt && (
            <p className="setting-note">
              Last checked: {new Date(updateStatus.lastCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on {new Date(updateStatus.lastCheckedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </SettingCard>

        {/* If update available, show update package card */}
        {isAvailable && (
          <section className="setting-card" style={{ borderColor: 'var(--primary-light, rgba(99, 102, 241, 0.3))' }}>
            <div className="setting-card-head">
              <div className="setting-card-icon" style={{ background: 'var(--primary-light, rgba(99, 102, 241, 0.1))', color: 'var(--primary)' }}>
                <FiZap size={18} />
              </div>
              <div className="setting-card-text">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h3 className="setting-card-title">Release v{latestVer}</h3>
                  {info?.releaseName && <Badge variant="purple">{info.releaseName}</Badge>}
                  {isReady && <Badge variant="green">Downloaded & ready</Badge>}
                </div>
                <p className="setting-card-desc">
                  {info?.fileName ? `${info.fileName} (${formatBytes(info.fileSize || 0)})` : 'Windows Installer'}
                </p>
              </div>
              <div className="setting-card-control" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {isReady ? (
                  <button
                    className="btn primary small"
                    onClick={handleApplyUpdate}
                    disabled={isInstalling || applyingUpdate}
                  >
                    <FiZap size={14} /> Install & Restart
                  </button>
                ) : isDownloading ? (
                  <button
                    className="btn small"
                    onClick={handleCancelDownload}
                  >
                    <FiX size={14} /> Cancel
                  </button>
                ) : (
                  <button
                    className="btn primary small"
                    onClick={handleDownloadUpdate}
                    disabled={checkingUpdate || !info?.downloadUrl}
                  >
                    <FiDownloadCloud size={14} /> Download update
                  </button>
                )}

                <button
                  className="btn small"
                  onClick={handleSaveFileDirectly}
                  title="Download installer .exe directly to this computer"
                >
                  <FiDownload size={14} /> Download setup (.exe)
                </button>

                {info?.htmlUrl && (
                  <a
                    className="btn small"
                    href={info.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="View release notes on GitHub"
                  >
                    <FiGithub size={14} /> GitHub <FiExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>

            {/* Download progress bar */}
            {isDownloading && (
              <div style={{ marginTop: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  <span>Downloading installer…</span>
                  <span>{percent}% ({formatBytes(bytesDownloaded)} / {formatBytes(totalBytes)})</span>
                </div>
                <div className="update-progress-track">
                  <div className="update-progress-fill" style={{ width: `${percent}%` }} />
                </div>
              </div>
            )}

            {/* Release notes */}
            {info?.releaseNotes && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Release notes:
                </div>
                <div className="update-release-notes">
                  {info.releaseNotes}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    );
  }
