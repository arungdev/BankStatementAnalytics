import { browserStorage } from '../utils/browserStorage.js';
import { useState } from 'react';
import { Modal, useAuth } from '@common/client';
import useAuthenticationOptions from '../hooks/useAuthenticationOptions';
import api from '../api/client';
import { updateGPayProfilePreferences } from '../api/splits';
import { apiErrorMessage } from '../utils/apiError';
import { maskName } from '../utils/format';
import ConfirmDialog from './ConfirmDialog';
import { gpayPreferenceKey } from '../utils/gpayPreferences';
import './GPayProfileSettings.css';

export default function GPayProfileSettings({ config, accounts, canEdit, busy, onConfig, insights, children }) {
  const { isAdmin } = useAuth();
  const authenticationOptions = useAuthenticationOptions();
  const canManageFolders = isAdmin && !authenticationOptions.loading && !authenticationOptions.unavailable && !authenticationOptions.publicHosting;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ name: '', userName: '', watchFolderPath: '', bankAccountIds: [] });
  const load = async profileId => {
    setSaving(true); setError('');
    try { onConfig((await api.get('/split-groups/auto-import', { params: { profileId } })).data); }
    catch (e) { setError(apiErrorMessage(e, 'Unable to load the GPay profile.')); }
    finally { setSaving(false); }
  };
  const create = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      onConfig((await api.post('/split-groups/gpay-profiles', { ...draft, watchFolderPath: canManageFolders ? draft.watchFolderPath : null })).data);
      setOpen(false); setDraft({ name: '', userName: '', watchFolderPath: '', bankAccountIds: [] });
    } catch (e) { setError(apiErrorMessage(e, 'Unable to add the GPay profile.')); }
    finally { setSaving(false); }
  };
  const updateBanks = async bankAccountIds => {
    setSaving(true); setError('');
    try { onConfig((await updateGPayProfilePreferences({ bankAccountIds }, config?.profileId)).data); }
    catch (e) { setError(apiErrorMessage(e, 'Unable to save the bank accounts.')); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!config?.profileId || busy || saving) return;
    setSaving(true); setError('');
    try {
      const response = await api.delete(`/split-groups/gpay-profiles/${encodeURIComponent(config.profileId)}`);
      for (const name of ['split_filter', 'only_link_created_by_me'])
        browserStorage.removeItem(gpayPreferenceKey(name, config.profileId));
      onConfig(response.data);
    } catch (e) { setError(apiErrorMessage(e, 'Unable to delete the GPay profile.')); }
    finally { setSaving(false); setDeleting(false); }
  };
  const bankChoices = (ids, change) => <fieldset className="gpay-profile-banks"><legend>Bank accounts and cards linked to this GPay profile</legend><p>Select the accounts or cards used for GPay UPI. A selection lets matching use these accounts even when GPay shows a different account suffix. Automatic links still require one unique transaction by amount, direction and date.</p>{accounts.map(account => <label key={account.id}><input type="checkbox" checked={ids.includes(account.id)} disabled={busy || saving} onChange={event => change(event.target.checked ? [...ids, account.id] : ids.filter(id => id !== account.id))} />{maskName(account.bankName || account.bankType || account.name || 'Bank')} · ••••{account.accountNumber?.slice(-4) || account.id}</label>)}</fieldset>;
  return <div className="gpay-profile-settings">
    <div className="gpay-profile-toolbar"><label>GPay profile<select value={config?.profileId || 'default'} disabled={!config || busy || saving} onChange={event => load(event.target.value)}>{(config?.profiles || [{ id: 'default', name: 'Primary GPay' }]).map(profile => <option key={profile.id} value={profile.id}>{maskName(profile.name)}</option>)}</select></label>{canEdit && <button type="button" className="btn small" disabled={busy || saving} onClick={() => { setError(''); setOpen(true); }}>+ Add GPay profile</button>}</div>
    <p className="account-panel-hint">Separate Google/GPay profiles keep their export files, groups and split identities separate.</p>
    {error && <p role="alert" className="gpay-profile-error">{error}</p>}
    <section className="gpay-profile-panel" aria-labelledby="gpay-profile-heading" aria-busy={saving}>
      <div className="gpay-profile-heading">
        <h4 id="gpay-profile-heading">{maskName(config?.profileName || 'Primary GPay')}</h4>
        {canEdit && config?.profileId && <button type="button" className="btn small danger" disabled={busy || saving} onClick={() => setDeleting(true)}>Delete profile</button>}
      </div>
      <p className="account-panel-hint">Account links, auto-import and preferences below apply to this profile.</p>
      <div inert={saving || undefined}>{insights}</div>
      <fieldset className="gpay-profile-controls" disabled={!config || busy || saving}>
        <legend className="gpay-profile-controls-legend">Settings for {maskName(config?.profileName || 'Primary GPay')}</legend>
        {config && canEdit && bankChoices(config.bankAccountIds || [], updateBanks)}
        {children}
      </fieldset>
    </section>
    <ConfirmDialog open={deleting} title="Delete GPay profile?" message={`Delete “${maskName(config?.profileName || '')}” and its settings? Only empty profiles can be deleted.\n\nProfiles with imported records are protected. Your bank accounts and credit cards are kept.`} confirmLabel="Delete profile" danger busy={saving} onConfirm={remove} onCancel={() => setDeleting(false)} />
    <Modal open={open} onClose={() => { if (!saving) setOpen(false); }} title="Add GPay profile">
      <form className="gpay-profile-form" onSubmit={create}>
        <label>Profile label<input autoFocus required minLength={2} maxLength={100} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="Personal or second Google account" /></label>
        <label>Your exact name in this GPay profile<input required minLength={2} maxLength={250} value={draft.userName} onChange={event => setDraft({ ...draft, userName: event.target.value })} /></label>
        {canManageFolders && <label>Separate Takeout export folder<input value={draft.watchFolderPath} onChange={event => setDraft({ ...draft, watchFolderPath: event.target.value })} placeholder="D:\BankStatements\GpaySecond" /></label>}
        <p>{canManageFolders ? 'Use a separate folder for each profile.' : 'Select this profile when uploading its Takeout export.'} Existing imports stay in Primary GPay.</p>
        {bankChoices(draft.bankAccountIds, bankAccountIds => setDraft({ ...draft, bankAccountIds }))}
        {error && <p role="alert" className="gpay-profile-error">{error}</p>}
        <div className="gpay-profile-toolbar"><button type="button" className="btn small" disabled={saving} onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="btn primary small" disabled={saving}>{saving ? 'Saving…' : 'Add profile'}</button></div>
      </form>
    </Modal>
  </div>;
}
