import { useEffect, useState, useRef } from "react";
import { useAccount } from "../context/useAccount";
import { ALL_ACCOUNTS } from "../components/AccountFilter";
import { Badge, useAuth } from "@common/client";
import { uploadStatement, revertStatement, getUploads } from "../api/statements";
import api from "../api/client";
import { FiUploadCloud, FiFileText, FiTrash2, FiCheckCircle, FiAlertCircle, FiRotateCcw, FiHelpCircle } from "react-icons/fi";

export default function UploadStatement({ onUploaded, showHistory = true } = {}) {
  const { isAdmin } = useAuth();
  const [accounts, setAccounts]           = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [file, setFile]                   = useState(null);
  const [password, setPassword]           = useState("");
  const [progress, setProgress]           = useState(null);
  const [loading, setLoading]             = useState(false);
  // { text, isError } — the flag is set explicitly at each call site so server
  // messages (e.g. PDF password errors) never get mis-styled by keyword sniffing.
  const [message, setMessage]             = useState(null);
  const [uploads, setUploads]             = useState([]);
  const [formats, setFormats]             = useState({ formats: [], label: 'TXT, CSV', bankName: '', downloadGuide: null });
  const [loadingFormats, setLoadingFormats] = useState(false);
  const fileInputRef = useRef(null);

  const { selectedAccountId } = useAccount();
  // Uploads target a single account; ignore the global "All accounts" selection.
  const forcedAccountId =
    selectedAccountId && selectedAccountId !== ALL_ACCOUNTS ? selectedAccountId : null;

  // ── Load accounts + upload history ───────────────────────────────────
  useEffect(() => {
    let mounted = true;
    api.get("/statements/accounts").then((res) => {
      if (!mounted) return;
      setAccounts(res.data || []);
      if (forcedAccountId) {
        setSelectedAccount(forcedAccountId);
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
          autoImported: u.autoImported === true,
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
    setPassword("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    api.get(`/accounts/${selectedAccount}/supported-formats`)
      .then(res => setFormats(res.data))
      .finally(() => setLoadingFormats(false));
  }, [selectedAccount]);

  // ── Sync selectedAccount with global context ──────────────────────────
  useEffect(() => {
    if (forcedAccountId) setSelectedAccount(forcedAccountId);
  }, [forcedAccountId]);

  const acceptAttr = formats.formats.join(',');
  const isPdf = !!file && file.name.toLowerCase().endsWith('.pdf');

  const isValidFormat = (f) => {
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    return formats.formats.includes(ext);
  };

  const handleFileChange = (e) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    if (!selectedAccount) { setMessage({ text: "Please select an account first.", isError: true }); return; }
    if (!isValidFormat(picked)) {
      setMessage({ text: `Only ${formats.label} files are supported for ${formats.bankName || 'this account'}.`, isError: true });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setMessage(null);
    setFile(picked);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (!selectedAccount) { setMessage({ text: "Please select an account.", isError: true }); return; }
    if (!file)            { setMessage({ text: "Please select a statement file to upload.", isError: true }); return; }

    setLoading(true);
    setProgress(0);

    try {
      const res = await uploadStatement(selectedAccount, file, (evt) => {
        if (!evt) return;
        const percent = evt.total ? Math.round((evt.loaded * 100) / evt.total) : null;
        setProgress(percent);
      }, isPdf ? password : undefined);

      const total = res?.data?.totalCount ?? res?.data?.transactionCount ?? 0;
      const added = res?.data?.newCount ?? total;
      setMessage({ text: `Upload successful — ${added} new of ${total} transactions imported.`, isError: false });
      setFile(null);
      setPassword("");
      setProgress(100);
      if (fileInputRef.current) fileInputRef.current.value = "";

      setTimeout(() => { setProgress(null); setMessage(null); }, 4000);

      setUploads((prev) => [{
        id: res?.data?.id ?? null,
        fileName: file.name,
        accountId: selectedAccount,
        time: Date.now(),
        transactionCount: total,
        response: res?.data,
      }, ...prev]);

      // Let a host page (e.g. Transactions) refresh its list after a successful upload.
      onUploaded?.();
    } catch (err) {
      console.error(err);
      // Show the server's message (e.g. duplicate-file 409, PDF password errors) when present.
      const serverMsg = err.response?.data;
      setMessage({
        text: typeof serverMsg === "string" && serverMsg ? serverMsg : "Upload failed. Please try again.",
        isError: true,
      });
      setProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async (item) => {
    setMessage(null);
    if (!item?.id) { setMessage({ text: "Cannot revert: no server id for this upload.", isError: true }); return; }
    try {
      await revertStatement(item.id);
      setUploads((prev) => prev.filter((u) => u.id !== item.id));
      setMessage({ text: "Reverted upload.", isError: false });
    } catch (err) {
      console.error(err);
      setMessage({ text: "Revert failed. Please try again.", isError: true });
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
                disabled={!!forcedAccountId}
                className="field-select"
              >
                <option value="">Select an account...</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                 {acc.accountHolderName} · {acc.bankName} - {acc.accountNumber || acc.maskedAccountNumber || "****"}
                  </option>
                ))}
              </select>
              {forcedAccountId && (
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
                <div style={{ display: 'flex', alignItems: 'center', padding: 'var(--space-4)', backgroundColor: 'var(--primary-light)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--primary)' }}>
                  <FiFileText color="var(--primary)" size={28} style={{ marginRight: 'var(--space-4)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-main)' }}>{file.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '4px' }}>{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setFile(null); setPassword(""); if (fileInputRef.current) fileInputRef.current.value = ""; setProgress(null); setMessage(null); }}
                    style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--danger-light)'}
                    onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    title="Remove file"
                  >
                    <FiTrash2 size={20} />
                  </button>
                </div>
              )}

              {/* Where-to-download guidance */}
              {selectedAccount && !file && !loadingFormats && formats.downloadGuide && (
                <details style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--gray-600)' }}>
                  <summary style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--primary)', fontWeight: 600 }}>
                    <FiHelpCircle size={15} />
                    Where do I download this file?
                  </summary>
                  <div style={{ marginTop: 'var(--space-3)', paddingLeft: 'var(--space-2)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--gray-700)', marginBottom: 'var(--space-2)' }}>
                      {formats.downloadGuide.label}
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 'var(--space-6)', lineHeight: 1.7 }}>
                      {formats.downloadGuide.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                </details>
              )}
            </div>

            {/* PDF password (only for protected e-statement PDFs) */}
            {isPdf && (
              <div style={{ marginBottom: 'var(--space-6)' }}>
                <label style={{ display: 'block', fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--gray-700)', marginBottom: 'var(--space-2)' }}>
                  PDF Password
                </label>
                <input
                  type="password"
                  className="field-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank if the PDF isn't protected"
                  autoComplete="off"
                />
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                  Emailed e-statements are usually protected — the password format is described in the bank's email.
                </div>
              </div>
            )}

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
              <div style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', backgroundColor: message.isError ? 'var(--danger-light)' : 'var(--success-light)', color: message.isError ? 'var(--danger)' : 'var(--success)', border: `1px solid ${message.isError ? 'var(--danger-border)' : 'var(--success)'}` }}>
                {message.isError
                  ? <FiAlertCircle size={18} style={{ marginRight: 'var(--space-2)' }} />
                  : <FiCheckCircle size={18} style={{ marginRight: 'var(--space-2)' }} />
                }
                <span style={{ fontSize: 'var(--text-base)', fontWeight: 500 }}>{message.text}</span>
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
                        <div style={{ fontWeight: 500, color: 'var(--gray-700)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {u.fileName}
                          {u.autoImported && <Badge variant="green">Auto</Badge>}
                        </div>
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