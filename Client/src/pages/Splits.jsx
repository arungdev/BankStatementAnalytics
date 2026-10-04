import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  FiPlus, FiCheck, FiX, FiUsers, FiClock, FiAlertCircle,
  FiDollarSign, FiTrash2, FiLink, FiEdit2, FiScissors, FiSearch,
  FiFileText, FiUserPlus, FiArrowRight, FiCheckCircle, FiChevronDown, FiChevronUp,
  FiUploadCloud, FiDownload, FiGift, FiRefreshCw, FiArrowLeft,
  FiChevronRight, FiMessageSquare
} from 'react-icons/fi';
import api from '../api/client';
import { currencyFormatter, maskName } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';
import { Modal, Button, EmptyState, Drawer } from '@common/client';
import StatCard from '../components/StatCard';
import GPayGroupList from '../components/GPayGroupList';
import GPayTakeoutReview from '../components/GPayTakeoutReview';
import LinkedTransactionDrawer from '../components/LinkedTransactionDrawer';
import './Splits.css';
import { getGroupDisplayMembers, isImportedGPayGroup, isImportedGPayExpense } from '../utils/groupMembers';
import {
  getSplitGroups, getSplitSuggestions, createSplitGroup,
  updateSplitGroup, updateSplitMember, linkTransactionToMember,
  unlinkTransactionFromMember, deleteSplitMember, deleteSplitGroup,
  getCandidateTransactions, getParticipantSuggestions,
  getBillGroups, getBillGroupById, createBillGroup,
  updateBillGroup, deleteBillGroup, addBillGroupMember,
  removeBillGroupMember, getTakeoutStatus, importTakeoutPath,
  importTakeoutUpload, getSplitGroupById
} from '../api/splits';

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const AVATAR_COLORS = ['#ea4335', '#1a73e8', '#fbbc04', '#34a853', '#9333ea', '#06b6d4', '#f97316', '#ec4899'];

