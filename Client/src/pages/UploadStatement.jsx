import { useEffect, useState, useRef } from "react";
import { useAccount } from "../context/useAccount";
import { useAuth } from "../context/useAuth";
import { uploadStatement, revertStatement, getUploads } from "../api/statements";
import api from "../api/client";
import { FiUploadCloud, FiFileText, FiTrash2, FiCheckCircle, FiAlertCircle, FiRotateCcw } from "react-icons/fi";
import Badge from "../components/ui/Badge";

export default function UploadStatement({ onUploaded, showHistory = true } = {}) {
  const { isAdmin } = useAuth();
  const [accounts, setAccounts]           = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [file, setFile]                   = useState(null);
  const [progress, setProgress]           = useState(null);
  const [loading, setLoading]             = useState(false);
  const [message, setMessage]             = useState(null);
  const [uploads, setUploads]             = useState([]);
  const [formats, setFormats]             = useState({ formats: [], label: 'TXT, CSV', bankName: '' });
  const [loadingFormats, setLoadingFormats] = useState(false);
  const fileInputRef = useRef(null);

  const { selectedAccountId } = useAccount();

  // ── Load accounts + upload history ───────────────────────────────────
  useEffect(() => {
    let mounted = true;
    api.get("/statements/accounts").then((res) => {
      if (!mounted) return;
      setAccounts(res.data || []);
      if (selectedAccountId) {
        setSelectedAccount(selectedAccountId);
      } else if ((res.data || []).length > 0) {
        setSelectedAccount(res.data[0].id);
      }
    }).catch(() => { if (!mounted) return; setAccounts([]); });

    getUploads().then((res) => {
      if (!mounted) return;
      if (res.data && Array.isArray(res.data)) {
        const loaded = res.data.map(u => ({
          id: u.id,
          fileName: u.fileName,
          accountId: u.accountId,
          time: new Date(u.uploadedAt).getTime(),
          transactionCount: u.transactionCount || 0,
          response: u
        }));
        setUploads(loaded);
      }
    }).catch(console.error);

    return () => (mounted = false);
  }, []);

  // ── Fetch supported formats whenever account changes ──────────────────
  useEffect(() => {
    if (!selectedAccount) return;
    setLoadingFormats(true);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    api.get(`/accounts/${selectedAccount}/supported-formats`)
      .then(res => setFormats(res.data))
      .finally(() => setLoadingFormats(false));
  }, [selectedAccount]);

  // ── Sync selectedAccount with global context ──────────────────────────
  useEffect(() => {
    if (selectedAccountId) setSelectedAccount(selectedAccountId);
  }, [selectedAccountId]);

  const acceptAttr = formats.formats.join(',');

  const isValidFormat = (f) => {
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    return formats.formats.includes(ext);
  };

  const handleFileChange = (e) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    if (!selectedAccount) { setMessage("Please select an account first."); return; }
    if (!isValidFormat(picked)) {
      setMessage(`Only ${formats.label} files are supported for ${formats.bankName || 'this account'}.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setMessage(null);
    setFile(picked);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (!selectedAccount) { setMessage("Please select an account."); return; }
    if (!file)            { setMessage("Please select a statement file to upload."); return; }

    setLoading(true);
    setProgress(0);

    try {
      const res = await uploadStatement(selectedAccount, file, (evt) => {
        if (!evt) return;
        const percent = evt.total ? Math.round((evt.loaded * 100) / evt.total) : null;
        setProgress(percent);
      });

      setMessage("Upload successful.");
      setFile(null);
      setProgress(100);
      if (fileInputRef.current) fileInputRef.current.value = "";

      setTimeout(() => { setProgress(null); setMessage(null); }, 3000);

      setUploads((prev) => [{
        id: res?.data?.id ?? null,
        fileName: file.name,
        accountId: selectedAccount,
        time: Date.now(),
        transactionCount: res?.data?.transactionCount || 0,
        response: res?.data,
      }, ...prev]);

      // Let a host page (e.g. Transactions) refresh its list after a successful upload.
      onUploaded?.();
    } catch (err) {
      console.error(err);
      setMessage("Upload failed. Please try again.");
      setProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async (item) => {
    setMessage(null);
    if (!item?.id) { setMessage("Cannot revert: no server id for this upload."); return; }
    try {
      await revertStatement(item.id);
      setUploads((prev) => prev.filter((u) => u.id !== item.id));
      setMessage("Reverted upload.");
    } catch (err) {
      console.error(err);
      setMessage("Revert failed. Please try again.");
    }
  };

  const filteredUploads = uploads.filter(
    u => !selectedAccount || String(u.accountId) === String(selectedAccount)
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <h1 style={{ marginBottom: 0 }}>Upload Statement</h1>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
        {/* Upload Form Card */}
        <div className="card" style={{ maxWidth: '700px', display: 'block' }}>
          <form onSubmit={handleSubmit}>

            {/* Account selector */}
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--gray-700)', marginBottom: 'var(--space-2)' }}>Select Account</label>
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                disabled={!!selectedAccountId}
                className="field-select"
              >
                <option value="">Select an account...</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                 {acc.accountHolderName} · {acc.bankName} - {acc.accountNumber || acc.maskedAccountNumber || "****"}
                  </option>
                ))}
              </select>
              {selectedAccountId && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>Using the currently active account.</div>
              )}
            </div>

            {/* File drop zone */}
            <div style={{ marginBottom: 'var(--space-8)' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--gray-700)', marginBottom: 'var(--space-2)' }}>Statement File</label>

              {!selectedAccount ? (
                <div style={{ border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '48px 20px', textAlign: 'center', backgroundColor: 'var(--gray-100)' }}>
                  <FiUploadCloud size={44} color="var(--gray-300)" style={{ marginBottom: 'var(--space-4)' }} />
                  <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--gray-400)', fontWeight: 600 }}>Select an account first</p>
                </div>
              ) : !file ? (
                <div
                  style={{ position: 'relative', border: '2px dashed var(--gray-300)', borderRadius: 'var(--radius-sm)', padding: '48px 20px', textAlign: 'center', backgroundColor: 'var(--gray-50)', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.backgroundColor = 'var(--primary-light)'; }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--gray-300)'; e.currentTarget.style.backgroundColor = 'var(--gray-50)'; }}
                >
                  <FiUploadCloud size={44} color="var(--gray-400)" style={{ marginBottom: 'var(--space-4)' }} />
                  <p style={{ margin: '0 0 8px 0', fontSize: 'var(--text-md)', color: 'var(--gray-600)', fontWeight: 600 }}>Click to browse or drag and drop</p>
                  <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--gray-400)' }}>
                    {loadingFormats
                      ? 'Loading supported formats...'
                      : `${formats.label} format supported${formats.bankName ? ` for ${formats.bankName}` : ''}`
                    }
                  </p>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept={acceptAttr}
                    onChange={handleFileChange}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', padding: 'var(--space-4)', backgroundColor: 'var(--primary-light)', borderRadius: 'var(--radius-sm)', border: '1px solid #bfdbfe' }}>
                  <FiFileText color="var(--primary)" size={28} style={{ marginRight: 'var(--space-4)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: '#1e3a8a' }}>{file.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: '#60a5fa', marginTop: '4px' }}>{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; setProgress(null); setMessage(null); }}
                    style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--danger-light)'}
                    onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    title="Remove file"
                  >
                    <FiTrash2 size={20} />
                  </button>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {progress !== null && (
              <div style={{ marginBottom: 'var(--space-6)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: progress === 100 ? 'var(--success)' : 'var(--gray-700)' }}>
                    {progress === 100 ? 'Upload Complete' : 'Uploading...'}
                  </span>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: progress === 100 ? 'var(--success)' : 'var(--primary)' }}>{progress}%</span>
                </div>
                <div className="progress">
                  <div className="progress-bar" style={{ width: `${progress}%`, background: progress === 100 ? 'var(--success)' : 'var(--primary)' }} />
                </div>
              </div>
            )}

            {/* Message */}
            {message && (
              <div style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', backgroundColor: message.includes('failed') || message.includes('Only') || message.includes('Please') ? 'var(--danger-light)' : 'var(--success-light)', color: message.includes('failed') || message.includes('Only') || message.includes('Please') ? '#991b1b' : '#065f46', border: `1px solid ${message.includes('failed') || message.includes('Only') || message.includes('Please') ? '#f87171' : '#34d399'}` }}>
                {message.includes('failed') || message.includes('Only') || message.includes('Please')
                  ? <FiAlertCircle size={18} style={{ marginRight: 'var(--space-2)' }} />
                  : <FiCheckCircle size={18} style={{ marginRight: 'var(--space-2)' }} />
                }
                <span style={{ fontSize: 'var(--text-base)', fontWeight: 500 }}>{message}</span>
              </div>
            )}

            {/* Submit */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn primary"
                type="submit"
                disabled={loading || !file || loadingFormats || !selectedAccount || !isAdmin}
                title={isAdmin ? undefined : "Viewers cannot upload statements"}
                style={{ flex: 1, padding: '12px', fontSize: '15px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
              >
                {loading ? <span className="spinner" style={{ width: '16px', height: '16px', borderTopColor: '#fff', borderRightColor: '#fff' }}></span> : <FiUploadCloud size={18} />}
                {loading ? "Processing..." : "Upload Statement"}
              </button>
            </div>
          </form>
        </div>

        {/* Upload History */}
        {showHistory && filteredUploads.length > 0 && (
          <div>
            <h2 style={{ fontSize: 'var(--text-lg)', color: 'var(--text-main)', marginBottom: 'var(--space-4)', marginTop: 0 }}>Upload History</h2>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Date</th>
                    <th>TX Count</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUploads.map((u) => (
                    <tr key={`${u.id || u.time}-${u.fileName}`}>
                      <td>
                        <div style={{ fontWeight: 500, color: 'var(--gray-700)' }}>{u.fileName}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {accounts.find(a => String(a.id) === String(u.accountId))?.bankName || u.accountId}
                        </div>
                      </td>
                      <td style={{ fontSize: 'var(--text-sm)' }}>
                        {new Date(u.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td><Badge variant="blue">{u.transactionCount}</Badge></td>
                      <td style={{ textAlign: 'right' }}>
                        {isAdmin && (
                          <button
                            className="btn danger small"
                            onClick={() => { if (window.confirm('Are you sure you want to revert this upload?')) handleRevert(u); }}
                          >
                            <FiRotateCcw size={12} /> Revert
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}