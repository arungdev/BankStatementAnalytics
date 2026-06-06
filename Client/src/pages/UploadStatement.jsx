import { useEffect, useState } from "react";
import { useAccount } from "../context/useAccount";
import { uploadStatement, revertStatement, getUploads } from "../api/statements";
import api from "../api/client";

export default function UploadStatement() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [uploads, setUploads] = useState([]);

  const { selectedAccountId } = useAccount();

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
    })
      .catch(() => {
        if (!mounted) return;
        setAccounts([]);
      });

    getUploads().then((res) => {
      if (!mounted) return;
      if (res.data && Array.isArray(res.data)) {
        // Map backend Upload to frontend model
        const loaded = res.data.map(u => ({
          id: u.id,
          fileName: u.fileName,
          accountId: u.accountId,
          time: new Date(u.uploadedAt).getTime(),
          response: u
        }));
        setUploads(loaded);
      }
    }).catch(console.error);

    return () => (mounted = false);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (!selectedAccount) {
      setMessage("Please select an account.");
      return;
    }
    if (!file) {
      setMessage("Please select a statement file to upload.");
      return;
    }

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

      setUploads((prev) => [
        {
          id: res?.data?.id ?? null,
          fileName: file.name,
          accountId: selectedAccount,
          time: Date.now(),
          response: res?.data,
        },
        ...prev,
      ]);
    } catch (err) {
      console.error(err);
      setMessage("Upload failed. Please try again.");
      setProgress(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAccountId) setSelectedAccount(selectedAccountId);
  }, [selectedAccountId]);

  const handleRevert = async (item) => {
    setMessage(null);
    if (!item || !item.id) {
      setMessage("Cannot revert: no server id for this upload.");
      return;
    }

    try {
      await revertStatement(item.id);
      setUploads((prev) => prev.filter((u) => u.id !== item.id));
      setMessage("Reverted upload.");
    } catch (err) {
      console.error(err);
      setMessage("Revert failed. Please try again.");
    }
  };

  return (
    <div className="upload-page">
      <h3 className="section-heading">Upload Statement</h3>

      <form onSubmit={handleSubmit} className="upload-form">
        <div className="form-row">
          <label className="form-label">Account</label>
          <select
            className="form-select"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            disabled={!!selectedAccountId}
          >
            <option value="">Select an account...</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.maskedAccountNumber || acc.accountNumber || "****"} ({acc.bankName})
              </option>
            ))}
          </select>
          {selectedAccountId && (
            <div className="hint">Using selected account from the sidebar.</div>
          )}
        </div>

        <div className="form-row">
          <label className="form-label">Statement file (PDF/CSV)</label>
          <input className="form-file" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>

        {progress != null && (
          <div className="form-row">
            <div className="progress">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-text">{progress}%</div>
          </div>
        )}

        {message && <div className="form-message">{message}</div>}

        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={loading}>
            {loading ? "Uploading..." : "Upload"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => { setFile(null); setProgress(null); setMessage(null); }}
          >
            Reset
          </button>
        </div>
      </form>

      {uploads.filter(u => !selectedAccount || String(u.accountId) === String(selectedAccount)).length > 0 && (
        <div className="upload-history">
          <h4>Upload history</h4>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Account</th>
                  <th>Uploaded At</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {uploads.filter(u => !selectedAccount || String(u.accountId) === String(selectedAccount)).map((u) => (
                  <tr key={`${u.id || u.time}-${u.fileName}`}>
                    <td>{u.fileName}</td>
                    <td>{(accounts.find(a => String(a.id) === String(u.accountId))?.bankName) || u.accountId}</td>
                    <td>{new Date(u.time).toLocaleString()}</td>
                    <td>Uploaded</td>
                    <td>
                      <button className="btn danger small" onClick={() => handleRevert(u)}>Revert</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}