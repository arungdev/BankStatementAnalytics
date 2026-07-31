import { useEffect, useState, useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { FiFilter } from "react-icons/fi";
import api from "../api/client";
import Button from "../components/ui/Button";
import { currencyFormatter, isAmountMasked, MASKED_AMOUNT, maskName } from "../utils/format";
import EmptyState from "../components/ui/EmptyState";
import Drawer from "../components/ui/Drawer";
import Avatar from "../components/ui/Avatar";
import Modal from "../components/ui/Modal";
import CategoryPicker from "../components/CategoryPicker";
import { avatarColors } from "../utils/avatar";
import { useAuth } from "../context/useAuth";
import { useAccount } from "../context/useAccount";
import { ALL_ACCOUNTS } from "../components/AccountFilter";
import { usePrivacy } from "../context/usePrivacy";
import useTheme from "../context/useTheme";
import { getToken } from "../theme/chartTheme";

/* ─── Design tokens — mapped to the global CSS variable system so DOM inline
 * styles pick up light/dark automatically. (SVG chart colors can't use var()
 * and are resolved separately via getToken() — see `chartC` below.) */
const T = {
  indigo:     'var(--primary)',
  indigoDim:  'var(--primary-light)',
  indigoSoft: 'var(--stat-tile-label)',
  surface:    'var(--surface)',
  bg:         'var(--surface-2)',
  border:     'var(--border-color)',
  borderSub:  'var(--border-subtle)',
  text:       'var(--text-main)',
  muted:      'var(--text-muted)',
  faint:      'var(--text-faint)',
  red:        'var(--danger)',
  green:      'var(--success)',
};

/* Small label/value block reused across the detail drawer. */
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: '11px', color: T.faint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ marginTop: '5px', color: T.text, fontSize: '14px', fontWeight: 500 }}>{children}</div>
    </div>
  );
}