const getAvatarColor = (name) => {
  if (!name) return '#6b7280';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const formatChatDate = (d) => {
  if (!d) return 'Recent';
  const dateObj = new Date(d);
  const now = new Date();
  const diffDays = Math.floor((now - dateObj) / (1000 * 60 * 60 * 24));
  const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  if (diffDays === 0) return `Today, ${timeStr}`;
  if (diffDays === 1) return `Yesterday, ${timeStr}`;
  return `${dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${timeStr}`;
};

export default function Splits() {
  usePrivacy();
  const location = useLocation();
  const [splitLinkError, setSplitLinkError] = useState(null);
  const [splitLinkAttempt, setSplitLinkAttempt] = useState(0);
  const [splitFilter, setSplitFilter] = useState(
    () => localStorage.getItem('bsp_gpay_split_filter') || 'all'
  );

  // Navigation tab: 'billGroups' (GPay Style), 'splits' (All Confirmed Splits), 'suggestions' (Auto-detected)
  const [activeTab, setActiveTab] = useState('billGroups');

  // GPay Group Chat state
  const [selectedBillGroupId, setSelectedBillGroupId] = useState(null);
  const [groupViewSubTab, setGroupViewSubTab] = useState('chat'); // 'chat' or 'expenses'
  const [selectedSplitDetail, setSelectedSplitDetail] = useState(null);
  const [linkedTransaction, setLinkedTransaction] = useState(null);
  const [activityPanelWidth, setActivityPanelWidth] = useState(0);

  // Main data states
  const [billGroups, setBillGroups] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [participantSuggestions, setParticipantSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Modal states for Persistent Bill Group
  const [createBillGroupModalOpen, setCreateBillGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState([{ name: '', vpa: '' }]);

  // Add Member Modal for existing Group
  const [addMemberModalOpen, setAddMemberModalOpen] = useState(false);
  const [selectedGroupForMember, setSelectedGroupForMember] = useState(null);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberVpa, setNewMemberVpa] = useState('');

  // Modal states for Split Group / Expense
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [formBillGroupId, setFormBillGroupId] = useState(null);
  const [formGroupName, setFormGroupName] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formTotal, setFormTotal] = useState('');
  const [formUserShare, setFormUserShare] = useState('');
  const [parentTx, setParentTx] = useState(null);
  const [formMembers, setFormMembers] = useState([]);

  // Transaction Picker modal
  const [pickerModalOpen, setPickerModalOpen] = useState(false);
  const [pickerType, setPickerType] = useState('debit'); // 'debit' or 'credit'
  const [pickerSearch, setPickerSearch] = useState('');
  const [candidateTxs, setCandidateTxs] = useState([]);
  const [loadingTxs, setLoadingTxs] = useState(false);
  const [selectedPickerTxs, setSelectedPickerTxs] = useState([]);
  const [linkingMemberContext, setLinkingMemberContext] = useState(null); // { groupId, member }

  // Google Pay Takeout Import states
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [takeoutStatus, setTakeoutStatus] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [importError, setImportError] = useState(null);

  const loadData = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    getTakeoutStatus().then(res => setTakeoutStatus(res.data)).catch(() => {});

    return Promise.all([
      getBillGroups().then(res => res.data || []).catch(() => []),
      getSplitSuggestions().then(res => res.data || []).catch(() => []),
      getSplitGroups().then(res => res.data || []).catch(() => []),
      getParticipantSuggestions().then(res => res.data || []).catch(() => [])
    ])
      .then(([bGrps, suggs, grps, pSuggs]) => {
        setBillGroups(bGrps);
        setSuggestions(suggs);
        setGroups(grps);
        setParticipantSuggestions(pSuggs);

        // If no persistent groups exist yet but suggestions or splits exist, pick tab smartly
        if (bGrps.length === 0) {
          if (grps.length > 0) setActiveTab('splits');
          else if (suggs.length > 0) setActiveTab('suggestions');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSyncLocalTakeout = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const res = await importTakeoutPath(takeoutStatus?.defaultPath || 'D:\\BankStatements\\Gpay\\takeout-20261003T045601Z-1-001.zip');
      setImportResult(res.data);
      loadData();
    } catch (err) {
      console.error('Failed to import Takeout data', err);
      setImportError(err.response?.data?.message || err.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const handleUploadTakeoutFile = async () => {
    if (!selectedFile) return;
    setImporting(true);
    setImportError(null);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      const res = await importTakeoutUpload(fd);
      setImportResult(res.data);
      loadData();
    } catch (err) {
      console.error('Failed to upload Takeout file', err);
      setImportError(err.response?.data?.message || err.message || 'Upload and import failed.');
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle transaction passed from Transactions table ("Split with Friends")
  useEffect(() => {
    if (location.state?.createForTx) {
      const tx = location.state.createForTx;
      setParentTx({
        accountId: tx.accountId,
        bankReference: tx.bankReference || tx.id,
        bankType: tx.bankType,
        transactionType: tx.transactionType || 'DR',
        amount: tx.debit || tx.amount,
        narration: tx.narration || tx.description,
        counterPartyName: tx.counterPartyName || tx.merchant
      });
      setFormTitle(`Split: ${tx.counterPartyName || tx.merchant || tx.narration || 'Bill'}`);
      setFormDate(tx.transactionDate ? tx.transactionDate.slice(0, 10) : (tx.date ? tx.date.slice(0, 10) : new Date().toISOString().slice(0, 10)));
      const total = tx.debit || tx.amount || 0;
      setFormTotal(total.toString());
      setFormUserShare((Math.round((total / 2) * 100) / 100).toString());
      setFormBillGroupId(null);
      setFormGroupName(null);
      setFormMembers([
        { participantName: 'Friend 1', participantVpa: '', assignedAmount: (Math.round((total / 2) * 100) / 100).toString(), isSettled: false, isUser: false }
      ]);
      setCreateModalOpen(true);
    }
  }, [location.state]);

  // Open the same expense details from Overview, Reports, or a bank transaction.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('splitId');
    if (!id || !/^[1-9]\d*$/.test(id)) return;
    let active = true;
    getSplitGroupById(id).then(res => {
      if (!active) return;
      setSplitLinkError(null);
      setActiveTab('splits');
      setSplitFilter('all');
      setSelectedBillGroupId(null);
      setLinkedTransaction(null);
      setSelectedSplitDetail(res.data);
    }).catch(() => {
      if (active) setSplitLinkError({ key: location.key, message: 'Could not open the linked expense. It may have been removed or is unavailable.' });
    });
    return () => { active = false; };
  }, [location.key, location.search, splitLinkAttempt]);

  // Summary stats
  const stats = useMemo(() => {
    const totalGroups = billGroups.length > 0 ? billGroups.length : groups.length;
    const totalBillVolume = groups.reduce((sum, g) => sum + (g.totalAmount || 0), 0);
    const totalVerified = groups.reduce((sum,g) => sum + (g.verifiedAmount || 0),0);
    const totalSettled = groups.reduce((sum, g) => sum + (g.settledAmount || 0), 0);
    const pendingToCollect = groups.filter(g => g.isCreatedByUser).reduce((sum, g) => sum + (g.pendingAmount || 0), 0);
    const pendingOwedByMe = groups.filter(g => !g.isCreatedByUser).reduce((sum, g) => sum + (g.pendingAmount || 0), 0);
    const totalPending = pendingToCollect + pendingOwedByMe;
    return { totalGroups, totalBillVolume, totalVerified, totalSettled, pendingToCollect, pendingOwedByMe, totalPending };
  }, [billGroups, groups]);

  const selectedBillGroup = useMemo(() => {
    return billGroups.find(g => g.id === selectedBillGroupId) || null;
  }, [billGroups, selectedBillGroupId]);

  const activeSplitDetail = useMemo(() => {
    if (!selectedSplitDetail) return null;
    return groups.find(g => g.id === selectedSplitDetail.id) || selectedSplitDetail;
  }, [selectedSplitDetail, groups]);

  const isImportedSplit = split => isImportedGPayExpense(split)
    || isImportedGPayGroup(billGroups.find(group => group.id === split?.billGroupId));

  const onlyLinkCreatedByMe = localStorage.getItem('bsp_gpay_only_link_created_by_me') !== 'false';
  const configuredUserName = localStorage.getItem('bsp_gpay_user_name') || 'ARUN G';

  const selfNameTokens = useMemo(() => {
    const raw = (configuredUserName || 'ARUN G').toLowerCase();
    const parts = raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    return ['you', 'self', ...parts];
  }, [configuredUserName]);

  const isSelfMember = (m) => {
    if (m?.isUser) return true;
    const name = (m?.participantName || m?.name || '').trim().toLowerCase();
    return selfNameTokens.includes(name);
  };

  const canLinkIncomingCredit = (group, member) => {
    if (member?.isUser || isSelfMember(member)) return false;
    if (onlyLinkCreatedByMe && !group?.isCreatedByUser) return false;
    return true;
  };

  const filteredGroups = useMemo(() => {
    if (splitFilter === 'created_by_me') {
      return groups.filter(g => g.isCreatedByUser);
    }
    if (splitFilter === 'to_collect') {
      return groups.filter(g => g.isCreatedByUser && (g.pendingAmount || 0) > 0);
    }
    if (splitFilter === 'owed_by_me') {
      return groups.filter(g => !g.isCreatedByUser && (g.pendingAmount || 0) > 0);
    }
    if (splitFilter === 'included') {
      return groups.filter(g => g.isUserInvolved);
    }
    return groups;
  }, [groups, splitFilter]);

  const splitCounts = useMemo(() => {
    const all = groups.length;
    const createdByMe = groups.filter(g => g.isCreatedByUser).length;
    const toCollect = groups.filter(g => g.isCreatedByUser && (g.pendingAmount || 0) > 0).length;
    const owedByMe = groups.filter(g => !g.isCreatedByUser && (g.pendingAmount || 0) > 0).length;
    const included = groups.filter(g => g.isUserInvolved).length;
    return { all, createdByMe, toCollect, owedByMe, included };
  }, [groups]);

  const openLinkedTransaction = (member, expense) => setLinkedTransaction({
    accountId: member.linkedAccountId,
    bankReference: member.linkedBankReference,
    bankType: member.linkedBankType,
    transactionType: member.linkedTransactionType,
    participantName: member.participantName,
    expenseTitle: expense.title,
  });

  // ── Open Create Persistent GPay Group Modal ──
  const openCreateBillGroupModal = () => {
    setNewGroupName('');
    setNewGroupDescription('');
    setNewGroupMembers([{ name: '', vpa: '' }]);
    setCreateBillGroupModalOpen(true);
  };

  const handleAddMemberRowToNewGroup = () => {
    setNewGroupMembers(prev => [...prev, { name: '', vpa: '' }]);
  };

  const handleRemoveMemberRowFromNewGroup = (idx) => {
    setNewGroupMembers(prev => prev.filter((_, i) => i !== idx));
  };

  const handleNewGroupMemberChange = (idx, field, val) => {
    setNewGroupMembers(prev => prev.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  };

  const handleAddSuggestedToNewGroup = (sugg) => {
    setNewGroupMembers(prev => {
      // If the first row is empty, fill it
      if (prev.length === 1 && !prev[0].name.trim()) {
        return [{ name: sugg.name, vpa: sugg.vpa || '' }];
      }
      // Check if already in list
      if (prev.some(m => m.name.toLowerCase() === sugg.name.toLowerCase())) return prev;
      return [...prev, { name: sugg.name, vpa: sugg.vpa || '' }];
    });
  };

  const handleSaveBillGroup = async () => {
    if (!newGroupName.trim()) {
      alert('Please enter a Group Name (e.g. Flatmates, Goa Trip, Office Lunch).');
      return;
    }
    const validMembers = newGroupMembers.filter(m => m.name.trim().length > 0);

    setBusy(true);
    try {
      await createBillGroup({
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || null,
        members: validMembers
      });
      setCreateBillGroupModalOpen(false);
      loadData();
      setActiveTab('billGroups');
    } catch (err) {
      console.error('Failed to create group', err);
      alert('Failed to create group.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBillGroup = async (groupId) => {
    if (!window.confirm('Delete this group? Splits inside will become standalone and not lost.')) return;
    setBusy(true);
    try {
      await deleteBillGroup(groupId);
      loadData();
    } catch (err) {
      console.error('Failed to delete group', err);
      alert('Failed to delete group.');
    } finally {
      setBusy(false);
    }
  };

  // ── Add Member to existing Group ──
  const openAddMemberModal = (bGroup) => {
    setSelectedGroupForMember(bGroup);
    setNewMemberName('');
    setNewMemberVpa('');
    setAddMemberModalOpen(true);
  };

  const handleSaveMemberToGroup = async () => {
    if (!newMemberName.trim()) {
      alert('Please enter a name for the member.');
      return;
    }
    setBusy(true);
    try {
      await addBillGroupMember(selectedGroupForMember.id, {
        name: newMemberName.trim(),
        vpa: newMemberVpa.trim() || null
      });
      setAddMemberModalOpen(false);
      loadData();
    } catch (err) {
      console.error('Failed to add member to group', err);
      alert('Failed to add member to group.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMemberFromGroup = async (groupId, memberId, memberName) => {
    if (!window.confirm(`Remove ${memberName} from this group?`)) return;
    setBusy(true);
    try {
      await removeBillGroupMember(groupId, memberId);
      loadData();
    } catch (err) {
      console.error('Failed to remove member', err);
    } finally {
      setBusy(false);
    }
  };

  // ── Open Split / Expense Modal ──
  // Case A: Standalone or from suggestion
  const openCreateModal = (suggestion = null) => {
    setFormBillGroupId(null);
    setFormGroupName(null);
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

  // Case B: Add Split inside a Persistent Bill Group
  const openCreateSplitForGroup = (bGroup) => {
    setFormBillGroupId(bGroup.id);
    setFormGroupName(bGroup.name);
    setFormTitle(`Expense in ${bGroup.name}`);
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormTotal('');
    setFormUserShare('');
    setParentTx(null);

    // Pre-populate with all persistent group members
    setFormMembers(
      (bGroup.members || []).map(m => ({
        participantName: m.name,
        participantVpa: m.vpa || '',
        assignedAmount: '',
        paidAmount: 0,
        isSettled: false,
        isUser: false
      }))
    );
    setCreateModalOpen(true);
  };

  // Participant suggestion click in Split Modal
  const handleAddSuggestedParticipant = (sugg) => {
    setFormMembers(prev => {
      if (prev.some(m => m.participantName.toLowerCase() === sugg.name.toLowerCase())) {
        return prev;
      }
      return [
        ...prev,
        {
          participantName: sugg.name,
          participantVpa: sugg.vpa || '',
          assignedAmount: '',
          paidAmount: 0,
          isSettled: false,
          isUser: false
        }
      ];
    });
  };

  // ── Transaction Picker ──
  const openTransactionPicker = (type, forMemberLink = null, defaultSearch = '') => {
    setPickerType(type);
    setLinkingMemberContext(forMemberLink);
    setPickerSearch(defaultSearch);
    setSelectedPickerTxs([]);
    setPickerModalOpen(true);
    fetchPickerTransactions(type, defaultSearch);
  };

  const fetchPickerTransactions = (type, search) => {
    setLoadingTxs(true);
    getCandidateTransactions(type, search)
      .then(res => setCandidateTxs(res.data || []))
      .catch(() => setCandidateTxs([]))
      .finally(() => setLoadingTxs(false));
  };

  const isTxSelected = (tx) => {
    return selectedPickerTxs.some(t =>
      t.accountId === tx.accountId &&
      t.bankReference === tx.bankReference &&
      t.bankType === tx.bankType
    );
  };

  const togglePickerTx = (tx) => {
    setSelectedPickerTxs(prev => {
      const exists = prev.some(t =>
        t.accountId === tx.accountId &&
        t.bankReference === tx.bankReference &&
        t.bankType === tx.bankType
      );
      if (exists) {
        return prev.filter(t => !(t.accountId === tx.accountId && t.bankReference === tx.bankReference && t.bankType === tx.bankType));
      } else {
        return [...prev, tx];
      }
    });
  };

  const handleSelectAllPickerTxs = () => {
    if (selectedPickerTxs.length === candidateTxs.length) {
      setSelectedPickerTxs([]);
    } else {
      setSelectedPickerTxs([...candidateTxs]);
    }
  };

  const handleAddMultipleRepayments = () => {
    if (selectedPickerTxs.length === 0) return;
    const newMembers = selectedPickerTxs.map(tx => {
      const friendName = tx.counterPartyName || tx.upiVpa?.split('@')[0] || 'Friend';
      const paidAmount = tx.credit || tx.amount;
      return {
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
      };
    });
    setFormMembers(prev => [...prev, ...newMembers]);
    setSelectedPickerTxs([]);
    setPickerModalOpen(false);
  };

  const handleSelectTransactionFromPicker = async (tx) => {
    if (linkingMemberContext) {
      if (busy) return;
      if (linkingMemberContext.member.isUser && !window.confirm('This participant was imported as you. Linking an incoming repayment will treat them as another person and remove their assigned amount from Your share. Continue?')) return;
      // Linking an existing member's share
      const linked = await handleLinkTxToMember(linkingMemberContext.groupId, linkingMemberContext.member.id, tx);
      if (!linked) return;
      setPickerModalOpen(false);
      setLinkingMemberContext(null);
      return;
    }

    if (pickerType === 'debit') {
      // Picked as Parent Bill transaction
      setParentTx(tx);
      setFormTitle(formGroupName ? `${tx.counterPartyName || tx.narration} (${formGroupName})` : `Split: ${tx.counterPartyName || tx.narration || 'Bill'}`);
      setFormDate(tx.date ? tx.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
      setFormTotal((tx.debit || tx.amount).toString());
      const total = tx.debit || tx.amount;
      const count = formMembers.length + 1;
      setFormUserShare((Math.round((total / count) * 100) / 100).toString());
      setPickerModalOpen(false);
    } else {
      // For credit transactions in multi-select mode: toggle selection
      togglePickerTx(tx);
    }
  };

  // Helper: In Group view, clicking "⚡ Link Repayment Tx" on an owed member
  const handleLinkRepaymentForGroupMember = (billGroup, memberBalance) => {
    // Find an unsettled split member share in this group for this friend
    const candidateSplit = (billGroup.splits || []).find(s =>
      (s.members || []).some(m => !m.isUser && !m.isSettled && m.participantName.trim().toLowerCase() === memberBalance.memberName.trim().toLowerCase())
    );

    if (candidateSplit) {
      const splitMember = candidateSplit.members.find(m => !m.isUser && !m.isSettled && m.participantName.trim().toLowerCase() === memberBalance.memberName.trim().toLowerCase());
      openTransactionPicker('credit', { groupId: candidateSplit.id, member: splitMember }, memberBalance.memberName);
    } else {
      // If all recorded splits are already settled or member was added without splits
      openTransactionPicker('credit', null, memberBalance.memberName);
    }
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
        billGroupId: formBillGroupId,
        groupName: formGroupName,
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
      if (formBillGroupId) setActiveTab('billGroups');
      else setActiveTab('splits');
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
        transactionType: tx.transactionType || (tx.debit > 0 ? 'DR' : 'CR'),
        amount: tx.credit || tx.debit || tx.amount
      });
      await loadData();
      return true;
    } catch (err) {
      console.error('Failed to link transaction', err);
      alert(err.response?.data?.message || 'Failed to link transaction.');
      return false;
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
    if (!window.confirm('Delete this split? This cannot be undone.')) return;
    setBusy(true);
    try {
      await deleteSplitGroup(id);
      loadData();
    } catch (err) {
      console.error('Failed to delete split', err);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSettled = async (groupId, member) => {
    setBusy(true);
    try {
      const nextSettled = !member.isSettled;
      const nextPaid = nextSettled ? (member.assignedAmount || 0) : 0;
      await updateSplitMember(groupId, member.id, {
        isSettled: nextSettled,
        paidAmount: nextPaid
      });
      setSelectedSplitDetail(prev => {
        if (!prev || prev.id !== groupId) return prev;
        const nextMembers = (prev.members || []).map(m => m.id === member.id ? { ...m, isSettled: nextSettled, paidAmount: nextPaid } : m);
        return { ...prev, members: nextMembers };
      });
      loadData();
    } catch (err) {
      console.error('Failed to update member status', err);
    } finally {
      setBusy(false);
    }
  };

  // ── Render Google Pay Style Group Chat View (Matching Image 1) ──
  const renderGPayGroupChatView = (group) => {
    if (!group) return null;
    const members = getGroupDisplayMembers(group);
    const splits = group.splits || [];
    // Sort splits chronologically (oldest to newest for chat feed)
    const sortedSplits = [...splits].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Get 4 member initials for the avatar collage
    const avatarSlots = [
      members[0]?.name ? getInitials(members[0].name) : 'G',
      members[1]?.name ? getInitials(members[1].name) : 'P',
      members[2]?.name ? getInitials(members[2].name) : 'A',
      members[3]?.name ? getInitials(members[3].name) : 'Y'
    ];
    const avatarColors = [
      getAvatarColor(members[0]?.name || '1'),
      getAvatarColor(members[1]?.name || '2'),
      getAvatarColor(members[2]?.name || '3'),
      getAvatarColor(members[3]?.name || '4')
    ];


    return (
      <div className="gpay-chat-wrapper">
        {/* Header */}
        <div className="gpay-header">
          <div className="gpay-header-left">
            <button
              className="gpay-back-btn"
              onClick={() => setSelectedBillGroupId(null)}
              title="Back to all groups" aria-label="Back to all groups"
            >
              <FiArrowLeft size={20} />
            </button>
            <div className="gpay-avatar-collage">
              {avatarSlots.map((init, i) => (
                <div key={i} className="gpay-avatar-cell" style={{ background: avatarColors[i] }}>
                  {init}
                </div>
              ))}
            </div>
            <div className="gpay-header-info">
              <h2 className="gpay-header-title">{group.name}</h2>
              <div className="gpay-header-subtitle">
                {members.length} {members.length === 1 ? 'member' : 'members'}
                {group.description ? ` • ${group.description}` : ''}
              </div>
            </div>
          </div>
          {!isImportedGPayGroup(group) && (
            <div className="gpay-custom-actions">
              <button className="btn btn--outline" onClick={() => openAddMemberModal(group)}><FiUserPlus size={14} /> Add Member</button>
              <button className="btn btn--outline" onClick={() => handleDeleteBillGroup(group.id)} title="Delete group" aria-label="Delete group"><FiTrash2 size={14} /></button>
            </div>
          )}
        </div>

        <div className="gpay-group-summary" aria-label="Group summary">
          <div><span>Total expenses</span><strong>{currencyFormatter.format(group.totalExpenseVolume || 0)}</strong></div>
          <div><span>Your share</span><strong>{currencyFormatter.format(group.userShareVolume || 0)}</strong></div>
          <div>
            <span>{group.netOwedToUser > 0 ? 'To collect' : (group.netOwedByUser > 0 ? 'You owe' : 'Balance')}</span>
            <strong className={group.netOwedToUser > 0 ? 'gpay-summary-pending' : (group.netOwedByUser > 0 ? 'gpay-summary-owed' : 'gpay-summary-settled')}>
              {currencyFormatter.format(group.netOwedToUser > 0 ? group.netOwedToUser : (group.netOwedByUser > 0 ? group.netOwedByUser : 0))}
            </strong>
          </div>
        </div>
        {/* Activity and expense details */}
        <div className="gpay-nav-tabs">
          <button
            className={`gpay-tab-btn ${groupViewSubTab === 'chat' ? 'active' : ''}`}
            onClick={() => setGroupViewSubTab('chat')}
          >
            Activity
          </button>
          <button
            className={`gpay-tab-btn ${groupViewSubTab === 'expenses' ? 'active' : ''}`}
            onClick={() => setGroupViewSubTab('expenses')}
          >
            Expenses ({splits.length})
          </button>
        </div>

        {/* TAB A: CHAT FEED (Matching Image 1) */}
        {groupViewSubTab === 'chat' && (
          <>
            <div className="gpay-chat-feed">
              {sortedSplits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                  <FiMessageSquare size={36} style={{ color: '#1a73e8', marginBottom: '12px' }} />
                  <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Welcome to {group.name}
                  </div>
                  <div style={{ fontSize: '13px', maxWidth: '380px', margin: '0 auto 16px' }}>
                    Your shared expenses and repayment updates will appear here. Add an expense from the Expenses tab to get started.
                  </div>
                </div>
              ) : (
                <>
                  {sortedSplits.map((split, sIdx) => {
                    const splitMembers = split.members || [];
                    const paidMembers = splitMembers.filter(m => m.isSettled || m.isUser);
                    const totalMembersCount = splitMembers.length > 0 ? splitMembers.length : 1;
                    const paidCount = paidMembers.length;
                    const isFullyPaid = split.status === 'Settled' || paidCount >= totalMembersCount;
                    const pct = Math.min(100, Math.round((paidCount / totalMembersCount) * 100));

                    // Show date divider if first split or date differs from previous
                    const showDateDivider = sIdx === 0 || fmtDate(split.date) !== fmtDate(sortedSplits[sIdx - 1]?.date);

                    return (
                      <div key={split.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {showDateDivider && (
                          <div className="gpay-date-divider">
                            <span className="gpay-date-pill">
                              {formatChatDate(split.date)}
                            </span>
                          </div>
                        )}

                        <div className="gpay-bubble-row">
                          {/* Sender Avatar */}
                          <div
                            className="gpay-sender-avatar"
                            style={{ background: getAvatarColor(split.creatorName || 'You') }}
                          >
                            {getInitials(split.creatorName || 'You')}
                          </div>

                          <div className="gpay-bubble-content">
                            <div className="gpay-sender-name">
                              {split.creatorName || 'You'}
                            </div>

                            {/* Split Card */}
                            <div
                              className="gpay-split-card" role="button" tabIndex={0} aria-label={`View expense: ${split.title}`} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedSplitDetail(split); } }}
                              onClick={() => setSelectedSplitDetail(split)}
                              title="Click to view details and link bank repayments"
                            >
                              <div className="gpay-split-subtitle">
                                {split.title}
                              </div>
                              <div className="gpay-split-amount">
                                {currencyFormatter.format(split.totalAmount)}
                              </div>

                              {/* Participant Avatars Row */}
                              <div className="gpay-avatar-row">
                                {splitMembers.slice(0, 6).map((m, mIdx) => (
                                  <div
                                    key={mIdx}
                                    className="gpay-avatar-pill"
                                    style={{ background: getAvatarColor(m.participantName) }}
                                    title={`${m.participantName}: ${currencyFormatter.format(m.assignedAmount)} (${m.isSettled ? 'Paid' : 'Unpaid'})`}
                                  >
                                    {getInitials(m.participantName)}
                                  </div>
                                ))}
                                {splitMembers.length > 6 && (
                                  <div
                                    className="gpay-avatar-pill"
                                    style={{ background: '#64748b' }}
                                  >
                                    +{splitMembers.length - 6}
                                  </div>
                                )}
                              </div>

                              {/* Progress bar */}
                              <div className="gpay-progress-section">
                                <div className="gpay-progress-track">
                                  <div
                                    className="gpay-progress-fill"
                                    style={{ width: `${pct}%`, background: isFullyPaid ? '#1e8e3e' : '#1a73e8' }}
                                  />
                                </div>
                                <span className="gpay-progress-label">
                                  {paidCount}/{totalMembersCount} paid
                                </span>
                              </div>

                              {/* Status footer with checkmark & time */}
                              <div className="gpay-status-footer">
                                <div className={`gpay-status-left ${isFullyPaid ? 'paid' : 'pending'}`}>
                                  {isFullyPaid ? (
                                    <>
                                      <FiCheckCircle size={15} />
                                      <span>Paid &bull; {new Date(split.date).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()}</span>
                                    </>
                                  ) : (
                                    <>
                                      <FiClock size={15} />
                                      <span>{split.pendingAmount > 0 ? `${currencyFormatter.format(split.pendingAmount)} pending` : 'In progress'} &bull; {new Date(split.date).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()}</span>
                                    </>
                                  )}
                                </div>
                                <FiChevronRight className="gpay-chevron" size={16} />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </>
        )}

        {/* TAB B: EXPENSES & BALANCES TAB */}
        {groupViewSubTab === 'expenses' && (
          <div style={{ padding: '20px', overflowY: 'auto' }}>
            {/* Group Metrics Strip */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px',
              background: 'var(--bg-subtle, #f9fafb)', padding: '14px', borderRadius: '10px', marginBottom: '20px'
            }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL GROUP SPEND</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {currencyFormatter.format(group.totalExpenseVolume)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Across {splits.length} splits</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>YOUR NET SHARE</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {currencyFormatter.format(group.userShareVolume)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Your personal consumption</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>COLLECTED REPAYMENTS</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--success, #10b981)' }}>
                  {currencyFormatter.format(group.settledVolume)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Received from friends</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>NET OWED TO YOU</div>
                <div style={{
                  fontSize: '18px', fontWeight: 800,
                  color: group.netOwedToUser > 0 ? '#d97706' : 'var(--success, #10b981)'
                }}>
                  {currencyFormatter.format(group.netOwedToUser)}
                </div>
                <div style={{ fontSize: '11px', color: group.netOwedToUser > 0 ? '#d97706' : 'var(--text-muted)' }}>
                  {group.netOwedToUser > 0 ? 'Pending collection' : 'Fully settled'}
                </div>
              </div>
            </div>

            {/* Member Balances & Owed Tracker */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FiUsers size={16} /> Member Balances &amp; Owed Status
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
                {group.balances.map((b, bIdx) => (
                  <div
                    key={bIdx}
                    style={{
                      border: '1px solid var(--border, #e5e7eb)',
                      borderRadius: '8px',
                      padding: '12px 14px',
                      background: b.owedAmount > 0 ? 'rgba(245,158,11,0.04)' : 'var(--card-bg, #fff)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{b.memberName}</div>
                      {b.memberVpa && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{b.memberVpa}</div>}
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Assigned: {currencyFormatter.format(b.totalAssigned)} &bull; Paid: {currencyFormatter.format(b.totalPaid)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      {b.owedAmount > 0 ? (
                        <>
                          <span style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626', fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px' }}>
                            Owes {currencyFormatter.format(b.owedAmount)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleLinkRepaymentForGroupMember(group, b)}
                            style={{
                              fontSize: '11px', padding: '4px 8px', borderRadius: '4px',
                              background: 'rgba(16,185,129,0.1)', color: '#059669',
                              border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontWeight: 600
                            }}
                          >
                            ⚡ Link Repayment Tx
                          </button>
                        </>
                      ) : (
                        <span style={{ background: 'rgba(16,185,129,0.1)', color: '#059669', fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px' }}>
                          ✓ Settled
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Full list of expenses */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FiFileText size={16} /> All Expenses in {group.name} ({splits.length})
                </div>
                {!isImportedGPayGroup(group) && (<button
                  className="btn btn--primary"
                  onClick={() => openCreateSplitForGroup(group)}
                  style={{ fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <FiPlus size={14} /> Add Expense
                </button>)}
              </div>

              {splits.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', background: 'var(--bg-subtle, #f9fafb)', borderRadius: '8px' }}>
                  {isImportedGPayGroup(group) ? 'No expenses found in this GPay import.' : 'No expenses yet. Use Add Expense to record one.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {splits.map(s => (
                    <div
                      key={s.id}
                      style={{
                        border: '1px solid var(--border, #e5e7eb)',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        background: 'var(--card-bg, #fff)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer'
                      }}
                      onClick={() => setSelectedSplitDetail(s)}
                    >
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 600 }}>{s.title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {fmtDate(s.date)} &bull; Total: <strong>{currencyFormatter.format(s.totalAmount)}</strong> &bull; Your Share: {currencyFormatter.format(s.userShareAmount)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{
                          fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
                          background: s.status === 'Settled' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                          color: s.status === 'Settled' ? '#059669' : '#d97706'
                        }}>
                          {s.status}
                        </span>
                        <FiChevronRight size={16} color="var(--text-muted)" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="splits-workspace" style={{ marginRight: activityPanelWidth }}>
    <div className="splits-page">

      {/* Header & Top Actions */}
      <div className="splits-page-header">
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiUsers style={{ color: 'var(--primary, #3b82f6)' }} />
            Bill Splits & GPay Groups
          </h1>
          <p style={{ color: 'var(--text-muted, #666)', fontSize: '14px', margin: '4px 0 0' }}>
            Track shared expenses, collect repayments, and see what you owe.
          </p>
        </div>
        <div className="splits-page-actions">

          <button
            className="btn btn--outline"
            onClick={() => openCreateModal()}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: '8px', fontSize: '13px' }}
          >
            <FiPlus size={15} /> New Split
          </button>
          <button
            className="btn btn--primary"
            onClick={openCreateBillGroupModal}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600 }}
          >
            <FiUserPlus size={16} /> New Custom Group
          </button>
        </div>
      </div>

      {/* KPI Stat Cards */}
      {splitLinkError?.key === location.key && <div role="alert" className="shared-bills-summary"><p>{splitLinkError.message}</p><button className="btn btn--outline" onClick={() => setSplitLinkAttempt(value => value + 1)}>Retry opening expense</button></div>}
      <div className="splits-summary">
        <StatCard
          label="Total Bill Volume"
          value={currencyFormatter.format(stats.totalBillVolume)}
          sub="Combined expenses recorded"
          onClick={() => { setActiveTab('splits'); setSplitFilter('all'); }}
          active={activeTab === 'splits' && splitFilter === 'all'}
          title="Click to view all split expenses"
        />
        <StatCard
          label="Settled Repayments"
          value={currencyFormatter.format(stats.totalSettled)}
          sub={`Bank verified ${currencyFormatter.format(stats.totalVerified)}`}
          accent="var(--success, #10b981)"
          onClick={() => { setActiveTab('splits'); }}
          title="Click to view split repayments"
        />
        <StatCard
          label="To Collect"
          value={currencyFormatter.format(stats.pendingToCollect)}
          sub="Owed to you by friends"
          accent="#d97706"
          onClick={() => { setActiveTab('splits'); setSplitFilter('to_collect'); }}
          active={activeTab === 'splits' && splitFilter === 'to_collect'}
          title="Click to view splits created by you where friends owe you"
        />
        <StatCard
          label="Owed by Me"
          value={currencyFormatter.format(stats.pendingOwedByMe)}
          sub="Your share owed to friends"
          accent="var(--danger, #ef4444)"
          onClick={() => { setActiveTab('splits'); setSplitFilter('owed_by_me'); }}
          active={activeTab === 'splits' && splitFilter === 'owed_by_me'}
          title="Click to view splits where you owe your share to friends"
        />
      </div>

      <nav className="splits-navigation" aria-label="Bill splits views">
        {[['billGroups', 'Groups', billGroups.length], ['splits', 'Confirmed Splits', groups.length], ['suggestions', 'Suggestions', suggestions.length], ['evidence', 'GPay Activity', '']].map(([key, label, count]) => (
          <button key={key} type="button" aria-current={activeTab === key ? 'page' : undefined} className={activeTab === key ? 'is-active' : ''} onClick={() => setActiveTab(key)}>
            {label}{count !== '' && <span>{count}</span>}
          </button>
        ))}
      </nav>

      {activeTab === 'evidence' && <GPayTakeoutReview onRefresh={() => loadData(true)} onTransaction={setLinkedTransaction} onPanelWidthChange={setActivityPanelWidth} />}
      {/* ── TAB 1: PERSISTENT GPAY GROUPS ── */}
      {activeTab === 'billGroups' && (
        <div>
          {selectedBillGroup ? (
            renderGPayGroupChatView(selectedBillGroup)
          ) : billGroups.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--card-bg, #fff)', borderRadius: '12px', border: '1px solid var(--border, #e5e7eb)' }}>
              <FiUsers size={40} style={{ color: 'var(--primary, #3b82f6)', marginBottom: '12px' }} />
              <h3 style={{ margin: '0 0 8px', fontSize: '18px' }}>No GPay Groups Created Yet</h3>
              <p style={{ color: 'var(--text-muted, #6b7280)', maxWidth: '500px', margin: '0 auto 20px', fontSize: '14px', lineHeight: 1.5 }}>
                Create a persistent group like <strong>Flatmates</strong>, <strong>Goa Trip</strong>, or <strong>Office Lunch</strong> to add multiple splits over time, track member balances, and easily link repayment transactions!
              </p>
              <button className="btn btn--primary" onClick={openCreateBillGroupModal} style={{ padding: '10px 20px' }}>
                <FiUserPlus size={16} style={{ marginRight: '6px' }} /> Create Your First Group
              </button>
            </div>
          ) : (
            <GPayGroupList
              groups={billGroups}
              onOpen={group => { setSelectedBillGroupId(group.id); setGroupViewSubTab('chat'); }}
              onExpense={setSelectedSplitDetail}
              onAddSplit={openCreateSplitForGroup}
              onAddMember={openAddMemberModal}
              onDelete={handleDeleteBillGroup}
            />
          )}
        </div>
      )}
      {/* ── TAB 2: ALL CONFIRMED SPLITS ── */}
      {activeTab === 'splits' && (
        <div>
          <div className="splits-filter-bar">
            <div className="splits-filters" role="group" aria-label="Filter confirmed splits">
              {[['all', 'All Splits', splitCounts.all], ['owed_by_me', 'Owed by Me', splitCounts.owedByMe], ['to_collect', 'To Collect', splitCounts.toCollect], ['created_by_me', 'Created by Me', splitCounts.createdByMe], ['included', 'Involving Me', splitCounts.included]].map(([key, label, count]) => (
                <button key={key} type="button" aria-pressed={splitFilter === key} onClick={() => { setSplitFilter(key); localStorage.setItem('bsp_gpay_split_filter', key); }}>
                  {label}<span>{count}</span>
                </button>
              ))}
            </div>
            <span className="splits-results" aria-live="polite">Showing {filteredGroups.length} of {groups.length} splits</span>
          </div>

          {filteredGroups.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--card-bg, #fff)', borderRadius: '12px', border: '1px solid var(--border, #e5e7eb)' }}>
              <FiScissors size={36} style={{ color: 'var(--primary, #3b82f6)', marginBottom: '12px' }} />
              <h3 style={{ margin: '0 0 8px', fontSize: '18px' }}>No Splits Found</h3>
              <p style={{ color: 'var(--text-muted, #6b7280)', maxWidth: '460px', margin: '0 auto 20px', fontSize: '14px' }}>
                {splitFilter === 'created_by_me'
                  ? 'No splits created by you were found in this view.'
                  : splitFilter === 'included'
                  ? 'No splits involving you were found.'
                  : 'Create a split group to divide a dinner, trip, or rent bill with friends and track repayments.'}
              </p>
              <button className="btn btn--primary" onClick={() => openCreateModal()}>
                + Create Your First Split Group
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {filteredGroups.map(group => {
                const selfMember = (group.members || []).find(m => isSelfMember(m));
                const isSettledOrClosed = group.status === 'Settled' || group.status === 'Closed';
                const pctSettled = group.sourceState ? (group.totalAmount > 0 ? Math.min(100, Math.round((group.members || []).reduce((sum,m) => sum + Math.min(m.assignedAmount,m.paidAmount),0) / group.totalAmount * 100)) : 0) : isSettledOrClosed
                  ? 100
                  : (group.totalAmount > 0
                    ? Math.min(100, Math.round(((group.settledAmount + group.userShareAmount) / group.totalAmount) * 100))
                    : 0);

                return (
                  <div
                    key={group.id}
                    className="confirmed-split-card"
                    style={{
                      background: 'var(--card-bg, #fff)',
                      borderRadius: '12px',
                      border: '1px solid var(--border, #e5e7eb)',
                      padding: '20px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                    }}
                  >
                    <div className="confirmed-split-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                          <span style={{
                            background: isSettledOrClosed ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                            color: isSettledOrClosed ? '#059669' : '#d97706',
                            fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px'
                          }}>
                            {group.status}
                          </span>
                          {group.isCreatedByUser ? (
                            <span style={{ background: 'rgba(59,130,246,0.12)', color: '#1d4ed8', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px' }}>
                              Created by You
                            </span>
                          ) : (
                            <span style={{ background: 'rgba(107,114,128,0.12)', color: '#4b5563', fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px' }}>
                              Created by {group.creatorName || 'Friend'}
                            </span>
                          )}
                          {group.groupName && (
                            <span style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--primary, #3b82f6)', fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px' }}>
                              Group: {group.groupName}
                            </span>
                          )}
                          <span style={{ fontSize: '13px', color: 'var(--text-muted, #6b7280)' }}>
                            {fmtDate(group.date)}
                          </span>
                        </div>
                        <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 700 }}>{group.title}</h3>
                        <dl className="confirmed-split-metrics">
                          <div><dt>Total bill</dt><dd>{currencyFormatter.format(group.totalAmount)}</dd></div>
                          <div><dt>Your share</dt><dd>{currencyFormatter.format(group.userShareAmount)}</dd></div>
                          <div><dt>Recorded repayments</dt><dd>{currencyFormatter.format(group.settledAmount)}</dd></div>
                          <div className={group.isCreatedByUser ? 'split-money-collect' : 'split-money-owe'}><dt>{group.status === 'Closed' ? 'Historical outstanding' : group.isCreatedByUser ? 'To collect' : 'You owe'}</dt><dd>{currencyFormatter.format(group.pendingAmount)}</dd></div>
                        </dl>
                        {group.sourceState && <p className="split-source-note">GPay status: {group.sourceState.toLowerCase()}</p>}
                      </div>

                      {!isImportedSplit(group) && (<button
                        className="btn btn--outline"
                        onClick={() => handleDeleteGroup(group.id)}
                        style={{ padding: '6px 10px', color: 'var(--danger, #ef4444)', borderColor: 'var(--border, #e5e7eb)', borderRadius: '6px' }}
                        title="Delete split"
                      >
                        <FiTrash2 size={14} />
                      </button>)}
                    </div>

                    {/* Progress Bar */}
                    <div className="confirmed-split-progress">
                      <div className="confirmed-split-progress-label">
                        <span>Settlement progress · {group.status === 'Closed' ? 'Historical outstanding' : group.isCreatedByUser ? 'To collect' : 'You owe'}: <strong>{currencyFormatter.format(group.pendingAmount)}</strong></span>
                        <span style={{ fontWeight: 600 }}>{pctSettled}%</span>
                      </div>
                      <div role="progressbar" aria-label="Settlement progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctSettled} style={{ height: '8px', background: 'var(--border, #e5e7eb)', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${pctSettled}%`,
                          background: pctSettled === 100 ? 'var(--success, #10b981)' : 'var(--primary, #3b82f6)',
                          transition: 'width 0.3s'
                        }} />
                      </div>
                    </div>

                    {/* Participants table */}
                    <div className="splits-participant-table" tabIndex={0} aria-label="Participants, scroll to see more" style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px', overflow: 'auto' }}>
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
                            <td style={{ padding: '10px 12px' }}>{currencyFormatter.format(selfMember?.paidAmount ?? (group.isCreatedByUser ? group.userShareAmount : 0))}</td>
                            <td style={{ padding: '10px 12px' }}>{currencyFormatter.format(group.userShareAmount)}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                background: isSettledOrClosed || group.isCreatedByUser || group.pendingAmount <= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                color: isSettledOrClosed || group.isCreatedByUser || group.pendingAmount <= 0 ? '#059669' : '#dc2626',
                                fontSize: '11px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600
                              }}>
                                {group.sourceState === 'CLOSED' ? 'Closed · source state retained' : isSettledOrClosed ? 'Settled' : (group.isCreatedByUser ? 'Paid (Self)' : (group.pendingAmount <= 0 ? 'Settled (Paid)' : 'Pending (Owe)'))}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>
                              {group.isCreatedByUser || group.sourceState === 'CLOSED' ? '—' : (
                                (() => {
                                  const userMem = (group.members || []).find(m => isSelfMember(m));
                                  if (userMem?.linkedBankReference) {
                                    return (
                                      <button className="gpay-transaction-link" onClick={() => openLinkedTransaction(userMem, group)}>
                                        <FiLink size={12} /> {userMem.linkedBankReference}<FiChevronRight size={12} />
                                      </button>
                                    );
                                  }
                                  return (
                                    <button
                                      className="splits-repayment-action"
                                      onClick={() => openTransactionPicker('debit', userMem ? { groupId: group.id, member: userMem } : null, group.creatorName || '')}
                                      style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border, #e5e7eb)', background: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                    >
                                      <FiLink size={12} /> Link repayment debit
                                    </button>
                                  );
                                })()
                              )}
                            </td>
                          </tr>

                          {/* Member rows (excluding self to avoid duplicate) */}
                          {(group.members || [])
                            .filter(m => !isSelfMember(m))
                            .map(m => (
                            <tr key={m.id} style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                              <td style={{ padding: '10px 12px' }}>
                                <div style={{ fontWeight: 600 }}>{m.participantName}</div>
                                {m.participantVpa && <div style={{ fontSize: '11px', color: 'var(--text-muted, #9ca3af)' }}>{m.participantVpa}</div>}
                                {m.linkedBankReference && (
                                  <button className="gpay-transaction-link" onClick={() => openLinkedTransaction(m, group)}>
                                    <FiLink size={12} /> {m.linkedBankReference}<FiChevronRight size={12} />
                                  </button>
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
                                  {m.sourceState === 'MARK_AS_PAID' ? 'Marked paid' : m.sourceState === 'FAILED' ? 'Failed' : m.isSettled ? 'Settled' : m.paidAmount > 0 ? 'Partially paid' : 'Pending'}
                                </span>
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                  {!isImportedSplit(group) && (
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
                                  )}
                                  {m.linkedBankReference ? (
                                    <button
                                      onClick={() => handleUnlinkTx(group.id, m.id)}
                                      style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border, #e5e7eb)', background: 'none', cursor: 'pointer' }}
                                      title="Unlink transaction"
                                    >
                                      Unlink Tx
                                    </button>
                                  ) : canLinkIncomingCredit(group, m) ? (
                                    <button
                                      onClick={() => openTransactionPicker('credit', { groupId: group.id, member: m }, m.participantName)}
                                      style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border, #e5e7eb)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    >
                                      <FiLink size={12} /> Link incoming credit
                                    </button>
                                  ) : (
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                      {!group.isCreatedByUser ? `Paid to ${group.creatorName || 'creator'}` : '—'}
                                    </span>
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

      {/* ── TAB 3: AUTO-DETECTED SUGGESTIONS ── */}
      {activeTab === 'suggestions' && (
        <div>
          {suggestions.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--card-bg, #fff)', borderRadius: '12px', border: '1px solid var(--border, #e5e7eb)' }}>
              <FiCheckCircle size={36} style={{ color: 'var(--success, #10b981)', marginBottom: '12px' }} />
              <h3 style={{ margin: '0 0 8px', fontSize: '18px' }}>No Pending Auto-Detected Splits</h3>
              <p style={{ color: 'var(--text-muted, #6b7280)', maxWidth: '460px', margin: '0 auto 20px', fontSize: '14px' }}>
                All UPI transaction patterns look normal or have already been grouped into confirmed splits.
              </p>
              <button className="btn btn--primary" onClick={() => openCreateModal()}>
                + Create Manual Split Group
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{
                          background: sugg.confidence === 'High' ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)',
                          color: sugg.confidence === 'High' ? '#059669' : '#2563eb',
                          fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px'
                        }}>
                          {sugg.confidence} Confidence &bull; Score {sugg.score}/100
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
                      <FiCheck size={14} /> Review &amp; Confirm Split
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

      {/* ── CREATE PERSISTENT GPAY GROUP MODAL ── */}
      <Modal
        open={createBillGroupModalOpen}
        onClose={() => setCreateBillGroupModalOpen(false)}
        title="Create GPay Group"
        subtitle="Create a persistent group to track multiple splits, member dues, and who owes you"
        width={560}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '10px 0' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
              Group Name *
            </label>
            <input
              type="text"
              className="field-input"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border, #d1d5db)' }}
              placeholder="e.g. Flatmates, Goa Trip 2026, Office Lunch, Badminton Gang"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
              Description / Notes (Optional)
            </label>
            <input
              type="text"
              className="field-input"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border, #d1d5db)' }}
              placeholder="e.g. Shared expenses for Flat 402"
              value={newGroupDescription}
              onChange={e => setNewGroupDescription(e.target.value)}
            />
          </div>

          {/* Suggested Contacts */}
          {participantSuggestions.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '6px' }}>
                QUICK ADD FREQUENT CONTACTS:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {participantSuggestions.slice(0, 8).map((sugg, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleAddSuggestedToNewGroup(sugg)}
                    style={{
                      fontSize: '11px', padding: '3px 8px', borderRadius: '14px',
                      border: '1px solid var(--border, #d1d5db)', background: 'var(--bg-subtle, #f9fafb)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                    }}
                  >
                    <FiPlus size={10} /> {sugg.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Members List */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700 }}>Group Members</label>
              <button
                type="button"
                onClick={handleAddMemberRowToNewGroup}
                style={{ fontSize: '12px', color: 'var(--primary, #3b82f6)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
              >
                + Add Member
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {newGroupMembers.map((m, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 30px', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Friend's Name (e.g. Rahul)"
                    style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border, #d1d5db)', fontSize: '13px' }}
                    value={m.name}
                    onChange={e => handleNewGroupMemberChange(idx, 'name', e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="UPI VPA (rahul@okaxis)"
                    style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border, #d1d5db)', fontSize: '13px' }}
                    value={m.vpa}
                    onChange={e => handleNewGroupMemberChange(idx, 'vpa', e.target.value)}
                  />
                  {newGroupMembers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveMemberRowFromNewGroup(idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger, #ef4444)', cursor: 'pointer' }}
                    >
                      <FiTrash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px', borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: '12px' }}>
            <button className="btn btn--outline" onClick={() => setCreateBillGroupModalOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={handleSaveBillGroup} disabled={busy}>
              {busy ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── ADD MEMBER TO EXISTING GROUP MODAL ── */}
      <Modal
        open={addMemberModalOpen}
        onClose={() => setAddMemberModalOpen(false)}
        title={`Add Member to ${selectedGroupForMember?.name || 'Group'}`}
        subtitle="Add a new friend to this persistent split group"
        width={480}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '10px 0' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
              Friend&apos;s Name *
            </label>
            <input
              type="text"
              className="field-input"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border, #d1d5db)' }}
              placeholder="e.g. Sujith M"
              value={newMemberName}
              onChange={e => setNewMemberName(e.target.value)}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
              UPI VPA (Optional)
            </label>
            <input
              type="text"
              className="field-input"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border, #d1d5db)' }}
              placeholder="e.g. name@okhdfcbank"
              value={newMemberVpa}
              onChange={e => setNewMemberVpa(e.target.value)}
            />
          </div>

          {/* Quick suggestions */}
          {participantSuggestions.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '6px' }}>
                SELECT FROM FREQUENT CONTACTS:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {participantSuggestions.slice(0, 6).map((sugg, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setNewMemberName(sugg.name); setNewMemberVpa(sugg.vpa || ''); }}
                    style={{
                      fontSize: '11px', padding: '3px 8px', borderRadius: '14px',
                      border: '1px solid var(--border, #d1d5db)', background: 'var(--bg-subtle, #f9fafb)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                    }}
                  >
                    <FiPlus size={10} /> {sugg.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px', borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: '12px' }}>
            <button className="btn btn--outline" onClick={() => setAddMemberModalOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={handleSaveMemberToGroup} disabled={busy}>
              {busy ? 'Adding...' : 'Add Member'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── CREATE / EDIT SPLIT GROUP MODAL (WITH PARTICIPANT SUGGESTIONS) ── */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={formGroupName ? `Add Expense to ${formGroupName}` : 'Create Bill Split'}
        subtitle="Select the bill expense, add participants who already paid from transactions, and assign split shares"
        width={680}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '12px 0' }}>

          {/* Group Header Badge if part of a group */}
          {formGroupName && (
            <div style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '13px',
              color: 'var(--primary, #3b82f6)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600
            }}>
              <FiUsers size={15} /> Splitting expense under group: <strong>{formGroupName}</strong>
            </div>
          )}

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

          {/* Step 3: Participants (with Auto-Suggestions and Multi-Select) */}
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

            {/* Smart Participant Suggestion Chips */}
            {participantSuggestions.length > 0 && (
              <div style={{ marginBottom: '12px', background: 'var(--bg-subtle, #f9fafb)', padding: '8px 10px', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 700 }}>
                  SUGGESTED FRIENDS (Recent UPI Contacts):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {participantSuggestions.slice(0, 8).map((sugg, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleAddSuggestedParticipant(sugg)}
                      style={{
                        fontSize: '11px', padding: '3px 8px', borderRadius: '14px',
                        border: '1px solid var(--border, #d1d5db)', background: 'var(--card-bg, #fff)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                      }}
                      title={sugg.vpa ? `Add ${sugg.name} (${sugg.vpa})` : `Add ${sugg.name}`}
                    >
                      <FiPlus size={10} /> {sugg.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {formMembers.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', background: 'var(--bg-subtle, #f9fafb)', borderRadius: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                No participants added yet. Click &quot;Select from Paid Transaction&quot; if someone already sent money, pick a suggested friend, or &quot;+ Add Friend (Pending)&quot;.
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
              {busy ? 'Saving...' : 'Save Split'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── TRANSACTION PICKER MODAL (With Multi-Select Option) ── */}
      <Modal
        open={pickerModalOpen}
        onClose={() => { setPickerModalOpen(false); setLinkingMemberContext(null); setSelectedPickerTxs([]); }}
        title={pickerType === 'debit' ? 'Select Expense / Bill Transaction' : (linkingMemberContext ? `Select Repayment from ${linkingMemberContext.member?.participantName || 'Friend'}` : 'Select Incoming Repayment Transactions')}
        subtitle={
          pickerType === 'debit'
            ? 'Choose the primary debit transaction for this split bill'
            : (linkingMemberContext
                ? 'Choose the transaction where this friend paid their share'
                : 'Select one or more UPI credit transactions from friends who already sent money')
        }
        width={620}
      >
        <div style={{ padding: '12px 0' }}>
          {/* Search bar & Bulk actions */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'center' }}>
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
            {pickerType === 'credit' && !linkingMemberContext && candidateTxs.length > 0 && (
              <button
                type="button"
                className="btn btn--outline"
                onClick={handleSelectAllPickerTxs}
                style={{ fontSize: '12px', padding: '7px 12px', whiteSpace: 'nowrap' }}
              >
                {selectedPickerTxs.length === candidateTxs.length ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {loadingTxs ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading transactions...</div>
          ) : candidateTxs.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>No matching transactions found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '360px', overflowY: 'auto' }}>
              {candidateTxs.map((tx, idx) => {
                const isSelected = isTxSelected(tx);
                const isMulti = pickerType === 'credit' && !linkingMemberContext;
                return (
                  <div
                    key={idx}
                    onClick={() => handleSelectTransactionFromPicker(tx)}
                    style={{
                      padding: '10px 14px',
                      border: isSelected ? '1.5px solid var(--primary, #3b82f6)' : '1px solid var(--border, #e5e7eb)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: isSelected ? 'rgba(59, 130, 246, 0.06)' : 'var(--card-bg, #fff)',
                      transition: 'border-color 0.15s, background 0.15s',
                      gap: '12px'
                    }}
                    onMouseEnter={e => {
                      if (!isSelected) e.currentTarget.style.borderColor = 'var(--primary, #3b82f6)';
                    }}
                    onMouseLeave={e => {
                      if (!isSelected) e.currentTarget.style.borderColor = 'var(--border, #e5e7eb)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                      {isMulti && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            togglePickerTx(tx);
                          }}
                          style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary, #3b82f6)' }}
                        />
                      )}
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {tx.counterPartyName || tx.narration}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted, #9ca3af)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {fmtDate(tx.date)} &bull; {tx.upiVpa || tx.mode} &bull; {tx.bankReference}
                        </div>
                      </div>
                    </div>
                    <div style={{
                      fontWeight: 700,
                      color: tx.direction === 'Credit' ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                      fontSize: '14px',
                      whiteSpace: 'nowrap',
                      marginLeft: '12px'
                    }}>
                      {tx.direction === 'Credit' ? '+' : '-'}{currencyFormatter.format(tx.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Modal Footer / Action bar */}
          {pickerType === 'credit' && !linkingMemberContext ? (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '16px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border, #e5e7eb)'
            }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {selectedPickerTxs.length > 0 ? (
                  <span>
                    <strong style={{ color: 'var(--text-primary)' }}>{selectedPickerTxs.length}</strong> selected &bull; Total: <strong style={{ color: 'var(--success, #10b981)' }}>{currencyFormatter.format(selectedPickerTxs.reduce((sum, t) => sum + (t.credit || t.amount || 0), 0))}</strong>
                  </span>
                ) : (
                  <span>Select one or more transactions to add as settled participants</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => { setPickerModalOpen(false); setSelectedPickerTxs([]); }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleAddMultipleRepayments}
                  disabled={selectedPickerTxs.length === 0}
                >
                  Add {selectedPickerTxs.length > 0 ? `${selectedPickerTxs.length} ` : ''}Selected {selectedPickerTxs.length === 1 ? 'Participant' : 'Participants'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border, #e5e7eb)' }}>
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => { setPickerModalOpen(false); setLinkingMemberContext(null); }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* ── GOOGLE PAY TAKEOUT IMPORT MODAL ── */}
      <Modal
        isOpen={importModalOpen}
        onClose={() => { if (!importing) { setImportModalOpen(false); setImportResult(null); } }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiUploadCloud style={{ color: '#3b82f6' }} />
            <span>Import Google Pay Takeout</span>
          </div>
        }
        size="lg"
      >
        <div style={{ padding: '4px' }}>
          {importResult ? (
            <div>
              <div style={{
                background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)',
                padding: '16px', borderRadius: '10px', marginBottom: '20px', display: 'flex', alignItems: 'flex-start', gap: '12px'
              }}>
                <FiCheckCircle size={22} style={{ color: 'var(--success, #10b981)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--success, #10b981)', marginBottom: '4px' }}>
                    Google Pay Takeout Import Complete!
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {importResult.message}
                  </div>
                </div>
              </div>

              {/* Summary KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                <div style={{ background: 'var(--bg-subtle, #f9fafb)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border, #e5e7eb)', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>GROUPS SYNCED</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--primary, #3b82f6)' }}>{importResult.groupsImported}</div>
                </div>
                <div style={{ background: 'var(--bg-subtle, #f9fafb)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border, #e5e7eb)', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>EXPENSES</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>{importResult.splitsImported}</div>
                </div>
                <div style={{ background: 'var(--bg-subtle, #f9fafb)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border, #e5e7eb)', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>PAYMENTS SYNCED</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>{importResult.membersImported}</div>
                </div>
                <div style={{ background: 'var(--bg-subtle, #f9fafb)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border, #e5e7eb)', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>BANK MATCHES</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--success, #10b981)' }}>{importResult.transactionsMatched}</div>
                </div>
                {importResult.cashbackRewardsCount > 0 && (
                  <div style={{ background: 'var(--bg-subtle, #f9fafb)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border, #e5e7eb)', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>CASHBACK REWARDS</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#f59e0b' }}>
                      {currencyFormatter.format(importResult.cashbackTotalEarned)}
                    </div>
                  </div>
                )}
              </div>

              {/* Group preview table */}
              {importResult.groups && importResult.groups.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
                    Top Imported Groups ({importResult.groups.length})
                  </div>
                  <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-subtle, #f9fafb)', textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                          <th style={{ padding: '8px 12px' }}>Group Name</th>
                          <th style={{ padding: '8px 12px' }}>Expenses</th>
                          <th style={{ padding: '8px 12px' }}>Members</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right' }}>Total Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.groups.map((g, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{g.groupName}</td>
                            <td style={{ padding: '8px 12px' }}>{g.expenseCount} splits</td>
                            <td style={{ padding: '8px 12px' }}>{g.memberCount} friends</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>
                              {currencyFormatter.format(g.totalAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    setImportModalOpen(false);
                    setImportResult(null);
                    setActiveTab('billGroups');
                  }}
                  style={{ padding: '9px 20px', fontWeight: 600 }}
                >
                  Done &amp; View Groups
                </button>
              </div>
            </div>
          ) : (
            <div>
              {/* Informational intro */}
              <div style={{
                background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.15)',
                padding: '14px 16px', borderRadius: '10px', marginBottom: '20px', fontSize: '13px', lineHeight: 1.5
              }}>
                <div style={{ fontWeight: 700, color: 'var(--primary, #3b82f6)', marginBottom: '4px' }}>
                  Ground-Truth Google Pay Export Sync
                </div>
                <div>
                  Google Pay Takeout exports contain your exact <strong>persistent groups</strong> (Room Rent, Trips, Flatmates),
                  individual bill splits, member shares, payment statuses (<strong>PAID_RECEIVED</strong>, <strong>UNPAID</strong>),
                  and settlement notes. We automatically correlate each expense and repayment with your imported bank statements.
                </div>
              </div>

              {/* Error box if any */}
              {importError && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: 'var(--danger, #ef4444)', padding: '12px 14px', borderRadius: '8px', marginBottom: '16px',
                  fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px'
                }}>
                  <FiAlertCircle size={16} />
                  <span>{importError}</span>
                </div>
              )}

              {/* Option A: Server Local File Detected */}
              {takeoutStatus?.localFileDetected && (
                <div style={{
                  border: '1.5px solid #10b981', background: 'rgba(16, 185, 129, 0.05)',
                  padding: '16px', borderRadius: '10px', marginBottom: '20px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ background: '#10b981', color: '#fff', fontSize: '10px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>
                        LOCAL ARCHIVE READY
                      </span>
                      <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Detected on Your System</strong>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      ~{Math.round((takeoutStatus.fileSizeBytes || 0) / 1024)} KB
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-muted)', marginBottom: '12px', wordBreak: 'break-all' }}>
                    {takeoutStatus.defaultPath}
                  </div>

                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleSyncLocalTakeout}
                    disabled={importing}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 18px',
                      background: '#10b981', borderColor: '#10b981', fontWeight: 600, fontSize: '13px'
                    }}
                  >
                    {importing ? (
                      <>
                        <FiRefreshCw className="spin" size={15} />
                        <span>Processing GPay Groups &amp; Transactions...</span>
                      </>
                    ) : (
                      <>
                        <FiUploadCloud size={16} />
                        <span>⚡ 1-Click Sync from Local File</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Option B: Manual Upload */}
              <div style={{
                border: '1px dashed var(--border, #d1d5db)', background: 'var(--bg-subtle, #f9fafb)',
                padding: '20px', borderRadius: '10px', textAlign: 'center', marginBottom: '20px'
              }}>
                <FiDownload size={28} style={{ color: 'var(--text-muted, #9ca3af)', marginBottom: '8px' }} />
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px', color: 'var(--text-primary)' }}>
                  Upload Google Pay Takeout Archive or JSON
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                  Supports <code>takeout-*.zip</code> or <code>Group expenses.json</code>
                </div>

                <input
                  type="file"
                  id="takeoutFileInput"
                  accept=".zip,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', alignItems: 'center' }}>
                  <label
                    htmlFor="takeoutFileInput"
                    className="btn btn--outline"
                    style={{ cursor: 'pointer', padding: '7px 14px', fontSize: '13px' }}
                  >
                    Browse File...
                  </label>

                  {selectedFile && (
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {selectedFile.name} (~{Math.round(selectedFile.size / 1024)} KB)
                    </div>
                  )}

                  {selectedFile && (
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={handleUploadTakeoutFile}
                      disabled={importing}
                      style={{ padding: '7px 16px', fontSize: '13px', fontWeight: 600 }}
                    >
                      {importing ? 'Importing...' : 'Upload & Sync'}
                    </button>
                  )}
                </div>
              </div>

              {/* Close Button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => setImportModalOpen(false)}
                  disabled={importing}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ── SPLIT EXPENSE DETAIL RHS DRAWER ── */}
      <Drawer
        open={!!activeSplitDetail && !linkedTransaction}
        onClose={() => setSelectedSplitDetail(null)}
        title={activeSplitDetail ? `Expense: ${activeSplitDetail.title}` : 'Split Details'}
        subtitle={activeSplitDetail ? `${fmtDate(activeSplitDetail.date)} • Total: ${currencyFormatter.format(activeSplitDetail.totalAmount || 0)}${activeSplitDetail.isCreatedByUser === false && activeSplitDetail.creatorName ? ` • Paid by ${activeSplitDetail.creatorName}` : ''}` : ''}
        width={typeof window !== 'undefined' && window.innerWidth <= 640 ? '100vw' : 640}
      >
        {activeSplitDetail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
            {/* Top Stat row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', background: 'var(--bg-subtle, #f9fafb)', padding: '12px', borderRadius: '8px' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL AMOUNT</div>
                <div style={{ fontSize: '16px', fontWeight: 800 }}>{currencyFormatter.format(activeSplitDetail.totalAmount || 0)}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>YOUR SHARE</div>
                <div style={{ fontSize: '16px', fontWeight: 800 }}>{currencyFormatter.format(activeSplitDetail.userShareAmount || 0)}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {activeSplitDetail.isCreatedByUser === false ? 'YOU PAID / REPAID' : 'COLLECTED'}
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--success, #10b981)' }}>
                  {currencyFormatter.format(activeSplitDetail.settledAmount || 0)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {activeSplitDetail.isCreatedByUser === false ? 'YOU OWE' : 'STATUS'}
                </div>
                <div style={{
                  fontSize: '14px', fontWeight: 800,
                  color: (activeSplitDetail.status === 'Settled' || activeSplitDetail.status === 'Closed' || activeSplitDetail.pendingAmount <= 0) ? 'var(--success, #10b981)' : '#d97706'
                }}>
                  {activeSplitDetail.isCreatedByUser === false
                    ? ((activeSplitDetail.status === 'Settled' || activeSplitDetail.status === 'Closed' || activeSplitDetail.pendingAmount <= 0) ? 'Settled' : currencyFormatter.format(activeSplitDetail.pendingAmount))
                    : activeSplitDetail.status}
                </div>
              </div>
            </div>

            {/* Parent Transaction details if linked */}
            {activeSplitDetail.parentBankReference && (
              <div style={{ fontSize: '12px', background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '10px 12px', borderRadius: '6px' }}>
                <div style={{ fontWeight: 600, color: 'var(--primary, #3b82f6)', marginBottom: '2px' }}>Linked Primary Bank Expense</div>
                <button className="gpay-transaction-link" onClick={() => openLinkedTransaction({ linkedAccountId: activeSplitDetail.parentAccountId, linkedBankReference: activeSplitDetail.parentBankReference, linkedBankType: activeSplitDetail.parentBankType, linkedTransactionType: activeSplitDetail.parentTransactionType, participantName: 'Primary expense' }, activeSplitDetail)}><FiLink size={13} /> {activeSplitDetail.parentBankReference}<FiChevronRight size={13} /></button>
              </div>
            )}

            {/* Participants list */}
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>
                Participants &amp; Settlements ({(activeSplitDetail.members || []).filter(m => !isSelfMember(m)).length + 1})
              </div>
              <div style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-subtle, #f9fafb)', textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                      <th style={{ padding: '8px 12px' }}>Member</th>
                      <th style={{ padding: '8px 12px' }}>Share</th>
                      <th style={{ padding: '8px 12px' }}>Status</th>
                      <th style={{ padding: '8px 12px' }}>Bank Transaction Link</th>
                      {!isImportedSplit(activeSplitDetail) && <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {/* User's own share row */}
                    <tr style={{ borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600 }}>You (Personal Share)</div>
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                        {currencyFormatter.format(activeSplitDetail.userShareAmount || 0)}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {(() => {
                          const userMem = (activeSplitDetail.members || []).find(m => isSelfMember(m));
                          const isDetailSettled = activeSplitDetail.status === 'Settled' || activeSplitDetail.status === 'Closed';
                          if (activeSplitDetail.isCreatedByUser) {
                            return <span className="gpay-payment-badge is-paid">Paid (Self)</span>;
                          }
                          const isSettled = isDetailSettled || (userMem ? userMem.isSettled : activeSplitDetail.pendingAmount <= 0);
                          if (isImportedSplit(activeSplitDetail)) {
                            return (
                              <span className={`gpay-payment-badge ${isSettled ? 'is-paid' : ''}`}>
                                {isSettled ? (isDetailSettled ? 'Closed' : 'Paid') : 'Unpaid'}
                              </span>
                            );
                          }
                          return (
                            <button
                              type="button"
                              onClick={() => userMem && handleToggleSettled(activeSplitDetail.id, userMem)}
                              disabled={!userMem}
                              style={{
                                border: 'none',
                                background: isSettled ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                color: isSettled ? '#059669' : '#dc2626',
                                fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px',
                                cursor: userMem ? 'pointer' : 'default'
                              }}
                              title={userMem ? "Click to toggle Paid/Unpaid" : ""}
                            >
                              {isSettled ? (isDetailSettled ? '✓ Closed' : '✓ Paid') : '○ Unpaid'}
                            </button>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '11px' }}>
                        {(() => {
                          const userMem = (activeSplitDetail.members || []).find(m => isSelfMember(m));
                          const isDetailSettled = activeSplitDetail.status === 'Settled' || activeSplitDetail.status === 'Closed';
                          if (userMem?.linkedBankReference) {
                            return (
                              <div>
                                <button className="gpay-transaction-link" onClick={() => openLinkedTransaction(userMem, activeSplitDetail)}>
                                  <FiLink size={13} /> {userMem.linkedBankReference}<FiChevronRight size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUnlinkTx(activeSplitDetail.id, userMem.id)}
                                  style={{ marginLeft: '6px', color: 'var(--danger, #ef4444)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px' }}
                                >
                                  (Unlink)
                                </button>
                              </div>
                            );
                          }
                          if (activeSplitDetail.isCreatedByUser || isDetailSettled) {
                            return '—';
                          }
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                openTransactionPicker('debit', userMem ? { groupId: activeSplitDetail.id, member: userMem } : null, activeSplitDetail.creatorName || '');
                              }}
                              style={{
                                fontSize: '11px', padding: '3px 8px', borderRadius: '4px',
                                background: 'rgba(59,130,246,0.1)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.2)', cursor: 'pointer'
                              }}
                            >
                              Link repayment debit
                            </button>
                          );
                        })()}
                      </td>
                      {!isImportedSplit(activeSplitDetail) && <td style={{ padding: '10px 12px', textAlign: 'right' }}>—</td>}
                    </tr>

                    {(activeSplitDetail.members || [])
                      .filter(m => !isSelfMember(m))
                      .map(m => (
                      <tr key={m.id} style={{ borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ fontWeight: 600 }}>{m.participantName}</div>
                          {m.participantVpa && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{m.participantVpa}</div>}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                          {currencyFormatter.format(m.assignedAmount || 0)}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {isImportedSplit(activeSplitDetail) ? (
                            <span className={`gpay-payment-badge ${m.isSettled ? 'is-paid' : ''}`}>
                              {m.isSettled ? 'Paid' : 'Unpaid'}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleSettled(activeSplitDetail.id, m)}
                              style={{
                                border: 'none', background: m.isSettled ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                color: m.isSettled ? '#059669' : '#dc2626',
                                fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', cursor: 'pointer'
                              }}
                              title="Click to toggle Paid/Unpaid"
                            >
                              {m.isSettled ? '✓ Paid' : '○ Unpaid'}
                            </button>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '11px' }}>
                          {m.linkedBankReference ? (
                            <div>
                              <button className="gpay-transaction-link" onClick={() => openLinkedTransaction(m, activeSplitDetail)} title="View linked bank transaction"><FiLink size={13} /> {m.linkedBankReference}<FiChevronRight size={13} /></button>
                              <button
                                type="button"
                                onClick={() => handleUnlinkTx(activeSplitDetail.id, m.id)}
                                style={{ marginLeft: '6px', color: 'var(--danger, #ef4444)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px' }}
                              >
                                (Unlink)
                              </button>
                            </div>
                          ) : canLinkIncomingCredit(activeSplitDetail, m) ? (
                            <button
                              type="button"
                              onClick={() => {
                                openTransactionPicker('credit', { groupId: activeSplitDetail.id, member: m }, m.participantName);
                              }}
                              style={{
                                fontSize: '11px', padding: '3px 8px', borderRadius: '4px',
                                background: 'rgba(59,130,246,0.1)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.2)', cursor: 'pointer'
                              }}
                            >
                              Link incoming credit
                            </button>
                          ) : (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {!activeSplitDetail.isCreatedByUser ? `Paid to ${activeSplitDetail.creatorName || 'creator'}` : '—'}
                            </span>
                          )}
                        </td>
                        {!isImportedSplit(activeSplitDetail) && <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(`Delete ${m.participantName}'s share?`)) return;
                              await deleteSplitMember(activeSplitDetail.id, m.id);
                              loadData();
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--danger, #ef4444)', cursor: 'pointer' }}
                            title="Remove participant"
                          >
                            <FiTrash2 size={13} />
                          </button>
                        </td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
              {!isImportedSplit(activeSplitDetail) && (<button
                type="button"
                className="btn btn--outline"
                onClick={() => {
                  handleDeleteGroup(activeSplitDetail.id);
                  setSelectedSplitDetail(null);
                }}
                style={{ color: 'var(--danger, #ef4444)', borderColor: 'var(--border, #e5e7eb)' }}
              >
                <FiTrash2 size={14} style={{ marginRight: '6px' }} /> Delete Expense
              </button>)}
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setSelectedSplitDetail(null)}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Drawer>

      <LinkedTransactionDrawer link={linkedTransaction} onClose={() => setLinkedTransaction(null)} />
    </div>
    </div>
  );
}
