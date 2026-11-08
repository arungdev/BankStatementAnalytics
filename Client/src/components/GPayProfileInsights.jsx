import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Drawer } from '@common/client';
import { FiArrowLeft, FiCheckCircle, FiChevronRight, FiClock, FiGift, FiLink, FiRefreshCw, FiSearch, FiUsers, FiXCircle } from 'react-icons/fi';
import api from '../api/client';
import useAsyncResource from '../hooks/useAsyncResource';
import usePagePreference from '../hooks/usePagePreference';
import { preferenceValidators } from '../utils/viewPreferences';
import Pagination from './Pagination';
import { currencyFormatterFull, maskName } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';
import './GPayProfileInsights.css';

const root = '/split-groups/gpay-profiles';
const date = value => value ? new Date(/Z$|[+-]\d{2}:\d{2}$/i.test(value) ? value : `${value}Z`).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—';
const message = error => error?.response?.data?.message || error?.message || 'Unable to load details.';
const titles = { groups: 'Groups', splits: 'Splits', bankMatches: 'Split bank matches', upi: 'Linked GPay payments', cashback: 'Cashback', vouchers: 'Active coupons' };
const icons = { groups: FiUsers, splits: FiUsers, bankMatches: FiLink, upi: FiLink, cashback: FiGift, vouchers: FiGift };

