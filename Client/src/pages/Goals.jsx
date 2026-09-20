import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiTarget, FiCalendar, FiCheckCircle, FiDollarSign } from 'react-icons/fi';
import api from '../api/client';
import StatCard from '../components/StatCard';
import { Modal, EmptyState, Badge, Button } from '@common/client';
import { currencyFormatter as fmt, isAmountMasked, MASKED_AMOUNT } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';

export default function Goals() {
  usePrivacy();
  const [goals, setGoals] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // Modals
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const [contributeGoal, setContributeGoal] = useState(null);
  const [contribAmount, setContribAmount] = useState('');
  const [formState, setFormState] = useState({
    name: '',
    targetAmount: '',
    currentSaved: '',
    targetDate: '',
    category: '',
    notes: '',
  });

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/goals').then(r => r.data || []),
      api.get('/goals/summary').then(r => r.data || null),
    ])
      .then(([g, s]) => {
        setGoals(g);
        setSummary(s);
      })
      .catch(err => {
        console.error('Failed to load goals', err);
        setGoals([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setEditingGoal(null);
    setFormState({
      name: '',
      targetAmount: '',
      currentSaved: '',
      targetDate: '',
      category: '',
      notes: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (g) => {
    setEditingGoal(g);
    setFormState({
      name: g.name,
      targetAmount: g.targetAmount,
      currentSaved: g.currentSaved,
      targetDate: g.targetDate || '',
      category: g.category || '',
      notes: g.notes || '',
    });
    setModalOpen(true);
  };

  const handleSaveGoal = async (e) => {
    e.preventDefault();
    const payload = {
      name: formState.name,
      targetAmount: parseFloat(formState.targetAmount) || 0,
      currentSaved: parseFloat(formState.currentSaved) || 0,
      targetDate: formState.targetDate ? formState.targetDate : null,
      category: formState.category,
      notes: formState.notes,
    };

    if (editingGoal) {
      await api.put(`/goals/${editingGoal.id}`, payload);
    } else {
      await api.post('/goals', payload);
    }
    setModalOpen(false);
    loadData();
  };

  const handleDeleteGoal = async (id) => {
    if (!window.confirm('Are you sure you want to delete this savings goal?')) return;
    await api.delete(`/goals/${id}`);
    loadData();
  };

  const handleAddContribution = async (e) => {
    e.preventDefault();
    const amt = parseFloat(contribAmount);
    if (!amt || amt <= 0) return;

    await api.post(`/goals/${contributeGoal.id}/contribute`, { amount: amt });
    setContributeGoal(null);
    setContribAmount('');
    loadData();
  };

  const completedCount = useMemo(() => goals.filter(g => g.percent >= 100).length, [goals]);

  return (
    <div style={{ padding: '28px 32px', background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Top stats */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <StatCard
          label="Total Target"
          value={summary ? fmt.format(summary.totalTarget) : '—'}
          sub={`${summary?.activeGoalsCount || 0} active goal${summary?.activeGoalsCount === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Total Saved"
          value={summary ? fmt.format(summary.totalSaved) : '—'}
          valueColor="var(--success)"
          sub={summary ? `${summary.overallPercent}% of total target` : ''}
          accent="var(--success)"
        />
        <StatCard
          label="Remaining Needed"
          value={summary ? fmt.format(Math.max(0, summary.totalTarget - summary.totalSaved)) : '—'}
          sub={completedCount > 0 ? `${completedCount} goal completed!` : 'Across all goals'}
        />
      </div>

      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Your Savings Goals</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Set targets for major purchases, emergency funds, or vacations.
          </p>
        </div>
        <Button onClick={openCreateModal} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <FiPlus size={16} /> New Goal
        </Button>
      </div>

      {/* Goals Grid */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading goals…</div>
      ) : goals.length === 0 ? (
        <div style={{ background: 'var(--surface)', padding: '40px', borderRadius: '14px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <EmptyState
            icon="🎯"
            title="No savings goals yet"
            subtitle="Create your first savings goal to track your progress towards financial milestones."
          />
          <div style={{ marginTop: '16px' }}>
            <Button onClick={openCreateModal}>
              <FiPlus size={15} style={{ marginRight: '6px' }} /> Create Goal
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '18px' }}>
          {goals.map(g => {
            const isDone = g.percent >= 100;
            const meterColor = isDone ? 'var(--success)' : g.percent >= 75 ? '#38bdf8' : 'var(--primary)';
            return (
              <div
                key={g.id}
                style={{
                  background: 'var(--surface)',
                  borderRadius: '14px',
                  padding: '22px',
                  border: '1px solid var(--border-color)',
                  boxShadow: 'var(--shadow-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  position: 'relative',
                }}
              >
                <div>
                  {/* Top line: Name + Category badge + Actions */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '14px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                          {g.name}
                        </h3>
                        {g.category && (
                          <Badge variant="secondary" style={{ fontSize: '11px', padding: '2px 8px' }}>
                            {g.category}
                          </Badge>
                        )}
                        {isDone && (
                          <Badge variant="green" style={{ fontSize: '11px', padding: '2px 8px' }}>
                            Completed
                          </Badge>
                        )}
                      </div>
                      {g.notes && (
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>{g.notes}</p>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => openEditModal(g)}
                        className="btn icon"
                        style={{ width: '28px', height: '28px', borderRadius: '6px', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
                        title="Edit goal"
                      >
                        <FiEdit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDeleteGoal(g.id)}
                        className="btn icon"
                        style={{ width: '28px', height: '28px', borderRadius: '6px', color: 'var(--danger)', border: '1px solid var(--border-color)' }}
                        title="Delete goal"
                      >
                        <FiTrash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Amounts row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                      {isAmountMasked() ? MASKED_AMOUNT : fmt.format(g.currentSaved)}
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      of {isAmountMasked() ? MASKED_AMOUNT : fmt.format(g.targetAmount)}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div style={{ height: '8px', background: 'var(--surface-2)', borderRadius: '6px', overflow: 'hidden', marginBottom: '14px' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(g.percent, 3))}%`,
                        background: meterColor,
                        borderRadius: '6px',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>

                  {/* Details stats */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    <span>{g.percent}% saved</span>
                    <span>{isAmountMasked() ? MASKED_AMOUNT : fmt.format(g.remaining)} to go</span>
                  </div>

                  {/* Target date & monthly plan */}
                  {g.targetDate && (
                    <div style={{ background: 'var(--surface-2)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--text-main)', marginTop: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
                        <FiCalendar size={13} />
                        <span>Target: {new Date(g.targetDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
                        {g.monthsLeft != null && <span>({g.monthsLeft} mo left)</span>}
                      </div>
                      {!isDone && g.monthlyNeeded != null && g.monthlyNeeded > 0 && (
                        <div style={{ marginTop: '4px', fontWeight: 600, color: 'var(--primary)' }}>
                          Need ~{isAmountMasked() ? MASKED_AMOUNT : fmt.format(g.monthlyNeeded)} / month
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Bottom button: Add Contribution */}
                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                  <button
                    onClick={() => {
                      setContributeGoal(g);
                      setContribAmount('');
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--text-main)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <FiDollarSign size={14} style={{ color: 'var(--success)' }} />
                    Add Savings
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create / Edit Goal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingGoal ? 'Edit Savings Goal' : 'Create Savings Goal'}
        subtitle="Track your target amount and target completion date."
        width={480}
      >
        <form onSubmit={handleSaveGoal} style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '8px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
              Goal Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Emergency Fund, New Bike, Bali Trip"
              value={formState.name}
              onChange={e => setFormState(s => ({ ...s, name: e.target.value }))}
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                Target Amount (₹) *
              </label>
              <input
                type="number"
                required
                min="1"
                placeholder="100000"
                value={formState.targetAmount}
                onChange={e => setFormState(s => ({ ...s, targetAmount: e.target.value }))}
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
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                Current Saved (₹)
              </label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={formState.currentSaved}
                onChange={e => setFormState(s => ({ ...s, currentSaved: e.target.value }))}
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
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                Target Date
              </label>
              <input
                type="date"
                value={formState.targetDate}
                onChange={e => setFormState(s => ({ ...s, targetDate: e.target.value }))}
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
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                Category
              </label>
              <input
                type="text"
                placeholder="e.g. Travel, Tech, Safety"
                value={formState.category}
                onChange={e => setFormState(s => ({ ...s, category: e.target.value }))}
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
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
              Notes (Optional)
            </label>
            <input
              type="text"
              placeholder="Any details or link"
              value={formState.notes}
              onChange={e => setFormState(s => ({ ...s, notes: e.target.value }))}
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
            <Button variant="secondary" onClick={() => setModalOpen(false)} type="button">
              Cancel
            </Button>
            <Button type="submit">
              {editingGoal ? 'Update Goal' : 'Create Goal'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Add Contribution */}
      <Modal
        open={!!contributeGoal}
        onClose={() => setContributeGoal(null)}
        title={`Add Savings: ${contributeGoal?.name}`}
        subtitle="Log an addition towards this goal."
        width={400}
      >
        <form onSubmit={handleAddContribution} style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '8px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
              Amount to Add (₹) *
            </label>
            <input
              type="number"
              required
              min="1"
              autoFocus
              placeholder="e.g. 5000"
              value={contribAmount}
              onChange={e => setContribAmount(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--surface)',
                color: 'var(--text-main)',
                fontSize: '15px',
                fontWeight: 600,
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
            <Button variant="secondary" onClick={() => setContributeGoal(null)} type="button">
              Cancel
            </Button>
            <Button type="submit">
              Add to Goal
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
