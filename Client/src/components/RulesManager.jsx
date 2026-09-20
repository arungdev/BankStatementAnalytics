import { useState, useEffect, useCallback } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiPlay, FiCheck, FiRefreshCw, FiZap } from 'react-icons/fi';
import api from '../api/client';
import { Button, Modal, EmptyState, Switch, Badge } from '@common/client';
import { currencyFormatter as fmt } from '../utils/format';

export default function RulesManager() {
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applyingAll, setApplyingAll] = useState(false);
  const [applyResult, setApplyResult] = useState(null);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [form, setForm] = useState({
    name: '',
    enabled: true,
    narrationContains: '',
    narrationRegex: '',
    minAmount: '',
    maxAmount: '',
    modeEquals: '',
    bankEquals: '',
    setCategory: '',
    setSubCategory: '',
    setTags: '',
    setNote: '',
  });

  // Test matches preview
  const [testMatches, setTestMatches] = useState(null);
  const [testing, setTesting] = useState(false);

  const loadRules = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/rules').then(r => r.data || []),
      api.get('/categories').then(r => r.data || []),
    ])
      .then(([r, c]) => {
        setRules(r);
        setCategories(c);
      })
      .catch(err => {
        console.error('Failed to load rules', err);
        setRules([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const openCreate = () => {
    setEditingRule(null);
    setForm({
      name: '',
      enabled: true,
      narrationContains: '',
      narrationRegex: '',
      minAmount: '',
      maxAmount: '',
      modeEquals: '',
      bankEquals: '',
      setCategory: categories[0]?.name || '',
      setSubCategory: '',
      setTags: '',
      setNote: '',
    });
    setTestMatches(null);
    setModalOpen(true);
  };

  const openEdit = (r) => {
    setEditingRule(r);
    setForm({
      name: r.name,
      enabled: r.enabled,
      narrationContains: r.narrationContains || '',
      narrationRegex: r.narrationRegex || '',
      minAmount: r.minAmount != null ? r.minAmount : '',
      maxAmount: r.maxAmount != null ? r.maxAmount : '',
      modeEquals: r.modeEquals || '',
      bankEquals: r.bankEquals || '',
      setCategory: r.setCategory || '',
      setSubCategory: r.setSubCategory || '',
      setTags: r.setTags || '',
      setNote: r.setNote || '',
    });
    setTestMatches(null);
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      enabled: form.enabled,
      narrationContains: form.narrationContains || null,
      narrationRegex: form.narrationRegex || null,
      minAmount: form.minAmount !== '' ? parseFloat(form.minAmount) : null,
      maxAmount: form.maxAmount !== '' ? parseFloat(form.maxAmount) : null,
      modeEquals: form.modeEquals || null,
      bankEquals: form.bankEquals || null,
      setCategory: form.setCategory || null,
      setSubCategory: form.setSubCategory || null,
      setTags: form.setTags || null,
      setNote: form.setNote || null,
    };

    if (editingRule) {
      await api.put(`/rules/${editingRule.id}`, payload);
    } else {
      await api.post('/rules', payload);
    }
    setModalOpen(false);
    loadRules();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this rule?')) return;
    await api.delete(`/rules/${id}`);
    loadRules();
  };

  const handleToggle = async (r) => {
    await api.put(`/rules/${r.id}`, { ...r, enabled: !r.enabled });
    loadRules();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestMatches(null);
    try {
      const res = await api.post('/rules/test', {
        ...form,
        minAmount: form.minAmount !== '' ? parseFloat(form.minAmount) : null,
        maxAmount: form.maxAmount !== '' ? parseFloat(form.maxAmount) : null,
      });
      setTestMatches(res.data || []);
    } catch (err) {
      console.error('Test failed', err);
      setTestMatches([]);
    } finally {
      setTesting(false);
    }
  };

  const handleApplyAll = async () => {
    if (!window.confirm('Apply all enabled rules to all existing transactions? This will update matching categories, tags, and notes.')) return;
    setApplyingAll(true);
    setApplyResult(null);
    try {
      const res = await api.post('/rules/apply-all');
      setApplyResult(`Success! Updated ${res.data?.updatedCount || 0} transactions.`);
    } catch (err) {
      console.error('Apply all failed', err);
      setApplyResult('Failed to apply rules.');
    } finally {
      setApplyingAll(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header Card */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>
            Auto-Categorization & Tagging Rules
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            Rules are evaluated on import. The first matching rule applies its category, tags, and notes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Button
            variant="secondary"
            onClick={handleApplyAll}
            disabled={applyingAll || rules.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <FiRefreshCw size={14} className={applyingAll ? 'spin' : ''} />
            {applyingAll ? 'Applying…' : 'Apply All Retroactively'}
          </Button>
          <Button onClick={openCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <FiPlus size={16} /> New Rule
          </Button>
        </div>
      </div>

      {applyResult && (
        <div style={{
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid var(--success)',
          color: 'var(--success)',
          fontSize: '13px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <FiCheck size={16} />
          {applyResult}
        </div>
      )}

      {/* Rules List */}
      {loading ? (
        <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading rules…</div>
      ) : rules.length === 0 ? (
        <div style={{ background: 'var(--surface)', padding: '36px', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <EmptyState
            icon="⚡"
            title="No rules created yet"
            subtitle="Create custom rules to automatically categorize frequent transactions or tag specific spends."
          />
          <div style={{ marginTop: '14px' }}>
            <Button onClick={openCreate}>
              <FiPlus size={15} style={{ marginRight: '6px' }} /> Add First Rule
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {rules.map((r, idx) => (
            <div
              key={r.id}
              style={{
                background: 'var(--surface)',
                borderRadius: '12px',
                padding: '16px 20px',
                border: '1px solid var(--border-color)',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                opacity: r.enabled ? 1 : 0.6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flex: 1, minWidth: 0 }}>
                <span style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  background: 'var(--surface-2)',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '2px',
                }}>
                  {idx + 1}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-main)' }}>{r.name}</span>
                    {!r.enabled && <Badge variant="secondary">Disabled</Badge>}
                  </div>

                  {/* Conditions & Actions pills */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px', fontSize: '12px' }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>If:</span>
                    {r.narrationContains && (
                      <span style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        Contains "{r.narrationContains}"
                      </span>
                    )}
                    {r.minAmount != null && (
                      <span style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        Amount ≥ ₹{r.minAmount}
                      </span>
                    )}
                    {r.maxAmount != null && (
                      <span style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        Amount ≤ ₹{r.maxAmount}
                      </span>
                    )}
                    {r.modeEquals && (
                      <span style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        Mode: {r.modeEquals}
                      </span>
                    )}

                    <span style={{ color: 'var(--primary)', fontWeight: 700, margin: '0 4px' }}>→ Then:</span>
                    {r.setCategory && (
                      <Badge variant="primary">Category: {r.setCategory}</Badge>
                    )}
                    {r.setTags && (
                      <span style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                        Tag: #{r.setTags}
                      </span>
                    )}
                    {r.setNote && (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Note: "{r.setNote}"
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                <Switch
                  checked={r.enabled}
                  onChange={() => handleToggle(r)}
                  title={r.enabled ? 'Disable rule' : 'Enable rule'}
                />
                <button
                  onClick={() => openEdit(r)}
                  className="btn icon"
                  style={{ width: '32px', height: '32px', borderRadius: '8px', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
                  title="Edit rule"
                >
                  <FiEdit2 size={14} />
                </button>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="btn icon"
                  style={{ width: '32px', height: '32px', borderRadius: '8px', color: 'var(--danger)', border: '1px solid var(--border-color)' }}
                  title="Delete rule"
                >
                  <FiTrash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Create/Edit Rule */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRule ? 'Edit Rule' : 'Create Categorization Rule'}
        subtitle="Define match conditions and actions to apply automatically."
        width={540}
      >
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '10px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
              Rule Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Swiggy food orders, Rent transfers"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--surface)',
                color: 'var(--text-main)',
                fontSize: '14px',
              }}
            />
          </div>

          {/* Condition section */}
          <div style={{ background: 'var(--surface-2)', padding: '14px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              1. When Transaction Matches
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                Description / Narration contains
              </label>
              <input
                type="text"
                placeholder="e.g. SWIGGY, ZOMATO, NETFLIX, SALARY"
                value={form.narrationContains}
                onChange={e => setForm(f => ({ ...f, narrationContains: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--surface)',
                  color: 'var(--text-main)',
                  fontSize: '13px',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Min Amount (₹)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 500"
                  value={form.minAmount}
                  onChange={e => setForm(f => ({ ...f, minAmount: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface)',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Max Amount (₹)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 50000"
                  value={form.maxAmount}
                  onChange={e => setForm(f => ({ ...f, maxAmount: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface)',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Payment Mode
                </label>
                <input
                  type="text"
                  placeholder="e.g. UPI, NEFT, POS"
                  value={form.modeEquals}
                  onChange={e => setForm(f => ({ ...f, modeEquals: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface)',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Bank Type
                </label>
                <select
                  value={form.bankEquals}
                  onChange={e => setForm(f => ({ ...f, bankEquals: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface)',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                  }}
                >
                  <option value="">Any Bank</option>
                  <option value="HDFC">HDFC</option>
                  <option value="IOB">IOB</option>
                  <option value="HDFCCreditCard">HDFC Credit Card</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action section */}
          <div style={{ background: 'var(--surface-2)', padding: '14px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              2. Apply These Actions
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Set Category
                </label>
                <select
                  value={form.setCategory}
                  onChange={e => setForm(f => ({ ...f, setCategory: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface)',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                  }}
                >
                  <option value="">Do not change</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Set Tags (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. food, delivery"
                  value={form.setTags}
                  onChange={e => setForm(f => ({ ...f, setTags: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface)',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                Set Note
              </label>
              <input
                type="text"
                placeholder="e.g. Auto-tagged by Swiggy rule"
                value={form.setNote}
                onChange={e => setForm(f => ({ ...f, setNote: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--surface)',
                  color: 'var(--text-main)',
                  fontSize: '13px',
                }}
              />
            </div>
          </div>

          {/* Test matches button */}
          <div>
            <Button
              variant="secondary"
              type="button"
              onClick={handleTest}
              disabled={testing}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              <FiPlay size={13} />
              {testing ? 'Testing rule…' : 'Test Rule on Recent Transactions'}
            </Button>

            {testMatches && (
              <div style={{ marginTop: '10px', padding: '10px', background: 'var(--surface-2)', borderRadius: '8px', maxHeight: '150px', overflowY: 'auto' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  {testMatches.length} sample matches found:
                </div>
                {testMatches.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No recent transactions matched this rule.</div>
                ) : (
                  testMatches.map((m, i) => (
                    <div key={i} style={{ fontSize: '11px', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                        {m.description}
                      </span>
                      <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                        → {m.newCategory}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
            <Button variant="secondary" onClick={() => setModalOpen(false)} type="button">
              Cancel
            </Button>
            <Button type="submit">
              {editingRule ? 'Update Rule' : 'Create Rule'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
