import { useEffect, useState, useRef } from "react";
import { useAccount } from "../context/useAccount";
import { uploadStatement, revertStatement, getUploads } from "../api/statements";
import api from "../api/client";
import { FiUploadCloud, FiFileText, FiTrash2, FiCheckCircle, FiAlertCircle, FiRotateCcw } from "react-icons/fi";

export default function UploadStatement() {
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Upload Form Card */}
        <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '32px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', maxWidth: '700px' }}>
          <form onSubmit={handleSubmit}>

            {/* Account selector */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>Select Account</label>
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                disabled={!!selectedAccountId}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px', outline: 'none', backgroundColor: selectedAccountId ? '#f9fafb' : '#fff' }}
              >
                <option value="">Select an account...</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.bankName} - {acc.maskedAccountNumber || acc.accountNumber || "****"}
                  </option>
                ))}
              </select>
              {selectedAccountId && (
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>Using the currently active account.</div>
              )}
            </div>

            {/* File drop zone */}
            <div style={{ marginBottom: '32px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>Statement File</label>

              {!selectedAccount ? (
                <div style={{ border: '2px dashed #e5e7eb', borderRadius: '8px', padding: '48px 20px', textAlign: 'center', backgroundColor: '#f3f4f6' }}>
                  <FiUploadCloud size={44} color="#d1d5db" style={{ marginBottom: '16px' }} />
                  <p style={{ margin: 0, fontSize: '15px', color: '#9ca3af', fontWeight: 600 }}>Select an account first</p>
                </div>
              ) : !file ? (
                <div
                  style={{ position: 'relative', border: '2px dashed #d1d5db', borderRadius: '8px', padding: '48px 20px', textAlign: 'center', backgroundColor: '#f9fafb', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.backgroundColor = '#eff6ff'; }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.backgroundColor = '#f9fafb'; }}
                >
                  <FiUploadCloud size={44} color="#9ca3af" style={{ marginBottom: '16px' }} />
                  <p style={{ margin: '0 0 8px 0', fontSize: '15px', color: '#4b5563', fontWeight: 600 }}>Click to browse or drag and drop</p>
                  <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', padding: '16px', backgroundColor: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                  <FiFileText color="#3b82f6" size={28} style={{ marginRight: '16px' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e3a8a' }}>{file.name}</div>
                    <div style={{ fontSize: '12px', color: '#60a5fa', marginTop: '4px' }}>{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; setProgress(null); setMessage(null); }}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '8px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseOver={e => e.currentTarget.style.backgroundColor = '#fee2e2'}
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
              <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: progress === 100 ? '#10b981' : '#374151' }}>
                    {progress === 100 ? 'Upload Complete' : 'Uploading...'}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: progress === 100 ? '#10b981' : '#3b82f6' }}>{progress}%</span>
                </div>
                <div style={{ height: '8px', backgroundColor: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progress}%`, backgroundColor: progress === 100 ? '#10b981' : '#3b82f6', transition: 'width 0.3s ease' }} />
                </div>
              </div>
            )}

            {/* Message */}
            {message && (
              <div style={{ marginBottom: '24px', padding: '12px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', backgroundColor: message.includes('failed') || message.includes('Only') || message.includes('Please') ? '#fef2f2' : '#ecfdf5', color: message.includes('failed') || message.includes('Only') || message.includes('Please') ? '#991b1b' : '#065f46', border: `1px solid ${message.includes('failed') || message.includes('Only') || message.includes('Please') ? '#f87171' : '#34d399'}` }}>
                {message.includes('failed') || message.includes('Only') || message.includes('Please')
                  ? <FiAlertCircle size={18} style={{ marginRight: '8px' }} />
                  : <FiCheckCircle size={18} style={{ marginRight: '8px' }} />
                }
                <span style={{ fontSize: '14px', fontWeight: 500 }}>{message}</span>
              </div>
            )}

            {/* Submit */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn primary"
                type="submit"
                disabled={loading || !file || loadingFormats || !selectedAccount}
                style={{ flex: 1, padding: '12px', fontSize: '15px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
              >
                {loading ? <span className="spinner" style={{ width: '16px', height: '16px', borderTopColor: '#fff', borderRightColor: '#fff' }}></span> : <FiUploadCloud size={18} />}
                {loading ? "Processing..." : "Upload Statement"}
              </button>
            </div>
          </form>
        </div>

        {/* Upload History */}
        {filteredUploads.length > 0 && (
          <div>
            <h2 style={{ fontSize: '18px', color: '#111827', marginBottom: '16px', marginTop: 0 }}>Upload History</h2>
            <div className="table-container" style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
              <table>
                <thead style={{ backgroundColor: '#f9fafb' }}>
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
                        <div style={{ fontWeight: 500, color: '#374151' }}>{u.fileName}</div>
                        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                          {accounts.find(a => String(a.id) === String(u.accountId))?.bankName || u.accountId}
                        </div>
                      </td>
                      <td style={{ fontSize: '13px' }}>
                        {new Date(u.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td><span className="badge blue">{u.transactionCount}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn danger small"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => { if (window.confirm('Are you sure you want to revert this upload?')) handleRevert(u); }}
                        >
                          <FiRotateCcw size={12} /> Revert
                        </button>
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