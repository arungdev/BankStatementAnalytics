import { useState } from 'react';
import { FiSearch, FiUsers, FiChevronRight, FiChevronDown, FiPlus, FiUserPlus, FiTrash2, FiDownload } from 'react-icons/fi';
import { currencyFormatter, maskName, formatDate } from '../utils/format';
import { getGroupDisplayMembers, isImportedGPayGroup } from '../utils/groupMembers';
import { usePrivacy } from '../context/usePrivacy';

export default function GPayGroupList({ groups, profiles = [], onOpen, onExpense, onAddSplit, onAddMember, onDelete }) {
  usePrivacy();
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const [expanded, setExpanded] = useState(new Set());
  const query = search.trim().toLowerCase();
  const filtered = groups.filter(group => {
    const imported = isImportedGPayGroup(group);
    const searchable = [group.name, ...getGroupDisplayMembers(group).map(m => m.name), ...(group.splits || []).map(s => s.title)].join(' ').toLowerCase();
    return (!query || searchable.includes(query)) && (source === 'all' || (source === 'imported' ? imported : !imported));
  });
  const toggle = id => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <div className="gpay-group-list">
    <div className="gpay-list-toolbar">
      <label className="gpay-group-search"><FiSearch /><input aria-label="Search groups, members or expenses" placeholder="Search groups, members or expenses…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <select aria-label="Group source" value={source} onChange={event => setSource(event.target.value)}><option value="all">All groups</option><option value="imported">GPay imports</option><option value="custom">Custom groups</option></select>
      <span className="gpay-list-count">{filtered.length} of {groups.length} groups</span>
    </div>
    {filtered.length === 0 && <div className="gpay-list-empty"><FiSearch /><h3>No matching groups</h3><p>Try another name or change the source filter.</p><button className="btn btn--outline" onClick={() => { setSearch(''); setSource('all'); }}>Clear filters</button></div>}
    {filtered.map(group => {
      const imported = isImportedGPayGroup(group), members = getGroupDisplayMembers(group), splits = group.splits || [], open = expanded.has(group.id);
      const lastDate = splits.map(s => s.date).filter(Boolean).sort().at(-1) || group.createdOn;
      return <article className="gpay-list-card" key={group.id}>
        <header className="gpay-list-card-header">
          <div className="gpay-list-icon"><FiUsers size={21} /></div>
          <div className="gpay-list-card-heading"><div className="gpay-list-kicker"><span className={`gpay-source-tag ${imported ? 'is-imported' : ''}`}>{imported ? <FiDownload size={11} /> : <FiUsers size={11} />}{imported ? 'GPay import' : 'Custom group'}</span><span>Latest activity {formatDate(lastDate)}</span></div>
            <button className="gpay-group-name" onClick={() => onOpen(group)}>{maskName(group.name)}<FiChevronRight size={17} /></button>
            <p>{members.length} {members.length === 1 ? (imported ? 'observed participant' : 'member') : (imported ? 'observed participants' : 'members')}<span>·</span>{splits.length} {splits.length === 1 ? 'expense' : 'expenses'}{imported && profiles.length > 1 && <><span>·</span>{maskName(profiles.find(profile => profile.id === (group.gPayProfileId || 'default'))?.name || 'GPay profile')}</>}</p>
          </div>
          <button className="btn btn--outline gpay-view-group" onClick={() => onOpen(group)}>View group <FiChevronRight size={14} /></button>
        </header>
        <dl className="gpay-list-metrics">
          <div><dt>Total expenses</dt><dd>{currencyFormatter.format(group.totalExpenseVolume || 0)}</dd></div>
          <div><dt>Your share</dt><dd>{currencyFormatter.format(group.userShareVolume || 0)}</dd></div>
          <div><dt>Recorded repayments</dt><dd>{currencyFormatter.format(group.settledVolume || 0)}</dd></div>
          <div className="split-money-collect"><dt>To collect</dt><dd>{currencyFormatter.format(group.netOwedToUser || 0)}</dd></div>
          <div className="split-money-owe"><dt>You owe</dt><dd>{currencyFormatter.format(group.netOwedByUser || 0)}</dd></div>
        </dl>
        <footer className="gpay-list-card-footer">
          <button className="gpay-expand-expenses" onClick={() => toggle(group.id)} aria-expanded={open} aria-controls={`group-expenses-${group.id}`}><FiChevronDown className={open ? 'is-open' : ''} />{open ? 'Hide expenses' : 'Show expenses'}<span>{splits.length}</span></button>
          {!imported && <div className="gpay-custom-actions"><button className="btn btn--outline" onClick={() => onAddSplit(group)}><FiPlus /> Add Split</button><button className="btn btn--outline" onClick={() => onAddMember(group)}><FiUserPlus /> Add Member</button><button className="btn btn--outline" onClick={() => onDelete(group.id)} aria-label={`Delete ${maskName(group.name)}`}><FiTrash2 /></button></div>}
        </footer>
        {open && <div className="gpay-list-expenses" id={`group-expenses-${group.id}`}>
          {splits.length === 0 && <p>No expenses recorded yet.</p>}
          {splits.map(split => <button className="gpay-expense-row" key={split.id} onClick={() => onExpense(split)}><span><strong>{maskName(split.title)}</strong><small>{formatDate(split.date)}</small></span><span className="gpay-expense-row-amount">{currencyFormatter.format(split.totalAmount)}<small>Your share {currencyFormatter.format(split.userShareAmount)}</small></span><FiChevronRight /></button>)}
        </div>}
      </article>;
    })}
  </div>;
}
