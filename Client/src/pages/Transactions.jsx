import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import api from "../api/client";
import { Avatar, Badge, Button, Drawer, EmptyState, Modal, Tabs, useAuth, usePersistedState } from "@common/client";
import { useAccount } from "../context/useAccount";
import { ALL_ACCOUNTS } from "../components/AccountFilter";
import { FiDownload, FiUploadCloud, FiFileText, FiRotateCcw, FiFilter, FiSearch, FiAlertCircle } from "react-icons/fi";
import UploadStatement from "./UploadStatement";
import { getUploads, getAutoImports, revertStatement, retryAutoImport } from "../api/statements";
// ── Same DateRangePicker component used on Insights/Trends ──────────────
import DateRangePicker from "../components/Daterangepicker";
import { FilterGroup } from "../components/PageHeader";
import Pagination from "../components/Pagination";
import CategoryPicker from "../components/CategoryPicker";
import { currencyFormatter, maskName } from "../utils/format";
import { validateCategoryName, findExistingName } from "../utils/categoryName";

/* ─── Design tokens — mapped to the global CSS variable system so both the
 * inline styles and the injected <style> block below pick up light/dark. */
const T = {
  indigo:     'var(--primary)',
  indigoDim:  'var(--primary-light)',
  surface:    'var(--surface)',
  bg:         'var(--surface-2)',
  border:     'var(--border-color)',
  borderSub:  'var(--border-subtle)',
  text:       'var(--text-main)',
  muted:      'var(--text-muted)',
  faint:      'var(--text-faint)',
  red:        'var(--danger)',
  green:      'var(--success)',
  blue:       'var(--primary)',
  blueDim:    'var(--primary-light)',
};

/* ─── TransactionsFilters — rendered in Layout's PageHeader filter row ──── */
export function TransactionsFilters({ dateRange, setDateRange }) {
  return (
    <FilterGroup style={{ position: 'relative', zIndex: 500 }}>
      <DateRangePicker
        value={dateRange}
        onChange={setDateRange}
        showTime={false}
        align="left"
        placeholder="All Time"
      />
    </FilterGroup>
  );
}

