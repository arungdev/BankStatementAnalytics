import { useState } from 'react';
import { Modal } from '@common/client';
import api from '../api/client';
import { maskName } from '../utils/format';
import './GPayProfileSettings.css';

export default function GPayProfileSettings({ config, accounts, canEdit, busy, onConfig }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ name: '', userName: '', watchFolderPath: '', bankAccountIds: [] });
  const load = async profileId => {
    setSaving(true); setError('');
    try { onConfig((await api.get('/split-groups/auto-import', { params: { profileId } })).data); }
    catch (e) { setError(e.response?.data?.message || 'Unable to load the GPay profile.'); }
    finally { setSaving(false); }
  };
  const create = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      onConfig((await api.post('/split-groups/gpay-profiles', draft)).data);
      setOpen(false); setDraft({ name: '', userName: '', watchFolderPath: '', bankAccountIds: [] });
    } catch (e) { setError(e.response?.data?.message || 'Unable to add the GPay profile.'); }
    finally { setSaving(false); }
  };
  const updateBanks = async bankAccountIds => {
    setSaving(true); setError('');
    try { onConfig((await api.put('/split-groups/auto-import', { bankAccountIds }, { params: { profileId: config?.profileId } })).data); }
    catch (e) { setError(e.response?.data?.message || 'Unable to save the bank accounts.'); }
    finally { setSaving(false); }
  };
  const bankChoices = (ids, change) => <fieldset className="gpay-profile-banks"><legend>Bank accounts used by this profile</legend><p>Leave all unchecked to search your imported accounts. Automatic links still require a unique match.</p>{accounts.map(account => <label key={account.id}><input type="checkbox" checked={ids.includes(account.id)} disabled={busy || saving} onChange={event => change(event.target.checked ? [...ids, account.id] : ids.filter(id => id !== account.id))} />{maskName(account.bankName || account.bankType || account.name || 'Bank')} · ••••{account.accountNumber?.slice(-4) || account.id}</label>)}</fieldset>;
  return <div className="gpay-profile-settings">
    <div className="gpay-profile-toolbar"><label>GPay profile<select value={config?.profileId || 'default'} disabled={!config || busy || saving} onChange={event => load(event.target.value)}>{(config?.profiles || [{ id: 'default', name: 'Primary GPay' }]).map(profile => <option key={profile.id} value={profile.id}>{maskName(profile.name)}</option>)}</select></label>{canEdit && <button type="button" className="btn small" disabled={busy || saving} onClick={() => { setError(''); setOpen(true); }}>+ Add GPay profile</button>}</div>
    <p className="account-panel-hint">Separate Google/GPay profiles keep their export files, groups and split identities separate.</p>
    {error && <p role="alert" className="gpay-profile-error">{error}</p>}
    {config?.profileId && canEdit && bankChoices(config.bankAccountIds || [], updateBanks)}
    <Modal open={open} onClose={() => { if (!saving) setOpen(false); }} title="Add GPay profile">
      <form className="gpay-profile-form" onSubmit={create}>
        <label>Profile label<input autoFocus required minLength={2} maxLength={100} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="Personal or second Google account" /></label>
        <label>Your exact name in this GPay profile<input required minLength={2} maxLength={250} value={draft.userName} onChange={event => setDraft({ ...draft, userName: event.target.value })} /></label>
        <label>Separate Takeout export folder<input value={draft.watchFolderPath} onChange={event => setDraft({ ...draft, watchFolderPath: event.target.value })} placeholder="D:\BankStatements\GpaySecond" /></label>
        <p>Use a separate folder for each profile. Existing imports stay in Primary GPay.</p>
        {bankChoices(draft.bankAccountIds, bankAccountIds => setDraft({ ...draft, bankAccountIds }))}
        {error && <p role="alert" className="gpay-profile-error">{error}</p>}
        <div className="gpay-profile-toolbar"><button type="button" className="btn small" disabled={saving} onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="btn primary small" disabled={saving}>{saving ? 'Saving…' : 'Add profile'}</button></div>
      </form>
    </Modal>
  </div>;
}
