import { FiLock, FiAlertCircle, FiDownload, FiUploadCloud, FiRotateCcw } from "react-icons/fi";
import { Badge } from "@common/client";

export default function BackupSettings({ SettingCard, backupError, backupStatus, downloadingBackup, formatBytes, handleDownloadBackup, handleRestore, isAdmin, restoreFile, restoreInputRef, restoreProgress, restoring, setBackupError, setRestoreFile }) {
    if (!isAdmin) {
      return (
        <div className="settings-empty">
          <FiLock size={36} />
          <div className="settings-empty-title">Only an admin can back up or restore</div>
          <div className="settings-empty-sub">
            A backup covers every user's data on this app, so it's kept to admins.
          </div>
        </div>
      );
    }

    const unsupported = backupStatus && !backupStatus.supported;

    return (
      <div className="settings-stack">
        {backupError && (
          <p className="setting-note danger">
            <FiAlertCircle size={14} />
            {backupError}
          </p>
        )}

        {unsupported && (
          <p className="setting-note danger">
            <FiAlertCircle size={14} />
            {backupStatus.reason}
          </p>
        )}

        <SettingCard
          anchor="backup-download"
          icon={<FiDownload size={18} />}
          title="Download a backup"
          description="One zip holding the whole database — every account, transaction, merchant, budget and bill, for all users — plus the original statement files you uploaded. Keep it somewhere safe; it is not encrypted."
          control={
            <button
              className="btn primary small"
              onClick={handleDownloadBackup}
              disabled={downloadingBackup || unsupported}
            >
              <FiDownload size={15} /> {downloadingBackup ? 'Preparing…' : 'Download backup'}
            </button>
          }
        >
          {backupStatus?.supported && (
            <p className="setting-note">
              Roughly {formatBytes(backupStatus.databaseBytes + backupStatus.uploadBytes)} —
              {' '}{formatBytes(backupStatus.databaseBytes)} of database
              {' '}plus {backupStatus.uploadFileCount} statement file{backupStatus.uploadFileCount === 1 ? '' : 's'}
              {' '}({formatBytes(backupStatus.uploadBytes)}). Large backups can take a minute to build.
            </p>
          )}
          {!backupStatus && <p className="setting-note">Checking what there is to back up…</p>}
        </SettingCard>

        <SettingCard
          anchor="backup-restore"
          icon={<FiUploadCloud size={18} />}
          title="Restore from a backup"
          status={<Badge variant="red">Replaces everything</Badge>}
          description="Loads a backup zip taken from this app. Everything currently here is replaced — this is not a merge."
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".zip,application/zip"
              disabled={restoring || unsupported}
              onChange={(e) => { setRestoreFile(e.target.files?.[0] ?? null); setBackupError(null); }}
              className="field-input"
              style={{ maxWidth: '320px' }}
              aria-label="Backup file to restore"
            />
            <button
              className="btn danger small"
              onClick={handleRestore}
              disabled={!restoreFile || restoring || unsupported}
            >
              <FiRotateCcw size={14} />
              {restoring
                ? (restoreProgress < 100 ? `Uploading ${restoreProgress}%…` : 'Restoring…')
                : 'Restore'}
            </button>
            {restoreFile && !restoring && (
              <button
                className="btn small"
                onClick={() => { setRestoreFile(null); if (restoreInputRef.current) restoreInputRef.current.value = ''; }}
              >
                Clear
              </button>
            )}
          </div>

          {restoreFile && (
            <p className="setting-note">
              {restoreFile.name} — {formatBytes(restoreFile.size)}
            </p>
          )}
          {/* Plain text only — .setting-note is a flex row (for the icon variant), so any real
              element in here becomes its own flex item and splits the paragraph into columns. */}
          <p className="setting-note">
            Before anything is overwritten, a copy of the current data is saved on the server under
            Data\Backups, so a restore from the wrong file can still be walked back. The app reloads
            once the restore finishes.
          </p>
        </SettingCard>
      </div>
    );
  }