export default function Merchants() {
  const { isAdmin } = useAuth();
  const { theme } = useTheme();
  // Subscribe to the mask flag so toggling "hide amounts" re-renders this page;
  // its other contexts (auth/theme) don't change on toggle, so without this the
  // currencyFormatter amounts would stay stale until the next unrelated render.
  usePrivacy();
  // Resolved colors for the recharts sparkline (SVG can't consume var()).
  const chartC = useMemo(() => ({
    bar: getToken('primary'),
    grid: getToken('chart-grid'),
    tick: getToken('chart-tick'),
    tooltipBg: getToken('surface'),
    tooltipText: getToken('text-main'),
    tooltipBorder: getToken('border-color'),
    // `theme` is the trigger: getToken() reads resolved CSS vars off the DOM,
    // so we must recompute when the theme flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  // Quick filter: show only merchants with no category yet
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false);

  // Sidebar state
  const [selectedMerchantId, setSelectedMerchantId] = useState(null);
  const [merchantDetails, setMerchantDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ friendlyName: '', notes: '', category: '', subCategory: '', shiftToNextMonth: false });
  // Spend column sort: null keeps the API's own order (transaction count desc).
  const [spentSort, setSpentSort] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(460);
  const [categoriesList, setCategoriesList] = useState([]);
  // Most-used category values (names), ranked by usage — drives the CategoryPicker
  // "Frequently used" group, same as the Transactions page.
  const [frequentCategories, setFrequentCategories] = useState([]);
  const [txFilterName, setTxFilterName] = useState('ALL');

  // Merge state
  const [selectedIds, setSelectedIds] = useState([]);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [primaryMergeId, setPrimaryMergeId] = useState("");
  // In-flight guard for the bulk "set category on all selected" action
  const [bulkSaving, setBulkSaving] = useState(false);

  // Auto-suggested merges (duplicate detection)
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [suggestPrimary, setSuggestPrimary] = useState({});
  const [mergingKey, setMergingKey] = useState(null);

  // Account scoping: "All accounts" (or no selection yet) sends no params, which the
  // API treats as unfiltered — identical to the pre-filter behavior.
  const { selectedAccountId } = useAccount();
  const isAllAccounts = !selectedAccountId || selectedAccountId === ALL_ACCOUNTS;
  const accountQuery = isAllAccounts ? '' : `?accountId=${selectedAccountId}`;

  const fetchMerchants = () =>
    api.get(`/merchants${accountQuery}`).then(res => setData(res.data || []));

  useEffect(() => {
    api.get("/categories")
      .then(res => setCategoriesList(res.data || []))
      .catch(err => console.error("Failed to load categories", err));
    api.get("/categories/usage")
      .then(res => setFrequentCategories((res.data || []).map(x => x.name)))
      .catch(() => setFrequentCategories([]));
  }, []);

  const handleRowClick = (id) => {
    setSelectedMerchantId(id);
    setLoadingDetails(true);
    setTxFilterName('ALL');

    api.get(`/merchants/${id}${accountQuery}`)
      .then(res => {
        setMerchantDetails(res.data);
        setLoadingDetails(false);
      })
      .catch(err => {
        console.error(err);
        setLoadingDetails(false);
      });
  };

  useEffect(() => {
    setLoading(true);
    fetchMerchants()
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
    // Merge selection and any open drawer are scoped to the previous account —
    // the selected merchant id won't belong to the newly chosen account, so
    // reset both rather than refetching a merchant from the old scope.
    setSelectedIds([]);
    closeSidebar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountQuery]);

  const toggleSelection = (id, e) => {
    e.stopPropagation();
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleMergeSubmit = () => {
    if (!primaryMergeId) return alert("Select a primary merchant");
    const secondaryIds = selectedIds.filter(id => id !== parseInt(primaryMergeId));

    api.post('/merchants/merge', {
      primaryId: parseInt(primaryMergeId),
      secondaryIds
    }).then(() => {
      fetchMerchants().then(() => {
        setSelectedIds([]);
        setShowMergeModal(false);
      });
    }).catch(err => {
      console.error(err);
      alert("Failed to merge merchants.");
    });
  };

  const handleUnmerge = (alias) => {
    if (!window.confirm(`Are you sure you want to unmerge "${alias}"? This will create a new merchant and attempt to restore its transactions.`)) return;

    api.post('/merchants/unmerge', {
      primaryId: merchantDetails.id,
      aliasName: alias
    }).then(() => {
      // Refresh main table
      fetchMerchants();
      // Refresh sidebar details
      handleRowClick(merchantDetails.id);
      setTxFilterName('ALL');
    }).catch(err => {
      console.error(err);
      alert("Failed to unmerge merchant.");
    });
  };

  const closeSidebar = () => {
    setSelectedMerchantId(null);
    setMerchantDetails(null);
    setIsEditing(false);
    setTxFilterName('ALL');
  };

  const handleEditClick = () => {
    setEditForm({
      friendlyName: merchantDetails.friendlyName || '',
      notes: merchantDetails.notes || '',
      category: merchantDetails.category || '',
      subCategory: merchantDetails.subCategory || '',
      shiftToNextMonth: merchantDetails.shiftToNextMonth || false
    });
    setIsEditing(true);
  };

  // Sentinel option values for the "+ Add new…" entries in the edit dropdowns.
  const NEW_CATEGORY = '__new_category__';
  const NEW_SUBCATEGORY = '__new_subcategory__';

  const handleAddCategory = () => {
    const name = window.prompt('New category name')?.trim();
    if (!name) return;
    const existing = categoriesList.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setEditForm(prev => ({ ...prev, category: existing.name, subCategory: '' }));
      return;
    }
    api.post('/categories', { name })
      .then(res => {
        setCategoriesList(prev => [...prev, { id: res.data.id, name: res.data.name, subCategories: [] }]);
        setEditForm(prev => ({ ...prev, category: res.data.name, subCategory: '' }));
      })
      .catch(err => {
        console.error('Failed to create category', err);
        alert('Failed to create category.');
      });
  };

  const handleAddSubCategory = () => {
    const category = categoriesList.find(c => c.name === editForm.category);
    if (!category) return;
    const name = window.prompt(`New sub-category under "${category.name}"`)?.trim();
    if (!name) return;
    const existing = category.subCategories?.find(s => s.toLowerCase() === name.toLowerCase());
    if (existing) {
      setEditForm(prev => ({ ...prev, subCategory: existing }));
      return;
    }
    api.post(`/categories/${category.id}/subcategories`, { name })
      .then(() => {
        setCategoriesList(prev => prev.map(c =>
          c.id === category.id ? { ...c, subCategories: [...(c.subCategories || []), name] } : c
        ));
        setEditForm(prev => ({ ...prev, subCategory: name }));
      })
      .catch(err => {
        console.error('Failed to create sub-category', err);
        alert('Failed to create sub-category.');
      });
  };

  // The picker's value is a subCategory when set, else a category — split it back
  // into the {category, subCategory} pair the API stores.
  const resolveCategory = (selectedValue) => {
    if (!selectedValue) return { category: '', subCategory: '' };
    for (const cat of categoriesList) {
      if (cat.subCategories?.includes(selectedValue))
        return { category: cat.name, subCategory: selectedValue };
    }
    return { category: selectedValue, subCategory: '' };
  };

  // Inline categorization from the list rows (same UX as the Transactions page).
  const applyMerchantCategory = (merchant, selectedValue) => {
    const { category, subCategory } = resolveCategory(selectedValue);
    const previous = { category: merchant.category, subCategory: merchant.subCategory };
    const patch = (m) => ({ ...m, category, subCategory });
    setData(prev => prev.map(m => m.id === merchant.id ? patch(m) : m));
    if (merchantDetails?.id === merchant.id) setMerchantDetails(patch);

    api.put(`/merchants/${merchant.id}`, {
      category,
      subCategory,
      shiftToNextMonth: merchant.shiftToNextMonth || false,
    }).catch(err => {
      console.error("Failed to update category", err);
      alert("Failed to update category. Please try again.");
      const revert = (m) => ({ ...m, ...previous });
      setData(prev => prev.map(m => m.id === merchant.id ? revert(m) : m));
      if (merchantDetails?.id === merchant.id) setMerchantDetails(revert);
    });
  };

  // Inline "Create category" from the row picker: reuse an existing match if
  // one exists, otherwise persist the new top-level category, then assign it.
  const handleCreateRowCategory = (merchant, name) => {
    const existing = categoriesList.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      applyMerchantCategory(merchant, existing.name);
      return;
    }
    api.post('/categories', { name })
      .then(res => {
        setCategoriesList(prev => [...prev, { id: res.data.id, name: res.data.name, subCategories: [] }]);
        applyMerchantCategory(merchant, res.data.name);
      })
      .catch(err => {
        console.error('Failed to create category', err);
        alert('Failed to create category.');
      });
  };

  // Bulk categorization: apply one category to every checked merchant in a single
  // request. Optimistic like the row picker, but the rollback has to restore each
  // merchant's own previous value rather than a single pair.
  const applyBulkCategory = (selectedValue) => {
    const ids = selectedIds;
    if (ids.length === 0 || bulkSaving) return;
    const { category, subCategory } = resolveCategory(selectedValue);
    const idSet = new Set(ids);
    const previous = new Map(
      data.filter(m => idSet.has(m.id)).map(m => [m.id, { category: m.category, subCategory: m.subCategory }])
    );

    const patch = (m) => ({ ...m, category, subCategory });
    setData(prev => prev.map(m => idSet.has(m.id) ? patch(m) : m));
    if (merchantDetails && idSet.has(merchantDetails.id)) setMerchantDetails(patch);

    setBulkSaving(true);
    api.post('/merchants/bulk-category', { ids, category, subCategory })
      .then(() => setSelectedIds([]))
      .catch(err => {
        console.error('Failed to update categories', err);
        alert('Failed to update categories. Please try again.');
        const revert = (m) => previous.has(m.id) ? { ...m, ...previous.get(m.id) } : m;
        setData(prev => prev.map(revert));
        if (merchantDetails && previous.has(merchantDetails.id)) setMerchantDetails(revert);
      })
      .finally(() => setBulkSaving(false));
  };

  // Inline "Create category" from the bulk picker — mirrors handleCreateRowCategory.
  const handleCreateBulkCategory = (name) => {
    const existing = categoriesList.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      applyBulkCategory(existing.name);
      return;
    }
    api.post('/categories', { name })
      .then(res => {
        setCategoriesList(prev => [...prev, { id: res.data.id, name: res.data.name, subCategories: [] }]);
        applyBulkCategory(res.data.name);
      })
      .catch(err => {
        console.error('Failed to create category', err);
        alert('Failed to create category.');
      });
  };

  const handleSaveClick = () => {
    // Blank boxes mean "no value" — mirror the server's own normalization locally so the
    // list and drawer don't briefly show '' where the DB now holds null.
    const payload = {
      ...editForm,
      friendlyName: editForm.friendlyName.trim() || null,
      notes: editForm.notes.trim() || null,
    };
    api.put(`/merchants/${merchantDetails.id}`, payload)
      .then(() => {
        setMerchantDetails({ ...merchantDetails, ...payload });
        setIsEditing(false);
        // Update the main list so changes reflect immediately in the table
        setData(prevData => prevData.map(merchant =>
          merchant.id === merchantDetails.id ? { ...merchant, ...payload } : merchant
        ));
      })
      .catch(err => {
        console.error("Failed to update merchant", err);
        alert("Failed to save changes. Please try again.");
      });
  };

  // ── Merchant deep-dive: spend-over-time + headline stats, from loaded txns ──
  // Declared before the early return so hook order stays stable across renders.
  const spendStats = useMemo(() => {
    const txs = merchantDetails?.transactions || [];
    const debits = txs.filter((t) => (t.debit ?? 0) > 0);
    const totalSpent = debits.reduce((sum, t) => sum + (t.debit || 0), 0);
    const count = debits.length;
    const avg = count ? totalSpent / count : 0;

    const times = txs.map((t) => new Date(t.transactionDate).getTime()).filter((n) => !isNaN(n));
    const first = times.length ? new Date(Math.min(...times)) : null;
    const last = times.length ? new Date(Math.max(...times)) : null;

    const byMonth = {};
    debits.forEach((t) => {
      const d = new Date(t.transactionDate);
      if (isNaN(d)) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      byMonth[key] = (byMonth[key] || 0) + (t.debit || 0);
    });
    const monthly = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([k, v]) => {
        const [y, m] = k.split("-");
        return {
          month: new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
          total: v,
        };
      });
    return { totalSpent, count, avg, first, last, monthly };
  }, [merchantDetails]);

  // ── Auto-suggested merges: group merchants whose names normalize to the same
  // key (case/whitespace/punctuation-insensitive). Also folds a merchant into a
  // group when its name matches another merchant's alias or friendly name.
  const mergeSuggestions = useMemo(() => {
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const groups = new Map();
    data.forEach(m => {
      // A merchant can be reachable by its raw name or its friendly name —
      // group on whichever keys it exposes so renamed rows still cluster.
      const keys = new Set([norm(m.name), norm(m.friendlyName)].filter(Boolean));
      keys.forEach(key => {
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key).add(m);
      });
    });
    return [...groups.entries()]
      .filter(([, set]) => set.size > 1)
      .map(([key, set]) => {
        // Default primary: prefer a categorized merchant, then most transactions.
        const members = [...set].sort((a, b) =>
          (b.category ? 1 : 0) - (a.category ? 1 : 0) ||
          (b.transactionCount ?? 0) - (a.transactionCount ?? 0) ||
          a.id - b.id);
        return { key, members, defaultPrimaryId: members[0].id };
      })
      .sort((a, b) => b.members.length - a.members.length);
  }, [data]);

  const mergeSuggestionGroup = (group) => {
    const primaryId = suggestPrimary[group.key] ?? group.defaultPrimaryId;
    const secondaryIds = group.members.map(m => m.id).filter(id => id !== primaryId);
    setMergingKey(group.key);
    return api.post('/merchants/merge', { primaryId, secondaryIds })
      .then(() => fetchMerchants())
      .catch(err => {
        console.error(err);
        alert('Failed to merge merchants.');
      })
      .finally(() => setMergingKey(null));
  };

  const mergeAllSuggestions = async () => {
    setMergingKey('__all__');
    try {
      // A merchant can sit in two groups (matched by name in one, friendly name
      // in another); once merged away it must not anchor or join a later group.
      const consumed = new Set();
      for (const group of mergeSuggestions) {
        const remaining = group.members.filter(m => !consumed.has(m.id));
        if (remaining.length < 2) continue;
        const chosen = suggestPrimary[group.key] ?? group.defaultPrimaryId;
        const primaryId = consumed.has(chosen) ? remaining[0].id : chosen;
        const secondaryIds = remaining.map(m => m.id).filter(id => id !== primaryId);
        await api.post('/merchants/merge', { primaryId, secondaryIds });
        secondaryIds.forEach(id => consumed.add(id));
      }
      await fetchMerchants();
      setShowSuggestModal(false);
    } catch (err) {
      console.error(err);
      alert('Failed to merge some groups.');
      await fetchMerchants();
    } finally {
      setMergingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <div className="loader-text">Loading merchants...</div>
      </div>
    );
  }

  const term = searchQuery.toLowerCase();
  const filteredData = data.filter(merchant => {
    if (uncategorizedOnly && merchant.category) return false;
    return merchant.friendlyName?.toLowerCase().includes(term) ||
           merchant.name?.toLowerCase().includes(term) ||
           merchant.category?.toLowerCase().includes(term) ||
           merchant.upiIds?.some(upi => upi?.toLowerCase().includes(term)) ||
           merchant.aliases?.some(alias => alias?.toLowerCase().includes(term));
  });

  if (spentSort) {
    const dir = spentSort === 'desc' ? -1 : 1;
    filteredData.sort((a, b) => ((a.totalSpent ?? 0) - (b.totalSpent ?? 0)) * dir);
  }

  const categorizedCount = data.filter(m => m.category).length;
  const linkedCount = data.filter(m => (m.aliases?.length || 0) > 0).length;

  const displayedTxs = merchantDetails?.transactions?.filter(tx => {
    if (txFilterName === 'ALL') return true;

    // Assign the transaction to the longest name appearing in its text, so an alias
    // that is a substring of the primary name (or of another alias) can't claim
    // every transaction. Text matching no name defaults to the primary.
    const hay = `${tx.description || ''} ${tx.upiReference || ''}`.toLowerCase();
    let owner = null;
    for (const name of [merchantDetails.name, ...(merchantDetails.aliases || [])]) {
      const term = (name || '').trim().toLowerCase();
      if (term && hay.includes(term) && (!owner || term.length > owner.length)) owner = term;
    }

    const selected = txFilterName.trim().toLowerCase();
    if (selected === (merchantDetails.name || '').trim().toLowerCase()) {
      return owner === null || owner === selected;
    }
    return owner === selected;
  }) || [];

  const allSelected = filteredData.length > 0 && selectedIds.length === filteredData.length;

  const fmtShort = (v) =>
    isAmountMasked() ? MASKED_AMOUNT :
    v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${Math.round(v)}`;
  const fmtMY = (d) => (d ? d.toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "—");

  return (
    <div style={{ marginRight: selectedMerchantId ? sidebarWidth : 0, transition: 'margin-right 0.2s ease' }}>
      <style>{`
        .mrc-row {
          display: grid;
          grid-template-columns: ${isAdmin ? '28px ' : ''}minmax(0,1fr) 150px 100px 96px 88px 20px;
          align-items: center;
          gap: 16px;
          padding: 14px 20px;
          border-bottom: 1px solid ${T.borderSub};
          cursor: pointer;
          transition: background 0.12s;
        }
        .mrc-row:hover { background: ${T.bg}; }
        .mrc-row.selected { background: ${T.indigoDim}; }
        .mrc-row:last-child { border-bottom: none; }
        .mrc-chevron { color: ${T.faint}; opacity: 0; transition: opacity 0.12s, transform 0.12s; }
        .mrc-row:hover .mrc-chevron { opacity: 1; transform: translateX(2px); }
        .mrc-head {
          display: grid;
          grid-template-columns: ${isAdmin ? '28px ' : ''}minmax(0,1fr) 150px 100px 96px 88px 20px;
          gap: 16px;
          padding: 12px 20px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: ${T.faint};
          border-bottom: 1px solid ${T.border};
          background: ${T.bg};
        }
        .mrc-sort {
          display: inline-flex; align-items: center; gap: 4px;
          background: none; border: none; padding: 0; cursor: pointer;
          font: inherit; color: inherit; letter-spacing: inherit;
          text-transform: inherit; margin-left: auto;
        }
        .mrc-sort:hover { color: ${T.text}; }
        .mrc-sort.active { color: ${T.indigo}; }
        .mrc-chip {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 11px; font-weight: 600; color: ${T.muted};
          background: ${T.bg}; border: 1px solid ${T.border};
          padding: 2px 8px; border-radius: 999px;
        }
        .mrc-search {
          width: 100%; padding: 10px 14px 10px 38px;
          border: 1px solid ${T.border}; border-radius: 10px;
          font-size: 14px; font-family: inherit; background: ${T.surface};
          color: ${T.text}; outline: none; transition: border-color 0.15s, box-shadow 0.15s;
        }
        .mrc-search:focus { border-color: ${T.indigo}; box-shadow: 0 0 0 3px ${T.indigoDim}; }
        .mrc-cat-select {
          width: 100%; max-width: 100%;
          padding: 5px 8px; font-size: 12px; font-weight: 600;
          border: 1px solid ${T.border}; border-radius: 8px;
          background: ${T.surface}; font-family: inherit;
          outline: none; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s;
        }
        .mrc-cat-select:focus { border-color: ${T.indigo}; box-shadow: 0 0 0 3px ${T.indigoDim}; }
        @media (max-width: 720px) {
          .mrc-row, .mrc-head { grid-template-columns: ${isAdmin ? '28px ' : ''}minmax(0,1fr) 88px 20px; }
          /* Spend survives the squeeze — it's the column worth scanning on a phone. */
          .mrc-col-cat, .mrc-col-meta, .mrc-col-count { display: none; }
        }
      `}</style>

      {/* ── Selection actions: bulk categorize + merge (title/subtitle come from
           the shared PageHeader). Categorizing works on one row too; merging
           needs at least two. ── */}
      {isAdmin && selectedIds.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
          marginBottom: '16px', padding: '10px 14px',
          background: T.indigoDim, border: `1px solid ${T.border}`, borderRadius: '12px',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: T.text }}>
            {selectedIds.length} selected
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: T.muted }}>Set category</span>
          <div style={{ width: '210px' }}>
            <CategoryPicker
              value=""
              placeholder={bulkSaving ? 'Applying…' : 'Choose category…'}
              categories={categoriesList}
              frequentCategories={frequentCategories}
              onChange={applyBulkCategory}
              onCreate={handleCreateBulkCategory}
              disabled={bulkSaving}
              size="sm"
            />
          </div>
          {selectedIds.length > 1 && (
            <button
              className="btn primary"
              onClick={() => { setShowMergeModal(true); setPrimaryMergeId(String(selectedIds[0])); }}
            >
              Merge selected ({selectedIds.length})
            </button>
          )}
          <button className="btn" onClick={() => setSelectedIds([])}>Clear</button>
        </div>
      )}

      {/* ── Summary strip ── */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { label: 'Total merchants', value: data.length, accent: T.indigo },
          { label: 'Categorized', value: `${categorizedCount} / ${data.length}`, accent: T.green },
          { label: 'Merged groups', value: linkedCount, accent: T.faint },
        ].map((stat) => (
          <div key={stat.label} style={{
            flex: '1 1 160px', background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: '14px', padding: '16px 18px', boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {stat.label}
            </div>
            <div className="tnum" style={{ marginTop: '6px', fontSize: '22px', fontWeight: 800, color: stat.accent, letterSpacing: '-0.5px' }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Search + quick filters ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '0 1 340px' }}>
          <span style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: T.faint, fontSize: '15px', pointerEvents: 'none' }}>
            🔍
          </span>
          <input
            type="text"
            placeholder="Search name, category, UPI…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="mrc-search"
          />
        </div>
        <Button
          variant={uncategorizedOnly ? 'primary' : 'secondary'}
          onClick={() => setUncategorizedOnly(v => !v)}
          title="Show only merchants without a category"
          style={{ fontSize: 'var(--text-sm)' }}
        >
          <FiFilter size={14} /> Uncategorized
        </Button>
        {isAdmin && mergeSuggestions.length > 0 && (
          <Button
            variant="secondary"
            onClick={() => { setSuggestPrimary({}); setShowSuggestModal(true); }}
            title="Merchants that look like duplicates of each other"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            ✨ {mergeSuggestions.length} suggested merge{mergeSuggestions.length > 1 ? 's' : ''}
          </Button>
        )}
      </div>

      {/* ── List ── */}
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: '14px', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
      }}>
        <div className="mrc-head">
          {isAdmin && (
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => setSelectedIds(e.target.checked ? filteredData.map(c => c.id) : [])}
              style={{ cursor: 'pointer' }}
            />
          )}
          <span>Merchant</span>
          <span className="mrc-col-cat">Category</span>
          <span className="mrc-col-meta">Identifiers</span>
          <span className="mrc-col-count" style={{ textAlign: 'right' }}>Transactions</span>
          <span style={{ display: 'flex' }}>
            <button
              type="button"
              className={`mrc-sort${spentSort ? ' active' : ''}`}
              onClick={() => setSpentSort(s => (s === null ? 'desc' : s === 'desc' ? 'asc' : null))}
              title="Sort by amount spent"
            >
              Spent {spentSort === 'desc' ? '▾' : spentSort === 'asc' ? '▴' : '⇅'}
            </button>
          </span>
          <span />
        </div>

        <div style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
          {filteredData.length === 0 ? (
            <EmptyState
              icon="🏬"
              title={data.length === 0 ? "No merchants yet" : "No matches"}
              message={
                data.length === 0 ? "Upload a statement and merchants will appear here."
                : uncategorizedOnly ? "No uncategorized merchants match the current filters."
                : "No merchants match your search."
              }
            />
          ) : (
            filteredData.map(merchant => {
              const display = maskName(merchant.friendlyName || merchant.name) || "-";
              const hasOriginal = merchant.friendlyName && merchant.name !== merchant.friendlyName;
              const upiCount = merchant.upiIds?.length || 0;
              const aliasCount = merchant.aliases?.length || 0;
              const spent = merchant.totalSpent ?? 0;
              const [, catFg] = avatarColors(merchant.category || '');
              return (
                <div
                  key={merchant.id}
                  className={`mrc-row${selectedMerchantId === merchant.id ? ' selected' : ''}`}
                  onClick={() => handleRowClick(merchant.id)}
                >
                  {isAdmin && (
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(merchant.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggleSelection(merchant.id, e)}
                      style={{ cursor: 'pointer' }}
                    />
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <Avatar name={display} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: '14px', fontWeight: 700, color: T.text,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {display}
                      </div>
                      <div style={{
                        fontSize: '12px', color: T.faint, marginTop: '1px',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {hasOriginal ? maskName(merchant.name) : (upiCount > 0 ? maskName(merchant.upiIds[0]) : 'No UPI on record')}
                      </div>
                    </div>
                  </div>

                  <div className="mrc-col-cat" onClick={(e) => e.stopPropagation()}>
                    {isAdmin ? (
                      <CategoryPicker
                        value={merchant.subCategory || merchant.category || ''}
                        categories={categoriesList}
                        frequentCategories={frequentCategories}
                        onChange={(val) => applyMerchantCategory(merchant, val)}
                        onCreate={(name) => handleCreateRowCategory(merchant, name)}
                        size="sm"
                      />
                    ) : merchant.category ? (
                      <span style={{
                        display: 'inline-block', maxWidth: '100%',
                        fontSize: '12px', fontWeight: 600, color: catFg,
                        background: avatarColors(merchant.category)[0],
                        padding: '3px 10px', borderRadius: '999px',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {merchant.category}
                      </span>
                    ) : (
                      <span style={{ color: T.faint, fontSize: '13px' }}>Uncategorized</span>
                    )}
                  </div>

                  <div className="mrc-col-meta" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {upiCount > 0 && <span className="mrc-chip">🆔 {upiCount}</span>}
                    {aliasCount > 0 && <span className="mrc-chip">🔗 {aliasCount}</span>}
                    {upiCount === 0 && aliasCount === 0 && <span style={{ color: T.faint, fontSize: '13px' }}>—</span>}
                  </div>

                  <div className="mrc-col-count tnum" style={{ textAlign: 'right', fontSize: '14px', fontWeight: 700, color: T.text }}>
                    {(merchant.transactionCount ?? 0).toLocaleString('en-IN')}
                  </div>

                  <div
                    className="tnum"
                    style={{ textAlign: 'right', fontSize: '14px', fontWeight: 700, color: spent > 0 ? T.text : T.faint }}
                    title={spent > 0 && !isAmountMasked() ? currencyFormatter.format(spent) : undefined}
                  >
                    {spent > 0 ? fmtShort(spent) : '—'}
                  </div>

                  <span className="mrc-chevron">›</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Merge Modal */}
      <Modal
        open={showMergeModal}
        onClose={() => setShowMergeModal(false)}
        title="Merge merchants"
        width={420}
        footer={
          <>
            <button className="btn" onClick={() => setShowMergeModal(false)}>Cancel</button>
            <button className="btn primary" onClick={handleMergeSubmit}>Confirm merge</button>
          </>
        }
      >
        <p style={{ color: T.muted, fontSize: '13px', margin: '0 0 20px' }}>
          Pick the primary merchant to keep. The other {selectedIds.length - 1} will be folded into it and removed.
        </p>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '13px', color: T.text }}>Primary merchant</label>
        <select
          value={primaryMergeId}
          onChange={e => setPrimaryMergeId(e.target.value)}
          className="field-select"
        >
          {selectedIds.map(id => {
            const merchant = data.find(x => x.id === id);
            return <option key={id} value={id}>{merchant?.friendlyName || merchant?.name}</option>;
          })}
        </select>
      </Modal>

      {/* Suggested merges modal — duplicate groups with one-click merge */}
      <Modal
        open={showSuggestModal}
        onClose={() => setShowSuggestModal(false)}
        title="Suggested merges"
        width={560}
        footer={
          <>
            <button className="btn" onClick={() => setShowSuggestModal(false)}>Close</button>
            {mergeSuggestions.length > 1 && (
              <button
                className="btn primary"
                disabled={mergingKey !== null}
                onClick={mergeAllSuggestions}
              >
                {mergingKey === '__all__' ? 'Merging…' : `Merge all (${mergeSuggestions.length} groups)`}
              </button>
            )}
          </>
        }
      >
        {mergeSuggestions.length === 0 ? (
          <p style={{ color: T.muted, fontSize: '13px', margin: 0 }}>
            No duplicate merchants detected. 🎉
          </p>
        ) : (
          <>
            <p style={{ color: T.muted, fontSize: '13px', margin: '0 0 16px' }}>
              These merchants have matching names and look like duplicates. Pick which one
              to keep in each group — the rest fold into it as aliases (you can unmerge later).
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '55vh', overflowY: 'auto', paddingRight: '4px' }}>
              {mergeSuggestions.map(group => {
                const primaryId = suggestPrimary[group.key] ?? group.defaultPrimaryId;
                return (
                  <div key={group.key} style={{ border: `1px solid ${T.border}`, borderRadius: '12px', overflow: 'hidden', flexShrink: 0 }}>
                    {group.members.map((m, idx) => (
                      <label
                        key={m.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '10px 14px', cursor: 'pointer',
                          borderTop: idx > 0 ? `1px solid ${T.borderSub}` : 'none',
                          background: m.id === primaryId ? T.indigoDim : 'transparent',
                        }}
                      >
                        <input
                          type="radio"
                          name={`suggest-${group.key}`}
                          checked={m.id === primaryId}
                          onChange={() => setSuggestPrimary(prev => ({ ...prev, [group.key]: m.id }))}
                          style={{ cursor: 'pointer' }}
                        />
                        <Avatar name={maskName(m.friendlyName || m.name)} size={28} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {maskName(m.friendlyName || m.name)}
                            {m.id === primaryId && (
                              <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, color: T.indigo, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                keep
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: T.faint, marginTop: '1px' }}>
                            {m.category || 'Uncategorized'} · {(m.transactionCount ?? 0).toLocaleString('en-IN')} txn{(m.transactionCount ?? 0) === 1 ? '' : 's'}
                          </div>
                        </div>
                      </label>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', borderTop: `1px solid ${T.borderSub}`, background: T.bg }}>
                      <button
                        className="btn small primary"
                        disabled={mergingKey !== null}
                        onClick={() => mergeSuggestionGroup(group)}
                      >
                        {mergingKey === group.key ? 'Merging…' : `Merge ${group.members.length} into one`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Modal>

      {/* RHS detail drawer — non-modal so the list & sidebar stay interactive */}
      <Drawer
        open={!!selectedMerchantId}
        onClose={closeSidebar}
        title="Merchant Details"
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        modal={false}
      >
        {loadingDetails ? (
          <div style={{ textAlign: 'center', color: T.muted, marginTop: '40px' }}>Loading details...</div>
        ) : merchantDetails ? (
          <div>
            {/* Identity header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '24px' }}>
              <Avatar name={maskName(merchantDetails.friendlyName || merchantDetails.name)} size={52} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {isEditing ? (
                  <>
                    {/* Shown unmasked: you can't meaningfully edit a masked value, and this
                        is admin-only. The bank's raw name stays visible underneath as the
                        reference for what's being renamed. */}
                    <input
                      type="text"
                      value={editForm.friendlyName}
                      onChange={(e) => setEditForm({ ...editForm, friendlyName: e.target.value })}
                      placeholder={merchantDetails.name}
                      className="mrc-search"
                      style={{ padding: '7px 10px', fontSize: '16px', fontWeight: 700 }}
                      autoFocus
                    />
                    <p style={{ margin: '6px 0 0', color: T.faint, fontSize: '12px' }}>
                      From statement: {merchantDetails.name}
                    </p>
                  </>
                ) : (
                  <>
                    <h3 style={{ margin: '0 0 2px 0', fontSize: '19px', color: T.text, letterSpacing: '-0.02em' }}>
                      {maskName(merchantDetails.friendlyName || merchantDetails.name)}
                    </h3>
                    <p style={{ margin: 0, color: T.muted, fontSize: '13px' }}>
                      {merchantDetails.friendlyName && merchantDetails.name !== merchantDetails.friendlyName
                        ? maskName(merchantDetails.name)
                        : 'Original name matches'}
                    </p>
                  </>
                )}
              </div>
              {isAdmin && (!isEditing ? (
                <button className="btn small" onClick={handleEditClick}>Edit</button>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn small" onClick={() => setIsEditing(false)}>Cancel</button>
                  <button className="btn primary small" onClick={handleSaveClick}>Save</button>
                </div>
              ))}
            </div>

            {/* Detail fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '24px' }}>
              <Field label="Category">
                {isEditing ? (
                  <select
                    value={editForm.category}
                    onChange={(e) => {
                      if (e.target.value === NEW_CATEGORY) { handleAddCategory(); return; }
                      setEditForm({ ...editForm, category: e.target.value, subCategory: '' });
                    }}
                    className="field-select"
                    style={{ marginTop: '2px' }}
                  >
                    <option value="">-- None --</option>
                    {categoriesList.map(cat => (
                      <option key={cat.id} value={cat.name}>{cat.name}</option>
                    ))}
                    <option value={NEW_CATEGORY}>＋ Add new category…</option>
                  </select>
                ) : (merchantDetails.category || <span style={{ color: T.faint }}>—</span>)}
              </Field>
              <Field label="Sub-Category">
                {isEditing ? (
                  <select
                    value={editForm.subCategory}
                    onChange={(e) => {
                      if (e.target.value === NEW_SUBCATEGORY) { handleAddSubCategory(); return; }
                      setEditForm({ ...editForm, subCategory: e.target.value });
                    }}
                    className="field-select"
                    style={{ marginTop: '2px' }}
                    disabled={!categoriesList.some(c => c.name === editForm.category)}
                  >
                    <option value="">-- None --</option>
                    {categoriesList.find(c => c.name === editForm.category)?.subCategories?.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                    <option value={NEW_SUBCATEGORY}>＋ Add new sub-category…</option>
                  </select>
                ) : (merchantDetails.subCategory || <span style={{ color: T.faint }}>—</span>)}
              </Field>
              <Field label="Bank Code">
                {merchantDetails.bankCode || <span style={{ color: T.faint }}>—</span>}
              </Field>
              <Field label="Count toward next month">
                {isEditing ? (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '4px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editForm.shiftToNextMonth}
                      onChange={(e) => setEditForm({ ...editForm, shiftToNextMonth: e.target.checked })}
                      style={{ marginTop: '2px' }}
                    />
                    <span style={{ fontSize: '12px', color: T.muted }}>
                      Transactions on/after the 25th count in the following month (e.g. salary credited Jun 30 counts as July)
                    </span>
                  </label>
                ) : (merchantDetails.shiftToNextMonth ? 'Yes' : <span style={{ color: T.faint }}>—</span>)}
              </Field>
            </div>

            {/* Notes — free-text, admin-editable */}
            {(isEditing || merchantDetails.notes) && (
              <div style={{ marginBottom: '22px' }}>
                <div style={{ fontSize: '11px', color: T.faint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>Notes</div>
                {isEditing ? (
                  <textarea
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    placeholder="Anything worth remembering about this merchant…"
                    rows={3}
                    maxLength={500}
                    className="mrc-search"
                    style={{ padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }}
                  />
                ) : (
                  <div style={{ fontSize: '13px', color: T.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {merchantDetails.notes}
                  </div>
                )}
              </div>
            )}

            {/* UPI IDs */}
            <div style={{ marginBottom: '22px' }}>
              <div style={{ fontSize: '11px', color: T.faint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>UPI IDs</div>
              {merchantDetails.upiIds?.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {merchantDetails.upiIds.map((upi, idx) => (
                    <span key={`${upi}-${idx}`} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px', color: T.text, background: T.bg, padding: '5px 10px', borderRadius: '8px', border: `1px solid ${T.border}` }}>
                      {upi}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ color: T.faint, fontSize: '13px' }}>None on record</div>
              )}
            </div>

            {/* Aliases */}
            <div style={{ marginBottom: '4px' }}>
              <div style={{ fontSize: '11px', color: T.faint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>Merged names (aliases)</div>
              {merchantDetails.aliases?.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {merchantDetails.aliases.map((alias, idx) => (
                    <span key={`${alias}-${idx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', backgroundColor: T.surface, color: T.muted, padding: '5px 10px', fontSize: '12px', fontWeight: 500, borderRadius: '8px', border: `1px dashed ${T.border}` }}>
                      {alias}
                      {isAdmin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnmerge(alias); }}
                          style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', padding: 0, fontWeight: 'bold', lineHeight: 1, fontSize: '15px', display: 'flex', alignItems: 'center' }}
                          title="Unmerge"
                        >
                          &times;
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ color: T.faint, fontSize: '13px' }}>None</div>
              )}
            </div>

            <hr style={{ border: '0', borderTop: `1px solid ${T.border}`, margin: '24px 0' }} />

            {/* ── Spend deep-dive ── */}
            {spendStats.count > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700, color: T.text }}>Spending trend</h4>

                {/* Headline stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '16px' }}>
                  {[
                    { label: 'Total spent', value: currencyFormatter.format(spendStats.totalSpent), color: T.red },
                    { label: 'Payments', value: spendStats.count.toLocaleString('en-IN'), color: T.text },
                    { label: 'Avg / payment', value: currencyFormatter.format(Math.round(spendStats.avg)), color: T.text },
                    { label: 'Active since', value: fmtMY(spendStats.first), color: T.text },
                  ].map((st) => (
                    <div key={st.label} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: '10px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{st.label}</div>
                      <div className="tnum" style={{ marginTop: '3px', fontSize: '15px', fontWeight: 800, color: st.color, letterSpacing: '-0.3px' }}>{st.value}</div>
                    </div>
                  ))}
                </div>

                {/* Monthly spend chart */}
                {spendStats.monthly.length > 1 ? (
                  <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: '10px', padding: '14px 12px 6px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: T.muted, marginBottom: '8px', paddingLeft: '4px' }}>
                      Monthly spend · last {spendStats.monthly.length} months
                    </div>
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={spendStats.monthly} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="merchantSpendFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={chartC.bar} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={chartC.bar} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartC.grid} />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: chartC.tick }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tickFormatter={fmtShort} tick={{ fontSize: 10, fill: chartC.tick }} axisLine={false} tickLine={false} width={44} />
                        <Tooltip
                          formatter={(v) => currencyFormatter.format(v)}
                          cursor={{ stroke: chartC.grid, strokeWidth: 1 }}
                          contentStyle={{ borderRadius: '10px', border: `1px solid ${chartC.tooltipBorder}`, background: chartC.tooltipBg, color: chartC.tooltipText, boxShadow: 'var(--shadow-lg)', fontSize: '12px' }}
                          labelStyle={{ color: chartC.tooltipText }}
                          itemStyle={{ color: chartC.tooltipText }}
                        />
                        <Area
                          type="monotone" dataKey="total" name="Spend"
                          stroke={chartC.bar} strokeWidth={2} fill="url(#merchantSpendFill)"
                          dot={false} activeDot={{ r: 4, strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: T.faint }}>Not enough history yet for a monthly trend.</div>
                )}
              </div>
            )}

            {/* Transactions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: T.text }}>Recent Transactions ({displayedTxs.length})</h4>
              {merchantDetails.aliases?.length > 0 && (
                <select
                  value={txFilterName}
                  onChange={(e) => setTxFilterName(e.target.value)}
                  style={{ padding: '5px 10px', borderRadius: '8px', border: `1px solid ${T.border}`, fontSize: '13px', background: T.surface, color: T.text, outline: 'none' }}
                >
                  <option value="ALL">All names</option>
                  <option value={merchantDetails.name}>{merchantDetails.name}</option>
                  {merchantDetails.aliases.map(alias => (
                    <option key={alias} value={alias}>{alias}</option>
                  ))}
                </select>
              )}
            </div>

            {displayedTxs.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
                {displayedTxs.map((tx, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: idx < displayedTxs.length - 1 ? `1px solid ${T.borderSub}` : 'none' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: T.text }}>
                        {new Date(tx.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                      <div style={{ fontSize: '12px', color: T.muted, marginTop: '2px' }}>{tx.mode || 'Transfer'}</div>
                    </div>
                    <div className="tnum" style={{ fontSize: '14px', fontWeight: 700, color: tx.credit ? T.green : T.red }}>
                      {tx.credit ? '+' : '−'}{currencyFormatter.format(Math.max(tx.credit, tx.debit))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: T.faint, fontSize: '13px' }}>No matching transactions found for "{txFilterName}".</p>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: T.red }}>Failed to load details.</div>
        )}
      </Drawer>
    </div>
  );
}
