import { useState, useEffect } from 'react';
import { FiCheck } from 'react-icons/fi';
import api from '../api/client';
import './CreateAccount.css';

/** Short bank monogram for the tile avatar — "HDFC Credit Card" → "HCC" */
const monogram = (name = '') => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.map(w => w[0]).slice(0, 3).join('').toUpperCase();
  return (words[0] || '?').slice(0, 3).toUpperCase();
};

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
    if (!bank) return;
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
    <form onSubmit={submit} className="ca-form">
      <div className="ca-field-grid">
        <div className="form-row">
          <label className="form-label">Account holder name</label>
          <input
            className="field-input"
            value={holder}
            onChange={e => setHolder(e.target.value.slice(0, 50))}
            maxLength={25}
            placeholder="e.g. John Doe"
            autoFocus
            required
          />
        </div>
        <div className="form-row">
          <label className="form-label">Account number (last 4 digits)</label>
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
      </div>

      <div className="form-row">
        <label className="form-label">Bank</label>
        {loading ? (
          <div className="ca-bank-grid" aria-hidden="true">
            {[0, 1, 2].map(i => <div key={i} className="ca-bank-option skeleton" />)}
          </div>
        ) : (
          <div className="ca-bank-grid" role="radiogroup" aria-label="Bank">
            {banks.map(b => {
              const active = bank === b.value;
              return (
                <button
                  type="button"
                  key={b.value}
                  role="radio"
                  aria-checked={active}
                  className={`ca-bank-option${active ? ' active' : ''}`}
                  onClick={() => setBank(b.value)}
                >
                  <span className="ca-bank-avatar">{monogram(b.label)}</span>
                  <span className="ca-bank-label">{b.label}</span>
                  {active && <FiCheck size={15} className="ca-bank-check" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="ca-footer">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={saving || loading || !bank}>
          {saving ? 'Creating…' : 'Create account'}
        </button>
      </div>
    </form>
  );
}
