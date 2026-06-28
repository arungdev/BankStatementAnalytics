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
        if (list.length > 0) setBank(list[0]);
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
      <div>
        <label>Holder Name</label>
        <input
          value={holder}
          onChange={e => setHolder(e.target.value.slice(0, 50))}
          maxLength={25}
          placeholder="e.g. John Doe"
          required
        />
      </div>
      <div>
        <label>Account Number (last 4 digits)</label>
        <input
          value={number}
          onChange={e => setNumber(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          placeholder="e.g. 1234"
          required
        />
      </div>
      <div>
        <label>Bank</label>
        {loading ? (
          <select disabled><option>Loading...</option></select>
        ) : (
          <select value={bank} onChange={e => setBank(e.target.value)}>
            {banks.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="submit" disabled={saving || loading}>
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button type="button" onClick={onClose} style={{ marginLeft: 8 }}>Cancel</button>
      </div>
    </form>
  );
}