export default function Transactions() {
  const { isAdmin } = useAuth();
  const { selectedAccountId } = useAccount();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Date filter now lives in Layout, shared with the header row ───────
  const {
    accounts = [],
    transactionsRange: dateRange = { start: null, end: null, preset: 'ALL' },
  } = useOutletContext() ?? {};

  // "All accounts" is a real combined view: accountId 0 plus an accountIds CSV
  // (the same contract Trends/Insights use), with each row carrying its own
  // account. A specific selection stays the single-account path.
  const isAllAccounts = selectedAccountId === ALL_ACCOUNTS;
  const effectiveAccountId = isAllAccounts ? (accounts.length > 0 ? 0 : null) : selectedAccountId;
  const accountScope = isAllAccounts ? accounts.map(a => a.id).join(',') : String(effectiveAccountId ?? '');
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const accountLabel = (accountId, fallback = '') => {
    const a = accountById.get(accountId);
    return a ? `${a.bankName} ····${a.accountNumber?.slice(-4) || '****'}` : fallback;
  };
  // Rows are identified by account + bank + reference — a BankReference alone
  // can repeat across accounts once the list spans all of them.
  const txKey = (t) => `${t.accountId}|${t.bankType}|${t.id}`;

  const [tx, setTx] = useState([]);
  const [loading, setLoading] = useState(effectiveAccountId == null);
  // Full-page loader only before the first load — later refetches (search typing,
  // paging) keep the list mounted so the search input doesn't lose focus.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [totalTransactions, setTotalTransactions] = useState(0);

  // Categories from API
  const [categories, setCategories] = useState([]);
  // Most-used category values (names), ranked by usage — drives the "Frequently used" group.
  const [frequentCategories, setFrequentCategories] = useState([]);

  // Pagination state (itemsPerPage persists across reloads; page resets to 1)
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = usePersistedState('transactionsPerPage', 10);

  // ── Column sort ───────────────────────────────────────────────────────
  // Server-side (the list is server-paginated); date-descending is the default.
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      // Text columns read naturally A→Z first; date/amount biggest-first.
      setSortDir(col === 'merchant' || col === 'category' ? 'asc' : 'desc');
    }
    setCurrentPage(1);
  };

  // Quick filter: show only transactions with no category yet
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false);
  const toggleUncategorized = () => {
    setUncategorizedOnly(v => !v);
    setCurrentPage(1);
  };

  // ── Bulk selection ────────────────────────────────────────────────────
  // Set of BankReferences. Kept across pages (so you can page through and act
  // once) but cleared whenever the account or filters change underneath it.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [selectionFilterKey, setSelectionFilterKey] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkTag, setBulkTag] = useState('');
  const clearSelection = () => setSelectedIds(new Set());

  const toggleSelected = (key) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Search — searchInput follows the textbox, search is its debounced value used for fetching
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Sidebar state
  const [selectedTx, setSelectedTx] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(450);
  const [tags, setTags] = useState([]);
  const [tagEditRowId, setTagEditRowId] = useState(null);   // row whose inline "+ tag" input is open
  const [noteEditRowId, setNoteEditRowId] = useState(null); // row whose inline note input is open

  // Upload modal + a bump to force the transaction list to re-fetch after an upload
  const [showUpload, setShowUpload] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Upload-history RHS drawer
  const [uploads, setUploads] = useState([]);
  const [importFails, setImportFails] = useState([]);
  const [showUploadHistory, setShowUploadHistory] = useState(false);
  const [loadingUploads, setLoadingUploads] = useState(false);
  const [uploadTab, setUploadTab] = useState('success'); // 'success' | 'failed'

  // The reminders panel deep-links here as /transactions?uploads=1 to surface a
  // failed import's "Try again". Derived rather than synced into state via an
  // effect, so it also works when this page is already mounted.
  const deepLinkedToUploads = searchParams.get('uploads') === '1';
  const uploadHistoryOpen = showUploadHistory || deepLinkedToUploads;

  const closeUploadHistory = () => {
    setShowUploadHistory(false);
    if (searchParams.has('uploads')) {
      const next = new URLSearchParams(searchParams);
      next.delete('uploads');
      setSearchParams(next, { replace: true });
    }
  };

  // "Try again" on a failed auto-import: a per-row PDF-password draft and busy flag.
  const [retryPw, setRetryPw] = useState({});
  const [retrying, setRetrying] = useState({});

  const handleRetryImport = async (fail) => {
    setRetrying(prev => ({ ...prev, [fail.id]: true }));
    try {
      await retryAutoImport(fail.id, retryPw[fail.id] || '');
      // Imported (or already present): drop the failed row and refresh the list.
      setImportFails(prev => prev.filter(f => f.id !== fail.id));
      setRetryPw(prev => { const next = { ...prev }; delete next[fail.id]; return next; });
      setRefreshKey(k => k + 1);
      getUploads()
        .then(res => setUploads((res.data || [])
          .filter(u => isAllAccounts || String(u.accountId) === String(effectiveAccountId))
          .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))))
        .catch(() => {});
    } catch (err) {
      alert(err.response?.data?.message || "Retry failed. Please check the password and try again.");
    } finally {
      setRetrying(prev => { const next = { ...prev }; delete next[fail.id]; return next; });
    }
  };

  // "N new" drill-down: restrict the list to the transactions a given upload added.
  // Tagged with its account so it silently stops applying if the account changes.
  const [uploadFilter, setUploadFilter] = useState(null); // { id, fileName, accountId } | null
  const activeUploadFilter =
    uploadFilter && String(uploadFilter.accountId) === String(effectiveAccountId)
      ? uploadFilter
      : null;

  const showNewTransactions = (upload) => {
    closeUploadHistory();
    setSelectedTx(null);
    setUploadFilter({ id: upload.id, fileName: upload.fileName, accountId: effectiveAccountId });
    setCurrentPage(1);
  };

  const openUploadHistory = () => {
    setSelectedTx(null);            // only one RHS panel at a time
    setShowUploadHistory(true);
    setUploadTab('success');

    // Background auto-imports don't announce themselves to this page — refetch
    // the list alongside the drawer so both reflect the same state.
    setRefreshKey(k => k + 1);
  };

  // Load the drawer's uploads whenever it's open — and re-load when the account
  // changes underneath it, so it never keeps showing another account's history.
  useEffect(() => {
    if (!uploadHistoryOpen) return;
    if (effectiveAccountId == null) { setUploads([]); setImportFails([]); return; }
    setLoadingUploads(true);
    Promise.all([
      getUploads().then(res => (res.data || [])
        .filter(u => isAllAccounts || String(u.accountId) === String(effectiveAccountId))
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      ).catch(() => []),
      // Failed auto-imports leave no upload row — fetched separately so they
      // still show up in the history alongside successful uploads.
      getAutoImports().then(res => (res.data || [])
        .filter(h => h.status === 'Failed' && (isAllAccounts || String(h.accountId) === String(effectiveAccountId)))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      ).catch(() => []),
    ])
      .then(([ups, fails]) => {
        setUploads(ups);
        setImportFails(fails);
        // The ?uploads=1 deep-link exists to surface a failed import's "Try
        // again" — land on that tab rather than making the user find it.
        if (deepLinkedToUploads && fails.length > 0) setUploadTab('failed');
      })
      .finally(() => setLoadingUploads(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadHistoryOpen, effectiveAccountId]);

  const handleRevert = async (upload) => {
    if (!upload?.id) return;
    if (!window.confirm(`Revert "${upload.fileName}"? Its imported transactions will be removed.`)) return;
    try {
      await revertStatement(upload.id);
      setUploads(prev => prev.filter(u => u.id !== upload.id));
      setUploadFilter(f => (f && f.id === upload.id ? null : f));
      setRefreshKey(k => k + 1);
    } catch {
      alert("Could not revert this upload. Please try again.");
    }
  };

  // Refetch on tab focus (throttled) so transactions the watcher imported while
  // the user was away — e.g. right after dropping a file in the folder — appear
  // without a manual reload.
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last > 15000) {
        last = Date.now();
        setRefreshKey(k => k + 1);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const loadFrequentCategories = () => {
    api.get('/categories/usage')
      .then(res => setFrequentCategories((res.data || []).map(x => x.name)))
      .catch(err => console.error("Failed to load category usage", err));
  };

  useEffect(() => {
    api.get('/categories')
      .then(res => setCategories(res.data || []))
      .catch(err => console.error("Failed to load categories", err));

    loadFrequentCategories();

    api.get('/tags')
      .then(res => setTags(res.data || []))
      .catch(err => console.error("Failed to load tags", err));
  }, []);

  // ── Helper: Date → "yyyy-MM-dd" string in local time ──────────────────
  const toLocalDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ── Date range now changes from the header — reset to page 1 when it does ──
  useEffect(() => {
    setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.start, dateRange.end]);

  // The open detail drawer holds a transaction from the previous account — that
  // row won't exist under the newly selected account, so close it (and any open
  // inline tag/note editors) instead of leaving stale info showing.
  useEffect(() => {
    setSelectedTx(null);
    setTagEditRowId(null);
    setNoteEditRowId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAccountId]);

  // Selection survives paging, but not a change to what's being listed — acting
  // on rows the user can no longer see would be a surprise. Reset during render
  // rather than in an effect so no stale selection is ever painted.
  const filterKey = [
    accountScope,
    dateRange.start, dateRange.end,
    uncategorizedOnly, search, uploadFilter?.id ?? '',
  ].join('|');
  if (selectionFilterKey !== filterKey) {
    setSelectionFilterKey(filterKey);
    if (selectedIds.size > 0) setSelectedIds(new Set());
  }

  useEffect(() => {
    if (effectiveAccountId == null) {
      setLoading(false);
      setTx([]);
      setTotalTransactions(0);
      return;
    }
    setLoading(true);

    const { start: startDate, end: endDate } = dateRange;

    const params = new URLSearchParams({ page: currentPage, pageSize: itemsPerPage });
    if (isAllAccounts) params.append('accountIds', accountScope);

    // While drilling into an upload's new transactions, ignore the date range —
    // the imported rows may fall outside the currently selected period.
    if (activeUploadFilter) {
      params.append('uploadId', activeUploadFilter.id);
    } else {
      if (startDate) params.append('startDate', toLocalDate(startDate));
      if (endDate)   params.append('endDate',   toLocalDate(endDate));
    }
    if (uncategorizedOnly) params.append('uncategorizedOnly', 'true');
    if (search) params.append('search', search);
    if (sortBy !== 'date' || sortDir !== 'desc') {
      params.append('sortBy', sortBy);
      params.append('sortDir', sortDir);
    }

    api.get(`/statements/${effectiveAccountId}?${params.toString()}`)
      .then(res => {
        let allTx = [];
        let isServerPaginated = false;

        if (Array.isArray(res.data)) {
          allTx = res.data;
        } else if (res.data) {
          allTx = res.data.transactions || [];
          if (typeof res.data.totalCount === 'number') {
            isServerPaginated = true;
          }
        }

        if (!isServerPaginated) {
          if (uncategorizedOnly) allTx = allTx.filter(t => !t.category);
          if (search) {
            const q = search.toLowerCase();
            allTx = allTx.filter(t =>
              (t.merchant || '').toLowerCase().includes(q) ||
              (t.description || '').toLowerCase().includes(q) ||
              (t.upiReference || '').toLowerCase().includes(q)
            );
          }
          // Client-side date filtering
          allTx = allTx.filter(t => {
            if (!startDate && !endDate) return true;
            const txDate = new Date(t.transactionDate);
            if (startDate) {
              const s = new Date(startDate); s.setHours(0, 0, 0, 0);
              if (txDate < s) return false;
            }
            if (endDate) {
              const e = new Date(endDate); e.setHours(23, 59, 59, 999);
              if (txDate > e) return false;
            }
            return true;
          });

          // Mirror the server-side column sort for the plain-array response shape.
          const dir = sortDir === 'asc' ? 1 : -1;
          const amountOf = (t) => Math.max(t.credit || 0, t.debit || 0);
          allTx.sort((a, b) => {
            let cmp;
            if (sortBy === 'merchant')      cmp = (a.merchant || '').localeCompare(b.merchant || '');
            else if (sortBy === 'category') cmp = (a.category || '').localeCompare(b.category || '');
            else if (sortBy === 'amount')   cmp = amountOf(a) - amountOf(b);
            else                            cmp = new Date(a.transactionDate) - new Date(b.transactionDate);
            if (cmp !== 0) return cmp * dir;
            return new Date(b.transactionDate) - new Date(a.transactionDate);
          });

          setTotalTransactions(allTx.length);
          const startIdx = (currentPage - 1) * itemsPerPage;
          setTx(allTx.slice(startIdx, startIdx + itemsPerPage));
        } else {
          setTx(allTx);
          setTotalTransactions(res.data.totalCount);
        }
        setLoading(false);
        setHasLoaded(true);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
        setHasLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAccountId, accountScope, currentPage, dateRange, itemsPerPage, refreshKey, uncategorizedOnly, search, uploadFilter, sortBy, sortDir]);

  if (loading && !hasLoaded) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <div className="loader-text">Loading transactions...</div>
      </div>
    );
  }

  if (effectiveAccountId == null) {
    return (
      <EmptyState
        title="No account selected"
        message="Add or select an account to see transactions."
      />
    );
  }

  // Pagination logic
  const totalPages = Math.ceil(totalTransactions / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;

  const handleCategoryChange = (t, selectedValue) => {
    const previousCategory = t.category;
    const previousSubCategory = t.subCategory;
    let resolvedCategory = selectedValue;
    let resolvedSubCategory = null;

    if (selectedValue) {
      for (const cat of categories) {
        if (cat.subCategories?.includes(selectedValue)) {
          resolvedCategory = cat.name;
          resolvedSubCategory = selectedValue;
          break;
        }
      }
    } else {
      resolvedCategory = null;
      resolvedSubCategory = null;
    }

    const displayLabel = resolvedSubCategory || resolvedCategory || '';

    setTx(prev => prev.map(item =>
      txKey(item) === txKey(t)
        ? { ...item, category: displayLabel, subCategory: resolvedSubCategory }
        : item
    ));

    setSelectedTx(prev =>
      prev && txKey(prev) === txKey(t)
        ? { ...prev, category: displayLabel, subCategory: resolvedSubCategory }
        : prev
    );

    api.patch(`/transactions/category`, {
      AccountId: t.accountId,
      BankReference: t.id,
      BankType: t.bankType,
      Category: resolvedCategory,
      SubCategory: resolvedSubCategory
    }).then(() => {
      // Keep the "Frequently used" group in step with the change just made.
      loadFrequentCategories();
    }).catch(err => {
      console.error("Failed to update category", err);
      alert("Failed to update category. Please try again.");
      setTx(prev => prev.map(item =>
        txKey(item) === txKey(t)
          ? { ...item, category: previousCategory, subCategory: previousSubCategory }
          : item
      ));
      setSelectedTx(prev =>
        prev && txKey(prev) === txKey(t)
          ? { ...prev, category: previousCategory, subCategory: previousSubCategory }
          : prev
      );
    });
  };

  // Inline "Create category" from the picker: reuse an existing match if one
  // exists, otherwise persist the new top-level category, add it to the local
  // list, then assign it to the transaction.
  const handleCreateCategory = (t, raw) => {
    const { name, error } = validateCategoryName(raw);
    if (error) { alert(error); return; }
    const existing = findExistingName(categories.map(c => c.name), name);
    if (existing) {
      handleCategoryChange(t, existing);
      return;
    }
    api.post('/categories', { name })
      .then(res => {
        const created = res.data;
        setCategories(prev => [
          ...prev,
          { id: created.id, name: created.name, subCategories: created.subCategories || [] },
        ]);
        handleCategoryChange(t, created.name);
      })
      .catch(err => {
        console.error("Failed to create category", err);
        alert(err.response?.data || "Failed to create category.");
      });
  };

  const updateTags = (t, updatedTags) => {
    const previousTags = t.tags;

    setSelectedTx(prev => prev && txKey(prev) === txKey(t) ? { ...prev, tags: updatedTags } : prev);
    setTx(prev => prev.map(item =>
      txKey(item) === txKey(t) ? { ...item, tags: updatedTags } : item
    ));

    api.patch(`/transactions/tags`, {
      AccountId: t.accountId,
      BankReference: t.id,
      BankType: t.bankType,
      Tags: updatedTags
    }).catch(err => {
      console.error("Failed to update tags", err);
      alert("Failed to update tags. Please try again.");
      setSelectedTx(prev => prev && txKey(prev) === txKey(t) ? { ...prev, tags: previousTags } : prev);
      setTx(prev => prev.map(item =>
        txKey(item) === txKey(t) ? { ...item, tags: previousTags } : item
      ));
    });
  };

  const handleTagChange = (updatedTags) => updateTags(selectedTx, updatedTags);

  const addRowTag = (t, value) => {
    const newTag = (value || '').trim().toLowerCase();
    if (!newTag) return;
    const current = t.tags || [];
    if (!current.includes(newTag)) updateTags(t, [...current, newTag]);
  };

  const handleRemoveTag = (tagToRemove) => {
    handleTagChange((selectedTx.tags || []).filter(t => t !== tagToRemove));
  };

  const updateNote = (t, newNote) => {
    const trimmed = (newNote ?? '').trim();
    const previousNote = t.note;
    if (trimmed === (previousNote || '')) return; // nothing changed

    setSelectedTx(prev => prev && txKey(prev) === txKey(t) ? { ...prev, note: trimmed } : prev);
    setTx(prev => prev.map(item =>
      txKey(item) === txKey(t) ? { ...item, note: trimmed } : item
    ));

    api.patch(`/transactions/note`, {
      AccountId: t.accountId,
      BankReference: t.id,
      BankType: t.bankType,
      Note: trimmed
    }).catch(err => {
      console.error("Failed to update note", err);
      alert("Failed to update note. Please try again.");
      setSelectedTx(prev => prev && txKey(prev) === txKey(t) ? { ...prev, note: previousNote } : prev);
      setTx(prev => prev.map(item =>
        txKey(item) === txKey(t) ? { ...item, note: previousNote } : item
      ));
    });
  };

  const handleNoteChange = (newNote) => updateNote(selectedTx, newNote);

  // ── Bulk actions ──────────────────────────────────────────────────────
  // The bulk endpoint acts on one account at a time, and in the combined view a
  // selection can span accounts — so split the selection keys back into
  // (account, bankType) groups and PATCH each. The list is refetched afterwards
  // so the rows reflect server truth (merchant defaults, normalised tags)
  // rather than an optimistic guess applied to many rows at once.
  const runBulk = async (payload, describe) => {
    if (selectedIds.size === 0) return;
    const groups = new Map();
    for (const key of selectedIds) {
      const [accId, bType, ...refParts] = key.split('|');
      const groupKey = `${accId}|${bType}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { accountId: Number(accId), bankType: bType, refs: [] });
      groups.get(groupKey).refs.push(refParts.join('|'));
    }
    setBulkBusy(true);
    try {
      let updated = 0;
      for (const group of groups.values()) {
        const res = await api.patch('/transactions/bulk', {
          AccountId: group.accountId,
          BankType: group.bankType,
          BankReferences: group.refs,
          ...payload,
        });
        updated += res.data?.updated ?? group.refs.length;
      }
      clearSelection();
      setSelectedTx(null);
      setRefreshKey(k => k + 1);
      if (updated === 0) alert(`Nothing to change — ${describe} left every selected transaction as it was.`);
    } catch (err) {
      console.error("Bulk update failed", err);
      alert(err.response?.data?.message || "Bulk update failed. Please try again.");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkCategory = (selectedValue) => {
    let resolvedCategory = selectedValue;
    let resolvedSubCategory = null;
    if (selectedValue) {
      for (const cat of categories) {
        if (cat.subCategories?.includes(selectedValue)) {
          resolvedCategory = cat.name;
          resolvedSubCategory = selectedValue;
          break;
        }
      }
    } else {
      resolvedCategory = null;
    }
    runBulk(
      { Action: 'category', Category: resolvedCategory, SubCategory: resolvedSubCategory },
      'that category',
    ).then(loadFrequentCategories);
  };

  const handleBulkTag = (action, value) => {
    const tag = (value || '').trim().toLowerCase();
    if (!tag) return;
    runBulk({ Action: action, Tag: tag }, `#${tag}`);
  };

  const handleExportCSV = () => {
    const { start: startDate, end: endDate } = dateRange;
    const params = new URLSearchParams({ pageSize: 0 });
    if (isAllAccounts) params.append('accountIds', accountScope);
    if (startDate) params.append('startDate', toLocalDate(startDate));
    if (endDate)   params.append('endDate',   toLocalDate(endDate));
    if (uncategorizedOnly) params.append('uncategorizedOnly', 'true');
    if (search) params.append('search', search);
    if (sortBy !== 'date' || sortDir !== 'desc') {
      params.append('sortBy', sortBy);
      params.append('sortDir', sortDir);
    }

    api.get(`/statements/${effectiveAccountId}?${params.toString()}`)
      .then(res => {
        let allTx = Array.isArray(res.data) ? res.data : (res.data.transactions || []);
        if (allTx.length === 0) return alert("No transactions to export.");

        const headers = ["Date", "Merchant", "Category", "Description", "Debit", "Credit", "Balance", "Mode", "UPI Reference"];
        if (isAllAccounts) headers.unshift("Account");
        const csvRows = [headers.join(",")];

        allTx.forEach(t => {
          const row = [
            new Date(t.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
            `"${(t.merchant || '-').replace(/"/g, '""')}"`,
            `"${(t.category || '-').replace(/"/g, '""')}"`,
            `"${(t.description || '-').replace(/"/g, '""')}"`,
            t.debit || 0,
            t.credit || 0,
            t.balance || 0,
            `"${t.mode || ''}"`,
            `"${t.upiReference || ''}"`
          ];
          if (isAllAccounts) row.unshift(`"${accountLabel(t.accountId, t.bankType).replace(/"/g, '""')}"`);
          csvRows.push(row.join(","));
        });

        const blob = new Blob([csvRows.join("\n")], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `Transactions_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      })
      .catch(err => {
        console.error("Export failed", err);
        alert("Failed to export transactions.");
      });
  };

  // Select-all applies to the rows currently on screen; the selection itself may
  // already hold rows from other pages, so count them separately.
  const pageIds = tx.filter(t => t.id).map(txKey);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
  const someOnPageSelected = pageIds.some(id => selectedIds.has(id));

  const toggleSelectPage = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  return (
    <div style={{ marginRight: (selectedTx || uploadHistoryOpen) ? sidebarWidth : 0, transition: 'margin-right 0.2s ease' }}>
      <style>{`
        .tx-row {
          display: grid;
          grid-template-columns: ${isAdmin ? '22px ' : ''}76px minmax(0,1fr) 168px 128px;
          align-items: center;
          gap: 16px;
          padding: 13px 20px;
          border-bottom: 1px solid ${T.borderSub};
          cursor: pointer;
          transition: background 0.12s;
        }
        .tx-row:hover { background: ${T.bg}; }
        .tx-row.selected { background: ${T.indigoDim}; }
        .tx-row.checked { background: ${T.indigoDim}; }
        .tx-row:last-child { border-bottom: none; }
        .tx-check {
          width: 15px; height: 15px; cursor: pointer; accent-color: ${T.indigo};
          margin: 0; display: block;
        }
        .tx-head {
          display: grid;
          grid-template-columns: ${isAdmin ? '22px ' : ''}76px minmax(0,1fr) 168px 128px;
          gap: 16px;
          padding: 12px 20px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: ${T.faint};
          border-bottom: 1px solid ${T.border};
          background: ${T.bg};
        }
        .tx-sort {
          display: inline-flex; align-items: center; gap: 4px;
          cursor: pointer; user-select: none;
          transition: color 0.12s;
        }
        .tx-sort:hover { color: ${T.muted}; }
        .tx-sort.active { color: ${T.indigo}; }
        .tx-sort-arrow { font-size: 8px; line-height: 1; }
        .tx-tag {
          display: inline-flex; align-items: center; gap: 4px;
          background: ${T.blueDim}; color: ${T.blue};
          padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600;
        }
        .tx-tag-x { cursor: pointer; opacity: 0.55; font-weight: 700; line-height: 1; }
        .tx-tag-x:hover { opacity: 1; }
        .tx-tag-add {
          display: inline-flex; align-items: center;
          border: 1px dashed ${T.border}; color: ${T.faint};
          padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600;
          cursor: pointer; white-space: nowrap; opacity: 0;
          transition: opacity 0.12s, color 0.12s, border-color 0.12s;
        }
        .tx-row:hover .tx-tag-add, .tx-tag-add.open { opacity: 1; }
        .tx-tag-add:hover { color: ${T.indigo}; border-color: ${T.indigo}; background: ${T.indigoDim}; }
        .tx-tag-input {
          width: 96px; padding: 1px 8px; font-size: 11px; font-weight: 600;
          border: 1px solid ${T.indigo}; border-radius: 999px; outline: none;
          background: ${T.surface}; color: ${T.text}; font-family: inherit;
        }
        .tx-note {
          font-size: 11px; font-style: italic; color: ${T.muted};
          max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          cursor: pointer;
        }
        .tx-note:hover { color: ${T.indigo}; }
        .tx-note-input {
          flex: 1 1 120px; min-width: 100px; max-width: 240px;
          padding: 1px 8px; font-size: 11px;
          border: 1px solid ${T.indigo}; border-radius: 999px; outline: none;
          background: ${T.surface}; color: ${T.text}; font-family: inherit;
        }
        .tx-search {
          width: 100%; padding: 8px 14px 8px 36px;
          border: 1px solid ${T.border}; border-radius: 10px;
          font-size: 13px; font-family: inherit; background: ${T.surface};
          color: ${T.text}; outline: none; transition: border-color 0.15s, box-shadow 0.15s;
        }
        .tx-search:focus { border-color: ${T.indigo}; box-shadow: 0 0 0 3px ${T.indigoDim}; }
        .tx-search::placeholder { color: ${T.faint}; }
        .tx-bulkbar {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          padding: 10px 14px; margin-bottom: var(--space-3);
          background: ${T.indigoDim}; border: 1px solid ${T.indigo};
          border-radius: 12px;
        }
        .tx-bulk-count { font-size: 13px; font-weight: 700; color: ${T.indigo}; }
        .tx-bulk-tag {
          width: 130px; padding: 5px 10px; font-size: 13px;
          border: 1px solid ${T.border}; border-radius: 8px; outline: none;
          background: ${T.surface}; color: ${T.text}; font-family: inherit;
        }
        .tx-bulk-tag:focus { border-color: ${T.indigo}; }
        @media (max-width: 720px) {
          .tx-row, .tx-head { grid-template-columns: ${isAdmin ? '22px ' : ''}60px minmax(0,1fr) 110px; }
          .tx-col-cat { display: none; }
        }
      `}</style>

      {/* ── Action strip — title/date-filter now live in the shared header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '0 1 300px', marginRight: 'auto' }}>
          <FiSearch size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: T.faint, pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="Search merchant, description, UPI…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="tx-search"
          />
        </div>
        {isAdmin && (
          <Button onClick={() => setShowUpload(true)} style={{ fontSize: 'var(--text-sm)' }}>
            <FiUploadCloud size={14} /> Upload Statement
          </Button>
        )}
        <Button onClick={openUploadHistory} style={{ fontSize: 'var(--text-sm)' }}>
          <FiFileText size={14} /> Upload History
        </Button>
        <Button onClick={handleExportCSV} style={{ fontSize: 'var(--text-sm)' }}>
          <FiDownload size={14} /> Export CSV
        </Button>
        <Button
          variant={uncategorizedOnly ? 'primary' : 'secondary'}
          onClick={toggleUncategorized}
          title="Show only transactions without a category"
          style={{ fontSize: 'var(--text-sm)' }}
        >
          <FiFilter size={14} /> Uncategorized
        </Button>

        {activeUploadFilter && (
          <Badge
            variant="green"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '280px' }}
            title={`Showing transactions added by ${activeUploadFilter.fileName}`}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              New in {activeUploadFilter.fileName}
            </span>
            <span
              onClick={() => { setUploadFilter(null); setCurrentPage(1); }}
              style={{ cursor: 'pointer', fontWeight: 700, flexShrink: 0 }}
              title="Clear upload filter"
            >
              ×
            </span>
          </Badge>
        )}

        <Badge variant="blue">
          {totalTransactions} {uncategorizedOnly ? 'Uncategorized' : 'Total'} Transactions
        </Badge>
      </div>

      {/* ── Bulk action bar — only while something is selected ────────────── */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="tx-bulkbar">
          <span className="tx-bulk-count">{selectedIds.size} selected</span>

          <div style={{ width: '190px' }} onClick={(e) => e.stopPropagation()}>
            <CategoryPicker
              value=""
              categories={categories}
              frequentCategories={frequentCategories}
              onChange={handleBulkCategory}
              disabled={bulkBusy}
              size="sm"
              placeholder="Set category…"
            />
          </div>

          <input
            className="tx-bulk-tag"
            list="tx-row-tags-list"
            placeholder="tag…"
            value={bulkTag}
            disabled={bulkBusy}
            onChange={(e) => setBulkTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && bulkTag.trim()) {
                handleBulkTag('addTag', bulkTag);
                setBulkTag('');
              }
            }}
          />
          <Button
            variant="secondary"
            disabled={bulkBusy || !bulkTag.trim()}
            onClick={() => { handleBulkTag('addTag', bulkTag); setBulkTag(''); }}
            style={{ fontSize: 'var(--text-sm)' }}
          >
            Add tag
          </Button>
          <Button
            variant="secondary"
            disabled={bulkBusy || !bulkTag.trim()}
            onClick={() => { handleBulkTag('removeTag', bulkTag); setBulkTag(''); }}
            style={{ fontSize: 'var(--text-sm)' }}
          >
            Remove tag
          </Button>

          <Button
            variant="secondary"
            onClick={clearSelection}
            disabled={bulkBusy}
            style={{ fontSize: 'var(--text-sm)', marginLeft: 'auto' }}
          >
            Clear
          </Button>
          {bulkBusy && <span style={{ fontSize: '12px', color: T.muted }}>Applying…</span>}
        </div>
      )}

      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: '14px', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
      }}>
        <div className="tx-head">
          {isAdmin && (
            <input
              type="checkbox"
              className="tx-check"
              checked={allOnPageSelected}
              ref={el => { if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected; }}
              onChange={toggleSelectPage}
              disabled={pageIds.length === 0}
              title={allOnPageSelected ? 'Clear this page' : 'Select every transaction on this page'}
            />
          )}
          {[
            { col: 'date', label: 'Date' },
            { col: 'merchant', label: 'Merchant' },
            { col: 'category', label: 'Category', className: 'tx-col-cat' },
            { col: 'amount', label: 'Amount', style: { justifyContent: 'flex-end' } },
          ].map(({ col, label, className, style }) => (
            <span
              key={col}
              className={`tx-sort${sortBy === col ? ' active' : ''}${className ? ` ${className}` : ''}`}
              style={style}
              onClick={() => toggleSort(col)}
              title={`Sort by ${label.toLowerCase()}`}
            >
              {label}
              {sortBy === col && (
                <span className="tx-sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </span>
          ))}
        </div>

        <datalist id="tx-row-tags-list">
          {tags.map(tag => (
            <option key={tag.id} value={tag.name} />
          ))}
        </datalist>

        <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
          {tx.length === 0 ? (
            <EmptyState icon="🧾" title="No transactions" message="No transactions found for the selected filters." />
          ) : (
            tx.map((t, index) => {
              const isCredit = t.credit > 0;
              const d = new Date(t.transactionDate);
              const catValue = t.subCategory || t.category || '';
              const rowTags = t.tags || [];
              const rowKey = txKey(t);
              const isChecked = selectedIds.has(rowKey);
              return (
                <div
                  key={t.id ? rowKey : index}
                  className={`tx-row${selectedTx && txKey(selectedTx) === rowKey ? ' selected' : ''}${isChecked ? ' checked' : ''}`}
                  onClick={() => { closeUploadHistory(); setSelectedTx(t); }}
                >
                  {isAdmin && (
                    <input
                      type="checkbox"
                      className="tx-check"
                      checked={isChecked}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelected(rowKey)}
                    />
                  )}
                  <div style={{ textAlign: 'center' }}>
                    <div className="tnum" style={{ fontSize: '17px', fontWeight: 800, color: T.text, lineHeight: 1.1 }}>
                      {d.toLocaleDateString('en-IN', { day: '2-digit' })}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: T.faint, textTransform: 'uppercase' }}>
                      {d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <Avatar name={maskName(t.merchant) || '?'} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span style={{
                          fontSize: '14px', fontWeight: 700, color: T.text,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {maskName(t.merchant) || '—'}
                        </span>
                        {t.isTransfer && (
                          <span
                            title="Money moved between your own accounts — excluded from income/spend analytics"
                            style={{
                              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                              color: 'var(--text-muted)', background: 'var(--surface-2)',
                              border: '1px solid var(--border-color)', padding: '1px 7px',
                              borderRadius: '999px', whiteSpace: 'nowrap', flexShrink: 0,
                            }}
                          >
                            ⇄ Transfer
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', minWidth: 0 }}>
                        {isAllAccounts && (
                          <span
                            title="Account"
                            style={{
                              fontSize: '10px', fontWeight: 700, color: T.muted,
                              background: T.bg, border: `1px solid ${T.borderSub}`,
                              padding: '0 6px', borderRadius: '999px',
                              whiteSpace: 'nowrap', flexShrink: 0,
                            }}
                          >
                            {accountLabel(t.accountId, t.bankType)}
                          </span>
                        )}
                        <span style={{ fontSize: '12px', color: T.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.mode || 'Transfer'}
                        </span>
                        {rowTags.slice(0, 2).map(tag => (
                          <span key={tag} className="tx-tag">
                            #{tag}
                            <span
                              className="tx-tag-x"
                              title="Remove tag"
                              onClick={(e) => { e.stopPropagation(); updateTags(t, rowTags.filter(x => x !== tag)); }}
                            >×</span>
                          </span>
                        ))}
                        {rowTags.length > 2 && <span style={{ fontSize: '11px', color: T.faint }}>+{rowTags.length - 2}</span>}
                        {tagEditRowId === rowKey ? (
                          <input
                            className="tx-tag-input"
                            list="tx-row-tags-list"
                            autoFocus
                            placeholder="tag…"
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => { addRowTag(t, e.target.value); setTagEditRowId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { addRowTag(t, e.target.value); setTagEditRowId(null); }
                              else if (e.key === 'Escape') setTagEditRowId(null);
                            }}
                          />
                        ) : (
                          <span
                            className="tx-tag-add"
                            onClick={(e) => { e.stopPropagation(); setNoteEditRowId(null); setTagEditRowId(rowKey); }}
                          >+ tag</span>
                        )}
                        {noteEditRowId === rowKey ? (
                          <input
                            className="tx-note-input"
                            autoFocus
                            defaultValue={t.note || ''}
                            placeholder="note…"
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => { updateNote(t, e.target.value); setNoteEditRowId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { updateNote(t, e.target.value); setNoteEditRowId(null); }
                              else if (e.key === 'Escape') setNoteEditRowId(null);
                            }}
                          />
                        ) : t.note ? (
                          <span
                            className="tx-note"
                            title={t.note}
                            onClick={(e) => { e.stopPropagation(); setTagEditRowId(null); setNoteEditRowId(rowKey); }}
                          >✎ {t.note}</span>
                        ) : (
                          <span
                            className="tx-tag-add"
                            onClick={(e) => { e.stopPropagation(); setTagEditRowId(null); setNoteEditRowId(rowKey); }}
                          >+ note</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="tx-col-cat" onClick={(e) => e.stopPropagation()}>
                    <CategoryPicker
                      value={catValue}
                      categories={categories}
                      frequentCategories={frequentCategories}
                      onChange={(val) => handleCategoryChange(t, val)}
                      onCreate={isAdmin ? (name) => handleCreateCategory(t, name) : undefined}
                      size="sm"
                    />
                  </div>

                  <div className="tnum" style={{ textAlign: 'right', fontSize: '15px', fontWeight: 800, color: isCredit ? T.green : T.red, letterSpacing: '-0.3px' }}>
                    {isCredit ? '+' : '−'}{currencyFormatter.format(Math.max(t.credit, t.debit))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Pagination Controls */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        itemsPerPage={itemsPerPage}
        currentCount={tx.length}
        totalCount={totalTransactions}
        startIndex={startIndex}
        itemLabel="transactions"
        onPageChange={setCurrentPage}
        onItemsPerPageChange={(size) => { setItemsPerPage(size); setCurrentPage(1); }}
      />

      {/* RHS detail drawer — non-modal so the list & sidebar stay interactive */}
      <Drawer
        open={!!selectedTx}
        onClose={() => setSelectedTx(null)}
        title="Transaction Details"
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        modal={false}
      >
        {selectedTx && (
          <>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
              padding: '8px 0 22px', borderBottom: `1px solid ${T.border}`, marginBottom: '24px',
            }}>
              <Avatar name={maskName(selectedTx.merchant) || '?'} size={52} />
              <div className="tnum" style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-0.5px', color: selectedTx.credit ? T.green : T.red }}>
                {selectedTx.credit ? '+' : '−'}{currencyFormatter.format(Math.max(selectedTx.credit, selectedTx.debit))}
              </div>
              <div style={{ color: T.muted, fontSize: '15px', fontWeight: 600, textAlign: 'center' }}>
                {maskName(selectedTx.merchant)}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
              {isAllAccounts && (
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Account</div>
                  <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500 }}>{accountLabel(selectedTx.accountId, selectedTx.bankType)}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Date</div>
                <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500 }}>{new Date(selectedTx.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Mode</div>
                <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500 }}>{selectedTx.mode || '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Reference / UPI ID</div>
                <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500, wordBreak: 'break-all' }}>{selectedTx.upiReference || '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Balance</div>
                <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500 }}>{selectedTx.balance ? currencyFormatter.format(selectedTx.balance) : '-'}</div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Description</div>
                <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500 }}>{maskName(selectedTx.description) || '-'}</div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Category</div>
                <div style={{ marginTop: '8px' }}>
                  <CategoryPicker
                    value={selectedTx.subCategory || selectedTx.category || ''}
                    categories={categories}
                    frequentCategories={frequentCategories}
                    onChange={(val) => handleCategoryChange(selectedTx, val)}
                    onCreate={isAdmin ? (name) => handleCreateCategory(selectedTx, name) : undefined}
                    disabled={!isAdmin}
                    size="md"
                  />
                </div>
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Tags</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                  {(selectedTx.tags || []).map(tag => (
                    <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', padding: '3px 8px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: 600 }}>
                      #{tag}
                      {isAdmin && (
                        <span onClick={() => handleRemoveTag(tag)} style={{ cursor: 'pointer', color: 'var(--primary)', opacity: 0.6, fontWeight: 700, fontSize: '14px', lineHeight: 1 }}>×</span>
                      )}
                    </span>
                  ))}
                </div>
                {isAdmin && (
                <input
                  type="text"
                  list={`tags-list-${selectedTx.id}`}
                  placeholder="+ Add a tag"
                  className="field-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      const newTag = e.target.value.trim().toLowerCase();
                      const currentTags = selectedTx.tags || [];
                      if (!currentTags.includes(newTag)) handleTagChange([...currentTags, newTag]);
                      e.target.value = '';
                      e.preventDefault();
                    }
                  }}
                  onChange={(e) => {
                    const matched = tags.find(t => t.name.toLowerCase() === e.target.value.toLowerCase());
                    if (matched) {
                      const currentTags = selectedTx.tags || [];
                      if (!currentTags.includes(matched.name)) handleTagChange([...currentTags, matched.name]);
                      e.target.value = '';
                    }
                  }}
                  style={{ marginTop: '8px' }}
                />
                )}
                <datalist id={`tags-list-${selectedTx.id}`}>
                  {tags.filter(tag => !(selectedTx.tags || []).includes(tag.name)).map(tag => (
                    <option key={tag.id} value={tag.name} />
                  ))}
                </datalist>
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Note</div>
                {isAdmin ? (
                  <textarea
                    key={selectedTx.id}
                    defaultValue={selectedTx.note || ''}
                    placeholder="Add a note for this transaction…"
                    className="field-input"
                    rows={3}
                    onBlur={(e) => handleNoteChange(e.target.value)}
                    style={{ marginTop: '8px', width: '100%', resize: 'vertical' }}
                  />
                ) : (
                  <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 500, whiteSpace: 'pre-wrap' }}>
                    {selectedTx.note || '-'}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Drawer>

      {/* Upload history — RHS drawer */}
      <Drawer
        open={uploadHistoryOpen}
        onClose={closeUploadHistory}
        title="Upload History"
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        modal={false}
      >
        {loadingUploads ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>Loading...</div>
        ) : (
          <>
            <div style={{ marginBottom: '14px' }}>
              <Tabs
                variant="underline"
                active={uploadTab}
                onChange={setUploadTab}
                tabs={[
                  { key: 'success', label: 'Imported', count: uploads.length },
                  { key: 'failed', label: 'Failed', count: importFails.length },
                ]}
              />
            </div>

            {uploadTab === 'success' ? (
              uploads.length === 0 ? (
                <EmptyState message={isAllAccounts
                  ? "No statements have been imported yet."
                  : "No statements have been imported for this account yet."} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {uploads.map(upload => (
                    <div key={`u-${upload.id}`} className="card" style={{ padding: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <FiFileText size={22} color="var(--primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '14px', wordBreak: 'break-all' }}>{upload.fileName}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {new Date(upload.uploadedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {isAllAccounts && accountById.has(upload.accountId) && ` · ${accountLabel(upload.accountId)}`}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            <Badge variant="blue">{upload.totalCount ?? upload.transactionCount ?? 0} total</Badge>
                            {(upload.newCount ?? 0) > 0 ? (
                              <Badge
                                variant="green"
                                onClick={() => showNewTransactions(upload)}
                                style={{ cursor: 'pointer', textDecoration: 'underline' }}
                                title="Show the transactions this upload added"
                              >
                                {upload.newCount} new
                              </Badge>
                            ) : (
                              <Badge variant="green">0 new</Badge>
                            )}
                            {upload.autoImported && <Badge variant="purple">Auto</Badge>}
                            {isAdmin && (
                              <button className="btn danger small" onClick={() => handleRevert(upload)}>
                                <FiRotateCcw size={12} /> Revert
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              importFails.length === 0 ? (
                <EmptyState message={isAllAccounts
                  ? "No failed imports."
                  : "No failed imports for this account."} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {importFails.map(fail => (
                    <div key={`f-${fail.id}`} className="card" style={{ padding: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <FiAlertCircle size={22} color="var(--danger, #dc2626)" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '14px', wordBreak: 'break-all' }}>{fail.fileName}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {new Date(fail.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {isAllAccounts && accountById.has(fail.accountId) && ` · ${accountLabel(fail.accountId)}`}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            <Badge variant="red">Auto-import failed</Badge>
                            {fail.attempts > 1 && (
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{fail.attempts} attempts</span>
                            )}
                          </div>
                          {fail.error && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>{fail.error}</div>
                          )}
                          {isAdmin && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                              <input
                                type="password"
                                placeholder="PDF password"
                                value={retryPw[fail.id] || ''}
                                onChange={(e) => setRetryPw(prev => ({ ...prev, [fail.id]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleRetryImport(fail); }}
                                className="field-input"
                                style={{ width: '150px' }}
                              />
                              <button
                                className="btn primary small"
                                disabled={!!retrying[fail.id]}
                                onClick={() => handleRetryImport(fail)}
                              >
                                <FiRotateCcw size={12} /> {retrying[fail.id] ? 'Retrying…' : 'Try again'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}
      </Drawer>

      {/* Upload statement modal — scoped to the selected account; closes itself and refreshes the list on success */}
      <Modal open={showUpload} onClose={() => setShowUpload(false)} width={760}>
        <UploadStatement onUploaded={() => { setShowUpload(false); setRefreshKey(k => k + 1); }} showHistory={false} />
      </Modal>
    </div>
  );
}