import { useState, useEffect } from 'react';
import { FiWifi, FiCopy, FiCheck, FiRefreshCw, FiExternalLink, FiShield, FiAlertCircle } from 'react-icons/fi';
import { Badge, Switch, useAuth } from '@common/client';
import { getNetworkAccessStatus, updateNetworkAccessStatus } from '../api/network';
import './NetworkSettings.css';

export default function NetworkSettings() {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(null);
  const [networkInfo, setNetworkInfo] = useState({
    enabled: false,
    localIpAddresses: [],
    port: 5080,
    primaryUrl: '',
    urls: [],
    clientIp: null,
    isLoopback: true,
  });

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getNetworkAccessStatus();
      setNetworkInfo(data);
    } catch (err) {
      console.error('Failed to load network access status:', err);
      setError('Could not load network settings. Make sure the server is running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleToggle = async (nextChecked) => {
    if (!isAdmin) return;
    setSaving(true);
    setError(null);
    try {
      const data = await updateNetworkAccessStatus(nextChecked);
      setNetworkInfo(data);
    } catch (err) {
      console.error('Failed to update network access:', err);
      setError(err.response?.data?.message || 'Failed to update network access settings.');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2500);
    } catch (err) {
      console.error('Could not copy to clipboard:', err);
    }
  };

  return (
    <div className="settings-stack">
      {error && (
        <p className="setting-note danger">
          <FiAlertCircle size={15} />
          {error}
        </p>
      )}

      <section id="set-network-access" className="setting-card">
        <div className="setting-card-head">
          <span className="setting-card-icon">
            <FiWifi size={18} />
          </span>
          <div className="setting-card-text">
            <h3 className="setting-card-title">
              Local Network Access
              <Badge variant={networkInfo.enabled ? 'green' : 'gray'}>
                {networkInfo.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </h3>
            <p className="setting-card-desc">
              Allow access to this application from other devices (phones, tablets, PCs) on the same Wi-Fi or LAN.
            </p>
          </div>
          <div className="setting-card-control">
            <Switch
              checked={networkInfo.enabled}
              onChange={handleToggle}
              disabled={!isAdmin || loading || saving}
              aria-label="Toggle local network access"
            />
          </div>
        </div>

        <div className="setting-card-body">
          {!isAdmin && (
            <p className="setting-note">
              <FiShield size={14} />
              Only administrators can enable or disable network access.
            </p>
          )}

          {networkInfo.enabled ? (
            <div className="network-access-details">
              <div className="network-url-card">
                <div className="network-url-header">
                  <span className="network-url-label">Access URL for other devices</span>
                  <button
                    type="button"
                    className="btn small network-refresh-btn"
                    onClick={fetchStatus}
                    disabled={loading}
                    title="Refresh local IP addresses"
                  >
                    <FiRefreshCw size={13} className={loading ? 'spin' : ''} />
                    Refresh IP
                  </button>
                </div>

                <div className="network-url-box">
                  <span className="network-url-text">{networkInfo.primaryUrl || 'Detecting address...'}</span>
                  <div className="network-url-actions">
                    <button
                      type="button"
                      className="btn small primary"
                      onClick={() => copyToClipboard(networkInfo.primaryUrl)}
                      disabled={!networkInfo.primaryUrl}
                    >
                      {copiedUrl === networkInfo.primaryUrl ? (
                        <>
                          <FiCheck size={14} /> Copied!
                        </>
                      ) : (
                        <>
                          <FiCopy size={14} /> Copy link
                        </>
                      )}
                    </button>
                    {networkInfo.primaryUrl && (
                      <a
                        href={networkInfo.primaryUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn small"
                        title="Open in new tab"
                      >
                        <FiExternalLink size={14} /> Open
                      </a>
                    )}
                  </div>
                </div>

                {networkInfo.urls && networkInfo.urls.length > 1 && (
                  <div className="network-alternate-urls">
                    <span className="network-alt-label">Alternate interface addresses:</span>
                    <ul className="network-alt-list">
                      {networkInfo.urls.slice(1).map((url) => (
                        <li key={url} className="network-alt-item">
                          <code>{url}</code>
                          <button
                            type="button"
                            className="btn tiny"
                            onClick={() => copyToClipboard(url)}
                          >
                            {copiedUrl === url ? <FiCheck size={12} /> : <FiCopy size={12} />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="network-instructions">
                  <strong>How to connect from your phone or tablet:</strong>
                  <ol>
                    <li>Make sure your mobile device is connected to the <strong>same Wi-Fi network</strong> as this computer.</li>
                    <li>Open your mobile web browser (Chrome, Safari, Firefox).</li>
                    <li>Enter <code>{networkInfo.primaryUrl}</code> in the address bar.</li>
                    <li>Log in with your existing account credentials.</li>
                  </ol>
                </div>
              </div>
            </div>
          ) : (
            <div className="network-disabled-state">
              <div className="network-disabled-box">
                <FiShield size={20} className="network-shield-icon" />
                <div>
                  <strong>Local-only mode is active</strong>
                  <p>
                    The app is only accessible from this computer via <code>localhost</code>.
                    Connections from phones, tablets, or other computers on your Wi-Fi will be blocked.
                  </p>
                </div>
              </div>
            </div>
          )}

          {networkInfo.updatedAtUtc && (
            <div className="network-meta-footer">
              Last updated:{' '}
              {new Date(networkInfo.updatedAtUtc).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {networkInfo.updatedBy && ` by ${networkInfo.updatedBy}`}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
