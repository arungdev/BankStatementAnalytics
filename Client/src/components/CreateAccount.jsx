import { useState } from 'react';

export default function CreateAccount({ onClose, onCreate }) {
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const [bank, setBank] = useState('IOB');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Optimistic: invoke parent handler which will add a temp account immediately
      const p = onCreate({ AccountHolderName: holder, AccountNumber: number, BankName: bank });
      // Close immediately for optimistic UX
      onClose();
      // Handle eventual failure
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
        <input value={holder} onChange={e => setHolder(e.target.value)} required />
      </div>
      <div>
        <label>Account Number</label>
        <input value={number} onChange={e => setNumber(e.target.value)} required />
      </div>
      <div>
        <label>Bank</label>
        <select value={bank} onChange={e => setBank(e.target.value)}>
          <option>IOB</option>
          <option>HDFC</option>
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
        <button type="button" onClick={onClose} style={{ marginLeft: 8 }}>Cancel</button>
      </div>
    </form>
  );
}
