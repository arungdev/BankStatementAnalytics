import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiPlus, FiCheck, FiX, FiUsers, FiClock, FiAlertCircle,
  FiDollarSign, FiTrash2, FiLink, FiEdit2, FiScissors, FiSearch, FiFileText
} from 'react-icons/fi';
import api from '../api/client';
import { currencyFormatter, maskName } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';
import { Modal, Button, EmptyState } from '@common/client';
import StatCard from '../components/StatCard';
import {
  getSplitGroups, getSplitSuggestions, createSplitGroup,
  updateSplitGroup, updateSplitMember, linkTransactionToMember,
  unlinkTransactionFromMember, deleteSplitMember, deleteSplitGroup,
  getCandidateTransactions
} from '../api/splits';

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function Splits() {
  usePrivacy();
  const [activeTab, setActiveTab] = useState('suggestions');
  const [suggestions, setSuggestions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [pickerModalOpen, setPickerModalOpen] = useState(false);
  const [pickerType, setPickerType] = useState('debit'); // 'debit' for parent bill, 'credit' for participant
  const [pickerSearch, setPickerSearch] = useState('');
  const [candidateTxs, setCandidateTxs] = useState([]);
  const [loadingTxs, setLoadingTxs] = useState(false);

  // In-line transaction linking state for existing group member
  const [linkingMemberContext, setLinkingMemberContext] = useState(null); // { groupId, member }

  // Form states for Create / Edit Split Group
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formTotal, setFormTotal] = useState('');
  const [formUserShare, setFormUserShare] = useState('');
  const [parentTx, setParentTx] = useState(null); // { accountId, bankReference, bankType, ... }
  const [formMembers, setFormMembers] = useState([]);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      getSplitSuggestions().then(res => res.data || []).catch(() => []),
      getSplitGroups().then(res => res.data || []).catch(() => [])
    ])
      .then(([suggs, grps]) => {
        setSuggestions(suggs);
        setGroups(grps);
        if (suggs.length === 0 && grps.length > 0) {
          setActiveTab('groups');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Summary stats
  const stats = useMemo(() => {
    const totalGroups = groups.length;
    const totalBillVolume = groups.reduce((sum, g) => sum + (g.totalAmount || 0), 0);
    const totalSettled = groups.reduce((sum, g) => sum + (g.settledAmount || 0), 0);
    const totalPending = groups.reduce((sum, g) => sum + (g.pendingAmount || 0), 0);
    return { totalGroups, totalBillVolume, totalSettled, totalPending };
  }, [groups]);

  // Open Create Modal empty or populated from a suggestion
  const openCreateModal = (suggestion = null) => {
    if (suggestion) {
      setFormTitle(suggestion.parentDebit?.counterPartyName ? `Split: ${suggestion.parentDebit.counterPartyName}` : `Bill Split on ${fmtDate(suggestion.date)}`);
      setFormDate(suggestion.date ? suggestion.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
      setFormTotal(suggestion.inferredTotalAmount?.toString() || '');
      setFormUserShare(suggestion.inferredUserShare?.toString() || '');
      if (suggestion.parentDebit) {
        setParentTx({
          accountId: suggestion.parentDebit.accountId,
          bankReference: suggestion.parentDebit.bankReference,
          bankType: suggestion.parentDebit.bankType,
          transactionType: suggestion.parentDebit.transactionType || 'DR',
          amount: suggestion.parentDebit.amount,
          narration: suggestion.parentDebit.narration,
          counterPartyName: suggestion.parentDebit.counterPartyName
        });
      } else {
        setParentTx(null);
      }
      setFormMembers(
        (suggestion.suggestedMembers || []).map(m => ({
          participantName: m.name || '',
          participantVpa: m.vpa || '',
          assignedAmount: m.assignedAmount?.toString() || '',
          isSettled: true,
          isUser: false,
          linkedAccountId: m.accountId,
          linkedBankReference: m.bankReference,
          linkedBankType: m.bankType,
          linkedTransactionType: m.transactionType || 'CR',
          paidAmount: m.assignedAmount || 0
        }))
      );
    } else {
      setFormTitle('');
      setFormDate(new Date().toISOString().slice(0, 10));
      setFormTotal('');
      setFormUserShare('');
      setParentTx(null);
      setFormMembers([]);
    }
    setCreateModalOpen(true);
  };

  // Open transaction picker (type = 'debit' for parent bill, 'credit' for a member payment)
  const openTransactionPicker = (type, forMemberLink = null) => {
    setPickerType(type);
    setLinkingMemberContext(forMemberLink);
    setPickerSearch('');
    setPickerModalOpen(true);
    fetchPickerTransactions(type, '');
  };

  const fetchPickerTransactions = (type, search) => {
    setLoadingTxs(true);
    getCandidateTransactions(type, search)
      .then(res => setCandidateTxs(res.data || []))
      .catch(() => setCandidateTxs([]))
      .finally(() => setLoadingTxs(false));
  };

  const handleSelectTransactionFromPicker = (tx) => {
    if (linkingMemberContext) {
      // Linking an existing confirmed member's share
      handleLinkTxToMember(linkingMemberContext.groupId, linkingMemberContext.member.id, tx);
      setPickerModalOpen(false);
      setLinkingMemberContext(null);
      return;
    }

    if (pickerType === 'debit') {
      // Picked as the Parent Bill transaction
      setParentTx(tx);
      setFormTitle(`Split: ${tx.counterPartyName || tx.narration || 'Bill'}`);
      setFormDate(tx.date ? tx.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
      setFormTotal((tx.debit || tx.amount).toString());
      // Re-estimate user share if members exist
      const total = tx.debit || tx.amount;
      const count = formMembers.length + 1;
      setFormUserShare((Math.round((total / count) * 100) / 100).toString());
    } else {
      // Picked as a participant who ALREADY PAID
      const friendName = tx.counterPartyName || tx.upiVpa?.split('@')[0] || 'Friend';
      const paidAmount = tx.credit || tx.amount;
      setFormMembers(prev => [
        ...prev,
        {
          participantName: friendName,
          participantVpa: tx.upiVpa || '',
          assignedAmount: paidAmount.toString(),
          paidAmount: paidAmount,
          isSettled: true,
          isUser: false,
          linkedAccountId: tx.accountId,
          linkedBankReference: tx.bankReference,
          linkedBankType: tx.bankType,
          linkedTransactionType: tx.transactionType || 'CR',
          notes: `Paid via ${tx.bankReference}`
        }
      ]);
    }
    setPickerModalOpen(false);
  };

  const handleAddManualMember = () => {
    setFormMembers(prev => [
      ...prev,
      {
        participantName: `Friend ${prev.length + 1}`,
        participantVpa: '',
        assignedAmount: '',
        paidAmount: 0,
        isSettled: false,
        isUser: false
      }
    ]);
  };

  const handleRemoveMember = (idx) => {
    setFormMembers(prev => prev.filter((_, i) => i !== idx));
  };

  const handleMemberChange = (idx, field, val) => {
    setFormMembers(prev => prev.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  };

  const handleSplitEvenly = () => {
    const total = parseFloat(formTotal);
    if (!total || total <= 0) return;
    const totalHeads = formMembers.length + 1; // user + participants
    const share = Math.round((total / totalHeads) * 100) / 100;
    setFormUserShare(share.toString());
    setFormMembers(prev => prev.map(m => ({ ...m, assignedAmount: share.toString() })));
  };

  const handleSaveGroup = async () => {
    if (!formTitle.trim()) {
      alert('Please enter a title for the split group.');
      return;
    }
    const total = parseFloat(formTotal) || 0;
    const userShare = parseFloat(formUserShare) || 0;

    const membersPayload = formMembers.map(m => ({
      participantName: m.participantName || 'Friend',
      participantVpa: m.participantVpa || null,
      assignedAmount: parseFloat(m.assignedAmount) || 0,
      paidAmount: m.isSettled ? (parseFloat(m.assignedAmount) || 0) : 0,
      isSettled: !!m.isSettled,
      isUser: false,
      linkedAccountId: m.linkedAccountId || null,
      linkedBankReference: m.linkedBankReference || null,
      linkedBankType: m.linkedBankType || null,
      linkedTransactionType: m.linkedTransactionType || 'CR',
      notes: m.notes || null
    }));

    setBusy(true);
    try {
      await createSplitGroup({
        title: formTitle.trim(),
        date: formDate ? new Date(formDate).toISOString() : new Date().toISOString(),
        totalAmount: total,
        userShareAmount: userShare,
        confidence: 'Confirmed',
        splitType: 'GPaySplit',
        parentAccountId: parentTx?.accountId || null,
        parentBankReference: parentTx?.bankReference || null,
        parentBankType: parentTx?.bankType || null,
        parentTransactionType: parentTx?.transactionType || null,
        members: membersPayload
      });
      setCreateModalOpen(false);
      loadData();
      setActiveTab('groups');
    } catch (err) {
      console.error('Failed to create split group', err);
      alert('Failed to save split group.');
    } finally {
      setBusy(false);
    }
  };

  const handleLinkTxToMember = async (groupId, memberId, tx) => {
    setBusy(true);
    try {
      await linkTransactionToMember(groupId, memberId, {
        accountId: tx.accountId,
        bankReference: tx.bankReference,
        bankType: tx.bankType,
        transactionType: tx.transactionType || 'CR',
        amount: tx.credit || tx.amount
      });
      loadData();
    } catch (err) {
      console.error('Failed to link transaction', err);
      alert('Failed to link transaction.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlinkTx = async (groupId, memberId) => {
    if (!window.confirm('Unlink this payment and mark pending?')) return;
    setBusy(true);
    try {
      await unlinkTransactionFromMember(groupId, memberId);
      loadData();
    } catch (err) {
      console.error('Failed to unlink transaction', err);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGroup = async (id) => {
    if (!window.confirm('Delete this split group? This cannot be undone.')) return;
    setBusy(true);
    try {
      await deleteSplitGroup(id);
      loadData();
    } catch (err) {
      console.error('Failed to delete split group', err);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSettled = async (groupId, member) => {
    setBusy(true);
    try {
      await updateSplitMember(groupId, member.id, {
        isSettled: !member.isSettled,
        paidAmount: !member.isSettled ? member.assignedAmount : 0
      });
      loadData();
    } catch (err) {
      console.error('Failed to update member status', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="splits-page" style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header & Stat Cards */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Bill Splits & Groups</h1>
          <p style={{ color: 'var(--text-muted, #666)', fontSize: '14px', margin: '4px 0 0' }}>
            Auto-detect Google Pay group splits and manually track who owes you
          </p>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => openCreateModal()}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '8px' }}
        >
          <FiPlus size={16} /> New Split Group
        </button>
      </div>

      {/* Branded KPI Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <StatCard label="Split Groups" value={stats.totalGroups} sub="Active & settled bills" />
        <StatCard label="Total Bill Volume" value={currencyFormatter.format(stats.totalBillVolume)} sub="Combined expenses" />
        <StatCard label="Settled Repayments" value={currencyFormatter.format(stats.totalSettled)} sub="Collected from friends" accent="var(--success, #10b981)" />
        <StatCard label="Pending Due" value={currencyFormatter.format(stats.totalPending)} sub="Remaining to collect" accent="var(--danger, #ef4444)" />
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--border, #e5e7eb)', marginBottom: '20px', display: 'flex', gap: '24px' }}>
        <button
          onClick={() => setActiveTab('suggestions')}
          style={{
            padding: '12px 4px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'suggestions' ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
            color: activeTab === 'suggestions' ? 'var(--primary, #3b82f6)' : 'var(--text-muted, #6b7280)',
            fontWeight: activeTab === 'suggestions' ? 600 : 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>Auto-Detected Suggestions</span>
          {suggestions.length > 0 && (
            <span style={{
              background: '#3b82f6', color: '#fff', fontSize: '11px', fontWeight: 700,
              padding: '2px 8px', borderRadius: '999px'
            }}>
              {suggestions.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('groups')}
          style={{
            padding: '12px 4px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'groups' ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
            color: activeTab === 'groups' ? 'var(--primary, #3b82f6)' : 'var(--text-muted, #6b7280)',
            fontWeight: activeTab === 'groups' ? 600 : 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>Confirmed Groups & Splits ({groups.length})</span>
        </button>
      </div>

      {/* ── TAB 1: SUGGESTIONS ── */}
      {activeTab === 'suggestions' && (
        <div>
          {suggestions.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--card-bg, #fff)', borderRadius: '12px', border: '1px solid var(--border, #e5e7eb)' }}>
              <FiCheck size={36} style={{ color: 'var(--success, #10b981)', marginBottom: '12px' }} />
              <h3 style={{ margin: '0 0 8px', fontSize: '18px' }}>No Pending Split Suggestions</h3>
              <p style={{ color: 'var(--text-muted, #6b7280)', maxWidth: '460px', margin: '0 auto 20px', fontSize: '14px' }}>
                When multiple friends send you UPI/GPay payments for dinner or group expenses, they will automatically appear here for one-click confirmation.
              </p>
              <button className="btn btn--primary" onClick={() => openCreateModal()}>
                + Create Split Manually
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {suggestions.map((sugg, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'var(--card-bg, #fff)',
                    borderRadius: '12px',
                    border: '1px solid var(--border, #e5e7eb)',
                    padding: '20px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{
                          background: sugg.confidence === 'Medium' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                          color: sugg.confidence === 'Medium' ? '#d97706' : '#2563eb',
                          fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px'
                        }}>
                          {sugg.classification} ({sugg.confidence} Match)
                        </span>
                        <span style={{ fontSize: '13px', color: 'var(--text-muted, #6b7280)' }}>
                          {fmtDate(sugg.date)}
                        </span>
                      </div>
                      <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 600 }}>
                        {sugg.parentDebit?.counterPartyName ? `Bill to ${sugg.parentDebit.counterPartyName}` : 'Incoming Group Repayments'}
                      </h3>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted, #6b7280)' }}>
                        Inferred Total: <strong>{currencyFormatter.format(sugg.inferredTotalAmount)}</strong> &nbsp;|&nbsp;
                        Credits Received: <strong style={{ color: 'var(--success, #10b981)' }}>{currencyFormatter.format(sugg.creditSum)}</strong> &nbsp;|&nbsp;
                        Your Net Share: <strong>{currencyFormatter.format(sugg.inferredUserShare)}</strong>
                      </div>
                    </div>
                    <button
                      className="btn btn--primary"
                      onClick={() => openCreateModal(sugg)}
                      style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <FiCheck size={14} /> Review & Confirm Split
                    </button>
                  </div>

                  {/* Evidence list */}
                  <div style={{ background: 'var(--bg-subtle, #f9fafb)', borderRadius: '8px', padding: '12px', marginBottom: '14px', fontSize: '12px' }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text-muted, #4b5563)' }}>DETECTION SIGNALS:</div>
                    <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-muted, #6b7280)' }}>
                      {(sugg.evidence || []).map((ev, i) => (
                        <li key={i}>{ev}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Participant shares */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    {(sugg.suggestedMembers || []).map((m, i) => (
                      <div key={i} style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px', padding: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600 }}>{maskName(m.name)}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted, #9ca3af)' }}>{m.vpa || 'UPI Payment'}</div>
                        </div>
                        <div style={{ fontWeight: 700, color: 'var(--success, #10b981)', fontSize: '13px' }}>
                          +{currencyFormatter.format(m.assignedAmount)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: CONFIRMED GROUPS ── */}
      {activeTab === 'groups' && (
        <div>
          {groups.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--card-bg, #fff)', borderRadius: '12px', border: '1px solid var(--border, #e5e7eb)' }}>
              <FiScissors size={36} style={{ color: 'var(--primary, #3b82f6)', marginBottom: '12px' }} />
              <h3 style={{ margin: '0 0 8px', fontSize: '18px' }}>No Split Groups Yet</h3>
              <p style={{ color: 'var(--text-muted, #6b7280)', maxWidth: '460px', margin: '0 auto 20px', fontSize: '14px' }}>
                Create a split group to divide a dinner, trip, or rent bill with friends and track repayments.
              </p>
              <button className="btn btn--primary" onClick={() => openCreateModal()}>
                + Create Your First Split Group
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {groups.map(group => {
                const pctSettled = group.totalAmount > 0
                  ? Math.min(100, Math.round(((group.settledAmount + group.userShareAmount) / group.totalAmount) * 100))
                  : 0;

                return (
                  <div
                    key={group.id}
                    style={{
                      background: 'var(--card-bg, #fff)',
                      borderRadius: '12px',
                      border: '1px solid var(--border, #e5e7eb)',
                      padding: '20px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{
                            background: group.status === 'Settled' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                            color: group.status === 'Settled' ? '#059669' : '#d97706',
                            fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px'
                          }}>
                            {group.status}
                          </span>
                          <span style={{ fontSize: '13px', color: 'var(--text-muted, #6b7280)' }}>
                            {fmtDate(group.date)}
                          </span>
                        </div>
                        <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 700 }}>{group.title}</h3>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted, #6b7280)' }}>
                          Total Bill: <strong>{currencyFormatter.format(group.totalAmount)}</strong> &nbsp;|&nbsp;
                          Your Share: <strong>{currencyFormatter.format(group.userShareAmount)}</strong> &nbsp;|&nbsp;
                          Recovered: <strong style={{ color: 'var(--success, #10b981)' }}>{currencyFormatter.format(group.settledAmount)}</strong>
                          {group.pendingAmount > 0 && (
                            <span style={{ color: 'var(--danger, #ef4444)', marginLeft: '8px', fontWeight: 600 }}>
                              (Pending: {currencyFormatter.format(group.pendingAmount)})
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        className="btn btn--outline"
                        onClick={() => handleDeleteGroup(group.id)}
                        style={{ padding: '6px 10px', color: 'var(--danger, #ef4444)', borderColor: 'var(--border, #e5e7eb)', borderRadius: '6px' }}
                        title="Delete group"
                      >
                        <FiTrash2 size={14} />
                      </button>
                    </div>

                    {/* Progress Bar */}
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                        <span>Settlement Progress</span>
                        <span style={{ fontWeight: 600 }}>{pctSettled}%</span>
                      </div>
                      <div style={{ height: '8px', background: 'var(--border, #e5e7eb)', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${pctSettled}%`,
                          background: pctSettled === 100 ? 'var(--success, #10b981)' : 'var(--primary, #3b82f6)',
                          transition: 'width 0.3s'
                        }} />
                      </div>
                    </div>

                    {/* Participants table */}
                    <div style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-subtle, #f9fafb)', textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                            <th style={{ padding: '8px 12px', fontWeight: 600 }}>Participant</th>
                            <th style={{ padding: '8px 12px', fontWeight: 600 }}>Assigned Split</th>
                            <th style={{ padding: '8px 12px', fontWeight: 600 }}>Paid</th>
                            <th style={{ padding: '8px 12px', fontWeight: 600 }}>Status</th>
                            <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* User's own share row */}
                          <tr style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                              You (Personal Share)
                            </td>
                            <td style={{ padding: '10px 12px' }}>{currencyFormatter.format(group.userShareAmount)}</td>
                            <td style={{ padding: '10px 12px' }}>{currencyFormatter.format(group.userShareAmount)}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ background: 'rgba(16,185,129,0.1)', color: '#059669', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                Paid (Self)
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>—</td>
                          </tr>

                          {/* Member rows */}
                          {(group.members || []).map(m => (
                            <tr key={m.id} style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                              <td style={{ padding: '10px 12px' }}>
                                <div style={{ fontWeight: 600 }}>{m.participantName}</div>
                                {m.participantVpa && <div style={{ fontSize: '11px', color: 'var(--text-muted, #9ca3af)' }}>{m.participantVpa}</div>}
                                {m.linkedBankReference && (
                                  <div style={{ fontSize: '10px', color: 'var(--primary, #3b82f6)', display: 'flex', alignItems: 'center', gap: '3px', marginTop: '2px' }}>
                                    <FiLink size={10} /> Linked: {m.linkedBankReference}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                                {currencyFormatter.format(m.assignedAmount)}
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                {currencyFormatter.format(m.paidAmount)}
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <span style={{
                                  background: m.isSettled ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                  color: m.isSettled ? '#059669' : '#dc2626',
                                  fontSize: '11px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600
                                }}>
                                  {m.isSettled ? 'Settled' : 'Pending'}
                                </span>
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                  <button
                                    onClick={() => handleToggleSettled(group.id, m)}
                                    style={{
                                      fontSize: '12px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border, #e5e7eb)',
                                      background: m.isSettled ? 'transparent' : 'rgba(16,185,129,0.1)',
                                      color: m.isSettled ? 'var(--text-main)' : '#059669', cursor: 'pointer'
                                    }}
                                  >
                                    {m.isSettled ? 'Mark Pending' : 'Mark Settled'}
                                  </button>
                                  {m.linkedBankReference ? (
                                    <button
                                      onClick={() => handleUnlinkTx(group.id, m.id)}
                                      style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border, #e5e7eb)', background: 'none', cursor: 'pointer' }}
                                      title="Unlink transaction"
                                    >
                                      Unlink Tx
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => openTransactionPicker('credit', { groupId: group.id, member: m })}
                                      style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border, #e5e7eb)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    >
                                      <FiLink size={12} /> Link Bank Tx
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── CREATE / EDIT SPLIT GROUP MODAL ── */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create Bill Split Group"
        subtitle="Select the bill expense, add participants who already paid from transactions, and assign split shares"
        width={680}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '12px 0' }}>

          {/* Step 1: Select Bill / Expense from Transactions */}
          <div style={{ background: 'var(--bg-subtle, #f9fafb)', border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>1. Primary Bill / Expense Transaction</span>
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => openTransactionPicker('debit')}
                style={{ fontSize: '12px', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <FiSearch size={13} /> Select from Bank Transactions
              </button>
            </div>
            {parentTx ? (
              <div style={{ background: 'var(--card-bg, #fff)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border, #e5e7eb)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>{parentTx.counterPartyName || parentTx.narration}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {fmtDate(parentTx.date)} &bull; Ref: {parentTx.bankReference}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontWeight: 700, color: 'var(--danger, #ef4444)', fontSize: '14px' }}>
                    -{currencyFormatter.format(parentTx.debit || parentTx.amount)}
                  </span>
                  <button
                    onClick={() => setParentTx(null)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                    title="Remove link"
                  >
                    <FiX size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                No transaction linked yet. You can click &quot;Select from Bank Transactions&quot; or type the total below.
              </div>
            )}
          </div>

          {/* Step 2: Basic details */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Title / Event</label>
            <input
              type="text"
              className="field-input"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border, #d1d5db)' }}
              placeholder="e.g. Dinner with Friends, Goa Trip, Flat Electricity"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Date</label>
              <input
                type="date"
                className="field-input"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border, #d1d5db)' }}
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Total Bill (₹)</label>
              <input
                type="number"
                step="0.01"
                className="field-input"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border, #d1d5db)' }}
                placeholder="1200.00"
                value={formTotal}
                onChange={e => setFormTotal(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Your Share (₹)</label>
              <input
                type="number"
                step="0.01"
                className="field-input"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border, #d1d5db)' }}
                placeholder="300.00"
                value={formUserShare}
                onChange={e => setFormUserShare(e.target.value)}
              />
            </div>
          </div>

          {/* Step 3: Participants (select who already paid from transactions, or add pending) */}
          <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>2. Participant Assigned Amounts</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleSplitEvenly}
                  style={{ fontSize: '12px', color: 'var(--primary, #3b82f6)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                >
                  ⚡ Split Evenly
                </button>
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => openTransactionPicker('credit')}
                  style={{ fontSize: '12px', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'var(--success, #10b981)', color: '#059669' }}
                >
                  <FiPlus size={13} /> Select from Paid Transaction
                </button>
              </div>
            </div>

            {formMembers.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', background: 'var(--bg-subtle, #f9fafb)', borderRadius: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                No participants added yet. Click &quot;Select from Paid Transaction&quot; if someone already sent money via UPI, or &quot;Add Friend (Pending)&quot;.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {formMembers.map((m, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 100px 90px 30px', gap: '8px', alignItems: 'center',
                      background: m.isSettled ? 'rgba(16,185,129,0.05)' : 'var(--card-bg, #fff)',
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border, #e5e7eb)'
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Friend's Name"
                      style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border, #d1d5db)', fontSize: '13px' }}
                      value={m.participantName}
                      onChange={e => handleMemberChange(idx, 'participantName', e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="UPI VPA (name@okaxis)"
                      style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border, #d1d5db)', fontSize: '13px' }}
                      value={m.participantVpa || ''}
                      onChange={e => handleMemberChange(idx, 'participantVpa', e.target.value)}
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="₹ Amount"
                      style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border, #d1d5db)', fontSize: '13px' }}
                      value={m.assignedAmount}
                      onChange={e => handleMemberChange(idx, 'assignedAmount', e.target.value)}
                    />
                    <div>
                      <span style={{
                        background: m.isSettled ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                        color: m.isSettled ? '#059669' : '#d97706',
                        fontSize: '11px', padding: '3px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-block'
                      }}>
                        {m.isSettled ? '✓ Paid' : 'Pending'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger, #ef4444)', cursor: 'pointer' }}
                      title="Remove"
                    >
                      <FiTrash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: '10px' }}>
              <button
                type="button"
                onClick={handleAddManualMember}
                style={{ fontSize: '12px', padding: '6px 12px', border: '1px dashed var(--border, #d1d5db)', borderRadius: '6px', background: 'none', cursor: 'pointer' }}
              >
                + Add Friend (Pending Due)
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <button className="btn btn--outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={handleSaveGroup} disabled={busy}>
              {busy ? 'Saving...' : 'Save Split Group'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── TRANSACTION PICKER MODAL (For selecting bill or repayment) ── */}
      <Modal
        open={pickerModalOpen}
        onClose={() => { setPickerModalOpen(false); setLinkingMemberContext(null); }}
        title={pickerType === 'debit' ? 'Select Expense / Bill Transaction' : 'Select Incoming Repayment Transaction'}
        subtitle={pickerType === 'debit' ? 'Choose the primary debit transaction for this split bill' : 'Choose the credit transaction where your friend sent money'}
        width={580}
      >
        <div style={{ padding: '12px 0' }}>
          {/* Search bar */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            <input
              type="text"
              placeholder="Search by merchant, friend name, VPA or amount..."
              value={pickerSearch}
              onChange={e => {
                setPickerSearch(e.target.value);
                fetchPickerTransactions(pickerType, e.target.value);
              }}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: '6px',
                border: '1px solid var(--border, #d1d5db)', fontSize: '13px'
              }}
            />
          </div>

          {loadingTxs ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading transactions...</div>
          ) : candidateTxs.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>No matching transactions found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '360px', overflowY: 'auto' }}>
              {candidateTxs.map((tx, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelectTransactionFromPicker(tx)}
                  style={{
                    padding: '10px 14px',
                    border: '1px solid var(--border, #e5e7eb)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--card-bg, #fff)',
                    transition: 'border-color 0.15s, background 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary, #3b82f6)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border, #e5e7eb)'}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{tx.counterPartyName || tx.narration}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted, #9ca3af)' }}>
                      {fmtDate(tx.date)} &bull; {tx.upiVpa || tx.mode} &bull; {tx.bankReference}
                    </div>
                  </div>
                  <div style={{
                    fontWeight: 700,
                    color: tx.direction === 'Credit' ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                    fontSize: '14px'
                  }}>
                    {tx.direction === 'Credit' ? '+' : '-'}{currencyFormatter.format(tx.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
}
