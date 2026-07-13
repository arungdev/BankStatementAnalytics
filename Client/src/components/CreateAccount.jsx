import { useState, useEffect } from 'react';
import api from '../api/client';

export default function CreateAccount({ onClose, onCreate }) {
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const [bank, setBank] = useState('');
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/accounts/banks')
      .then(res => {
        const list = res.data || [];
        setBanks(list);
        if (list.length > 0) setBank(list[0].value);
      })
      .catch(err => {
        console.error('Failed to load banks', err);
      })
      .finally(() => setLoading(false));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const p = onCreate({ AccountHolderName: holder, AccountNumber: number, BankName: bank });
      onClose();
      if (p && typeof p.then === 'function') {
        p.catch(err => {
          console.error(err);
          alert('Could not create account');
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="form-row">
        <label className="form-label">Holder Name</label>
        <input
          className="field-input"
          value={holder}
          onChange={e => setHolder(e.target.value.slice(0, 50))}
          maxLength={25}
          placeholder="e.g. John Doe"
          required
        />
      </div>
      <div className="form-row">
        <label className="form-label">Account Number (last 4 digits)</label>
        <input
          className="field-input"
          value={number}
          onChange={e => setNumber(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          placeholder="e.g. 1234"
          required
        />
      </div>
      <div className="form-row">
        <label className="form-label">Bank</label>
        {loading ? (
          <select className="field-select" disabled><option>Loading...</option></select>
        ) : (
          <select className="field-select" value={bank} onChange={e => setBank(e.target.value)}>
            {banks.map(b => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={saving || loading}>
          {saving ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
  );
}
