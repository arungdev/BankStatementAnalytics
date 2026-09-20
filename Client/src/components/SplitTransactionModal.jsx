import { useState, useEffect, useMemo } from 'react';
import { FiPlus, FiTrash2, FiCheck, FiScissors } from 'react-icons/fi';
import api from '../api/client';
import { Modal, Button } from '@common/client';
import { currencyFormatter as fmt } from '../utils/format';

export default function SplitTransactionModal({ open, onClose, transaction, categories = [], onSaved }) {
  const [splits, setSplits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const parentAmount = useMemo(() => {
    if (!transaction) return 0;
    return transaction.debit > 0 ? transaction.debit : (transaction.credit > 0 ? transaction.credit : 0);
  }, [transaction]);

  useEffect(() => {
    if (!open || !transaction) return;
    setLoading(true);

    api.get(`/transactions/splits?bankRef=${encodeURIComponent(transaction.bankReference || transaction.id)}&bankType=${encodeURIComponent(transaction.bankType || '')}&accountId=${transaction.accountId}`)
      .then(res => {
        const data = Array.isArray(res.data) ? res.data : [];
        if (data.length > 0) {
          setSplits(data.map(d => ({
            amount: d.amount,
            category: d.category || '',
            subCategory: d.subCategory || '',
            note: d.note || '',
          })));
        } else {
          // Initialize with 2 empty split rows
          setSplits([
            { amount: Math.round((parentAmount / 2) * 100) / 100, category: transaction.category || categories[0]?.name || '', subCategory: '', note: '' },
            { amount: Math.round((parentAmount / 2) * 100) / 100, category: categories[1]?.name || categories[0]?.name || '', subCategory: '', note: '' },
          ]);
        }
      })
      .catch(err => {
        console.error('Failed to load splits', err);
        setSplits([]);
      })
      .finally(() => setLoading(false));
  }, [open, transaction, parentAmount, categories]);

  const totalAllocated = useMemo(() => {
    return splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  }, [splits]);

  const remaining = Math.round((parentAmount - totalAllocated) * 100) / 100;
  const isBalanced = Math.abs(remaining) < 0.01;

  const addRow = () => {
    setSplits(prev => [
      ...prev,
      { amount: Math.max(0, remaining), category: categories[0]?.name || '', subCategory: '', note: '' }
    ]);
  };

  const removeRow = (idx) => {
    setSplits(prev => prev.filter((_, i) => i !== idx));
  };

  const updateRow = (idx, field, val) => {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, [field]: val } : s));
  };

  const handleSave = async () => {
    if (!isBalanced) {
      alert(`The split amounts must equal the transaction total of ${fmt.format(parentAmount)}. Remaining: ${fmt.format(remaining)}`);
      return;
    }

    setSaving(true);
    try {
      await api.post('/transactions/split', {
        accountId: transaction.accountId,
        bankReference: transaction.bankReference || transaction.id,
        bankType: transaction.bankType || '',
        splits: splits.map(s => ({
          amount: parseFloat(s.amount) || 0,
          category: s.category || null,
          subCategory: s.subCategory || null,
          note: s.note || null,
        })),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('Failed to save splits', err);
      alert('Failed to save splits.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Clear all splits for this transaction?')) return;
    setSaving(true);
    try {
      await api.post('/transactions/split', {
        accountId: transaction.accountId,
        bankReference: transaction.bankReference || transaction.id,
        bankType: transaction.bankType || '',
        splits: [],
      });
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('Failed to clear splits', err);
    } finally {
      setSaving(false);
    }
  };

  if (!open || !transaction) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Split Transaction"
      subtitle={`Divide ${transaction.merchant || transaction.description} into multiple categories.`}
      width={560}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}>
        {/* Total info banner */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          background: 'var(--surface-2)',
          borderRadius: '10px',
        }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Original Amount</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-main)' }}>
              {fmt.format(parentAmount)}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Remaining Unallocated</div>
            <div style={{
              fontSize: '16px',
              fontWeight: 800,
              color: isBalanced ? 'var(--success)' : 'var(--danger)',
            }}>
              {isBalanced ? '✓ Balanced' : fmt.format(remaining)}
            </div>
          </div>
        </div>

        {/* Split rows */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Loading splits…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
            {splits.map((s, idx) => (
              <div
                key={idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px 140px 1fr 32px',
                  gap: '8px',
                  alignItems: 'center',
                  background: 'var(--surface)',
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                }}
              >
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Amount"
                  value={s.amount}
                  onChange={e => updateRow(idx, 'amount', e.target.value)}
                  style={{
                    padding: '7px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface-2)',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                />

                <select
                  value={s.category}
                  onChange={e => updateRow(idx, 'category', e.target.value)}
                  style={{
                    padding: '7px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface-2)',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                  }}
                >
                  <option value="">Select Category</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>

                <input
                  type="text"
                  placeholder="Note / detail (optional)"
                  value={s.note}
                  onChange={e => updateRow(idx, 'note', e.target.value)}
                  style={{
                    padding: '7px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface-2)',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                  }}
                />

                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  disabled={splits.length <= 1}
                  className="btn icon"
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '6px',
                    color: splits.length <= 1 ? 'var(--text-faint)' : 'var(--danger)',
                    border: 'none',
                    cursor: splits.length <= 1 ? 'not-allowed' : 'pointer',
                  }}
                  title="Remove split row"
                >
                  <FiTrash2 size={14} />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addRow}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '8px',
                borderRadius: '8px',
                border: '1px dashed var(--border-color)',
                background: 'transparent',
                color: 'var(--primary)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                marginTop: '4px',
              }}
            >
              <FiPlus size={14} /> Add Another Category Split
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
          <button
            type="button"
            onClick={handleClear}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--danger)',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Remove All Splits
          </button>

          <div style={{ display: 'flex', gap: '10px' }}>
            <Button variant="secondary" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !isBalanced} type="button">
              {saving ? 'Saving…' : 'Save Splits'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