export default function GPayProfileInsights({ config, syncing, onPanelWidthChange }) {
  const { maskAmounts } = usePrivacy();
  const profileId = config?.profileId || 'default';
  const [historyPage, setHistoryPage] = useState(0);
  const [selection, setSelection] = useState(null);
  const [detailPage, setDetailPage] = useState(0);
  const [activeRow, setActiveRow] = useState(null);
  const searchScope = `gpay-insights-${profileId}-${selection?.section || selection?.type || 'details'}`;
  const [search, setSearch] = usePagePreference(searchScope, 'search', '', { scope: 'workspace' });
  const [query, setQuery] = useState(search);
  const [previousSearchScope, setPreviousSearchScope] = useState(searchScope);
  if (previousSearchScope !== searchScope) { setPreviousSearchScope(searchScope); setQuery(search); setDetailPage(0); }
  const [sidebarWidth, setSidebarWidth] = usePagePreference('gpay-insights', 'drawerWidth', 480, { scope: 'workspace', validate: preferenceValidators.width });
  const [historySize, setHistorySize] = usePagePreference(`gpay-${profileId}`, 'historyPageSize', 10, { scope: 'workspace', validate: preferenceValidators.pageSize });
  const [detailSize, setDetailSize] = usePagePreference(`gpay-${profileId}-${selection?.section || selection?.type || 'details'}`, 'detailPageSize', 50, { scope: 'workspace', validate: preferenceValidators.pageSize });
  const list = useRef(null), rowIndex = useRef(0);
  const historyList = useRef(null), historyRowId = useRef(null);
  const trigger = useRef(null), back = useRef(null);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const panelWidth = Math.min(sidebarWidth, viewport);
  useEffect(() => {
    onPanelWidthChange?.(selection && viewport > 1024 ? panelWidth : 0);
  }, [selection, viewport, panelWidth, onPanelWidthChange]);
  useEffect(() => () => onPanelWidthChange?.(0), [onPanelWidthChange]);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setDetailPage(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const loadHistory = useCallback(async signal => (await api.get(`${root}/sync-history`, { params: { profileId, page: historyPage, pageSize: historySize }, signal })).data, [profileId, historyPage, historySize]);
  const history = useAsyncResource(loadHistory, { runs: [], total: 0 });
  const reloadHistory = history.retry;
  useEffect(() => { reloadHistory(); }, [syncing, config?.lastSyncUtc, reloadHistory]);
  useEffect(() => {
    const interval = setInterval(reloadHistory, 15000);
    return () => clearInterval(interval);
  }, [reloadHistory]);
  const loadDetails = useCallback(async signal => {
    void syncing; // Refresh open details when a sync starts or completes.
    if (!selection || selection.type === 'history') return null;
    const url = selection.type === 'sync' ? `${root}/sync-history/${selection.id}` : `${root}/details`;
    return (await api.get(url, { params: { profileId, section: selection.section, page: detailPage, pageSize: detailSize, search: query || undefined }, signal })).data;
  }, [selection, profileId, detailPage, detailSize, syncing, query]);
  const details = useAsyncResource(loadDetails, null);
  const reloadDetails = details.retry;
  useEffect(() => {
    if (details.data?.run?.status !== 'Running') return;
    const interval = setInterval(reloadDetails, 5000);
    return () => clearInterval(interval);
  }, [details.data?.run?.status, reloadDetails]);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const close = useCallback(() => { setSelection(null); setActiveRow(null); trigger.current?.focus(); }, []);
  useEffect(() => {
    if (!selection) return;
    back.current?.focus();
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab' && viewport <= 1024) {
        const drawer = back.current?.closest('.ui-drawer');
        const controls = [...(drawer?.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') || [])];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [selection, close, viewport]);
  useEffect(() => { if (activeRow) back.current?.focus(); }, [activeRow]);
  const open = (event, next) => { trigger.current = event.currentTarget; setDetailPage(0); setActiveRow(null); setSelection(next); };
  const text = value => maskAmounts ? 'Hidden in privacy mode' : maskName(String(value || ''));
  const metrics = [
    ['groups', config?.totalGroups || 0, 'Groups'], ['splits', config?.totalSplits || 0, 'Splits'],
    ['bankMatches', config?.bankMatches || 0, 'Bank matches'], ['upi', config?.upiActivitiesEnriched || 0, 'UPI enriched'],
    ['cashback', currencyFormatterFull.format(config?.cashbackTotalEarned || 0), 'Cashback'], ['vouchers', config?.activeVouchersCount || 0, 'Active coupons'],
  ];
  const isHistory = selection?.type === 'history';
  const run = selection?.type === 'sync' ? details.data?.run : null;
  const rows = selection?.type === 'sync' ? run?.changes || [] : details.data?.records || [];
  const isSync = selection?.type === 'sync';
  const CollectionIcon = isHistory ? FiClock : isSync ? FiRefreshCw : icons[selection?.section] || FiUsers;
  const collectionTitle = isHistory ? 'Sync history' : isSync ? 'Sync details' : titles[selection?.section] || 'Profile details';
  const StatusIcon = run?.status === 'Success' ? FiCheckCircle : run?.status === 'Failed' ? FiXCircle : FiClock;
  const rowName = row => maskName(row.title || row.description || row.kind || 'GPay record');
  const backToList = () => { setActiveRow(null); requestAnimationFrame(() => list.current?.querySelectorAll('button')[rowIndex.current]?.focus()); };
  const backToHistory = () => {
    setSelection({ type: 'history' }); setDetailPage(0);
    requestAnimationFrame(() => historyList.current?.querySelector(`[data-sync-id="${historyRowId.current}"]`)?.focus());
  };
  return <>
    <div className="gpay-summary gpay-insight-tiles" aria-label="Google Pay import summary">{metrics.map(([section, value, label]) => <button key={section} type="button" aria-pressed={selection?.section === section} aria-label={`View ${label} for ${maskName(config?.profileName || 'Primary GPay')}`} onClick={event => open(event, { type: 'metric', section })}><strong>{value}</strong><span>{label} <span aria-hidden="true">›</span></span></button>)}</div>
    <button type="button" className="gpay-history-entry" aria-expanded={isHistory || isSync} onClick={event => open(event, { type: 'history' })}>
      <span className="gpay-history-entry-icon"><FiClock size={20} /></span><span><strong>View sync history</strong><small>{history.hasLoaded && !history.error ? `${history.data.total} sync runs · Results and changes for this profile` : 'Results and changes for this profile'}</small></span><FiChevronRight size={18} />
    </button>
    <Drawer open={!!selection} onClose={close} title={activeRow ? 'Record details' : collectionTitle} width={panelWidth} minWidth={360} onWidthChange={viewport > 1024 ? width => setSidebarWidth(Math.min(760, Math.max(360, width))) : undefined} modal={viewport <= 1024}>
      <section className="gpay-profile-detail-panel" aria-label="GPay profile details" role={viewport <= 1024 ? 'dialog' : 'region'} aria-modal={viewport <= 1024 || undefined}>
        <button ref={back} type="button" className="gpay-insight-back" onClick={activeRow ? backToList : isSync && selection?.fromHistory ? backToHistory : close}><FiArrowLeft />{activeRow ? `Back to ${collectionTitle.toLowerCase()}` : isSync && selection?.fromHistory ? 'Back to sync history' : 'Back to settings'}</button>
        {isHistory ? <>
          <div className="gpay-collection-header"><span className="gpay-collection-icon"><FiClock size={22} /></span><div><h3>Sync history</h3><span>{maskName(config?.profileName || 'Primary GPay')} · {history.data.total} sync runs</span></div></div>
          <div className="gpay-history-toolbar"><span>Select a sync to see its changes.</span><button type="button" className="btn small" onClick={reloadHistory} disabled={history.loading}><FiRefreshCw size={13} className={history.loading ? 'spin' : ''} /> Refresh</button></div>
          {history.error && <div className="gpay-insight-empty" role="alert"><FiXCircle size={28} /><h4>Couldn’t load sync history</h4><p>{message(history.error)}</p><button type="button" className="btn small" onClick={reloadHistory}>Retry</button></div>}
          {history.loading && !history.hasLoaded && <div className="gpay-insight-loading" role="status"><FiRefreshCw className="spin" size={18} /> Loading sync history…</div>}
          {history.hasLoaded && !history.error && !history.data.runs.length && <div className="gpay-insight-empty"><FiClock size={30} /><h4>No sync history yet</h4><p>Future syncs for this profile will appear here with their results and changes.</p></div>}
          <div ref={historyList} className="gpay-history-panel-list">{history.hasLoaded && !history.error && history.data.runs.map(item => <button type="button" key={item.id} data-sync-id={item.id} className="gpay-sync-history-row" onClick={() => { historyRowId.current = item.id; setDetailPage(0); setSelection({ type: 'sync', id: item.id, fromHistory: true }); }}>
            <span><strong>{date(item.startedUtc)}</strong><small>{item.trigger}</small><small className="gpay-history-file">{text(item.fileName || 'Folder check')}</small><small>{item.added} added · {item.updated} updated · {item.bankLinks} linked</small></span><span className={`gpay-sync-status is-${item.status.toLowerCase()}`}>{item.status}</span><FiChevronRight size={16} />
          </button>)}</div>
          <Pagination currentPage={(history.data.page ?? historyPage) + 1} totalPages={Math.max(1, Math.ceil(history.data.total / historySize))} itemsPerPage={historySize} currentCount={history.data.runs.length} totalCount={history.data.total} startIndex={(history.data.page ?? historyPage) * historySize} itemLabel="sync runs" loading={history.loading} onPageChange={page => setHistoryPage(page - 1)} onItemsPerPageChange={size => { setHistorySize(size); setHistoryPage(0); }} />
        </> : activeRow ? <>
          <div className="gpay-record-hero"><Avatar name={rowName(activeRow)} size={52} />
            {activeRow.amount != null && <strong className={`gpay-record-amount${selection?.section === 'cashback' ? ' is-credit' : ''}`}>{currencyFormatterFull.format(activeRow.amount)}</strong>}
            <h3>{rowName(activeRow)}</h3><span>{maskName(config?.profileName || 'Primary GPay')}</span>
            <span className="gpay-record-badge">{activeRow.action || activeRow.status}</span>
          </div>
          <dl className="gpay-record-fields"><div><dt>{isSync ? 'Record type' : 'Section'}</dt><dd>{activeRow.kind || collectionTitle}</dd></div><div><dt>Status</dt><dd>{activeRow.action || activeRow.status}</dd></div><div className="is-wide"><dt>{selection?.section === 'vouchers' ? 'Expires' : 'Date and time'}</dt><dd>{date(activeRow.date || run?.completedUtc || run?.startedUtc)}</dd></div>{activeRow.members && <div><dt>Members</dt><dd>{activeRow.members.length}</dd></div>}</dl>
          {!!activeRow.members?.length && <section className="gpay-record-section"><h4>Group members</h4><ul className="gpay-record-members">{activeRow.members.map((member, index) => <li key={index}><Avatar name={maskName(member)} size={32} /><span>{maskName(member)}</span></li>)}</ul></section>}
          {activeRow.detail && !activeRow.members && <section className="gpay-record-section"><h4>Details</h4><p>{text(activeRow.detail)}</p></section>}
        </> : <>
          <div className="gpay-collection-header"><span className="gpay-collection-icon"><CollectionIcon size={22} /></span><div><h3>{collectionTitle}</h3><span>{maskName(config?.profileName || 'Primary GPay')} {!details.loading && !details.error && !isSync && `· ${details.data?.total || 0} records`}</span></div></div>
          {!isSync && <label className="gpay-insight-search"><FiSearch size={16} /><input type="search" value={search} maxLength={200} placeholder={`Search ${collectionTitle.toLowerCase()}…`} aria-label={`Search ${collectionTitle.toLowerCase()}`} onChange={event => setSearch(event.target.value)} /></label>}
          {details.loading && <div className="gpay-insight-loading" role="status"><FiRefreshCw className="spin" size={18} /> Loading details…</div>}
          {details.error && <div className="gpay-insight-empty" role="alert"><FiXCircle size={28} /><h4>Couldn’t load details</h4><p>{message(details.error)}</p><button type="button" className="btn small" onClick={reloadDetails}>Retry</button></div>}
          {!details.loading && !details.error && <>
            {run && <>
              <div className={`gpay-sync-result is-${run.status.toLowerCase()}`}><StatusIcon size={20} /><div><strong>{run.status}</strong><span>{date(run.startedUtc)}</span></div></div>
              <div className="gpay-sync-counts">{[['Added', run.added], ['Updated', run.updated], ['Linked', run.bankLinks], ['Unchanged', run.unchanged]].map(([label, count]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
              <dl className="gpay-record-fields"><div><dt>Sync type</dt><dd>{run.trigger}</dd></div><div><dt>Completed</dt><dd>{date(run.completedUtc)}</dd></div><div className="is-wide"><dt>Source file</dt><dd>{text(run.fileName || 'Folder check')}</dd></div></dl>
              <p className="gpay-sync-message">{text(run.message)}</p>
              {!!run.warnings?.length && <details className="gpay-import-notes"><summary>Import notes ({run.warnings.length})</summary><ul>{run.warnings.map((warning, index) => <li key={index}>{text(warning)}</li>)}</ul></details>}
              {!!rows.length && <h4 className="gpay-record-section-title">Changes in this sync <span>{details.data.total}</span></h4>}
            </>}
            {!rows.length && <div className="gpay-insight-empty"><CollectionIcon size={30} /><h4>{query ? 'No matching records' : run?.status === 'Running' ? 'Sync in progress' : 'Nothing to show yet'}</h4><p>{query ? 'Try a different name or reference.' : run?.status === 'Running' ? 'Changes appear here after they commit.' : run ? 'No changes were recorded in this sync.' : 'Records for this profile will appear here.'}</p></div>}
            <div ref={list} className="gpay-insight-list">{rows.map((row, index) => <button type="button" className="gpay-insight-row" key={`${detailPage}-${index}`} onClick={() => { rowIndex.current = index; setActiveRow(row); }} aria-label={`View details for ${rowName(row)}`}>
              <Avatar name={rowName(row)} size={38} /><span className="gpay-insight-row-main"><strong>{rowName(row)}</strong><small>{row.action ? `${row.action} · ${row.kind}` : row.date ? date(row.date) : row.status}</small>{!isSync && <span>{row.members ? `${row.members.length} members` : text(row.detail || row.status)}</span>}</span><span className="gpay-insight-row-end">{row.amount != null && <strong>{currencyFormatterFull.format(row.amount)}</strong>}<FiChevronRight size={16} /></span>
            </button>)}</div>
            <Pagination currentPage={(details.data?.page ?? detailPage) + 1} totalPages={Math.max(1, Math.ceil((details.data?.total || 0) / detailSize))} itemsPerPage={detailSize} currentCount={rows.length} totalCount={details.data?.total || 0} startIndex={(details.data?.page ?? detailPage) * detailSize} itemLabel="records" loading={details.loading} onPageChange={page => setDetailPage(page - 1)} onItemsPerPageChange={size => { setDetailSize(size); setDetailPage(0); }} />
          </>}
        </>}
      </section>
    </Drawer>
  </>;
}
