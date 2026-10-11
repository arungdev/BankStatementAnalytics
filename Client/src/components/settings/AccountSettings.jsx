import AccountStatementActions from "./AccountStatementActions";
import { FiCreditCard, FiEdit2, FiChevronUp, FiChevronDown, FiFolder, FiEyeOff, FiEye, FiDownloadCloud, FiRefreshCw, FiCheckCircle, FiUserCheck } from "react-icons/fi";
import { formatDate, currencyFormatterFull } from "../../utils/format";
import { Badge, Switch } from "@common/client";
import GPayProfileSettings from "../../components/GPayProfileSettings";

export default function AccountSettings({ accounts, autoDraft, autoDrafts, autoOpen, browse, cardAccounts, cardDraft, cardDrafts, editAccountName, editingAccountId, gpayAutoOpen, gpayConfig, gpayDraftPath, gpayMessage, gpaySweeping, gpayUserName, handleDeleteAccount, handleImportNow, handleOpenNamePicker, handleSaveAutoImport, handleSaveCardSettings, handleSaveGPayAutoImport, handleSaveGPayUserName, handleSweepGPay, handleToggleAutoImport, handleToggleGPayAutoImport, handleUpdateAccount, isAdmin, loadBrowse, onlyLinkCreatedByMe, openBrowse, openBrowseGPay, setAutoDraft, setAutoOpen, setBrowse, setCardDraft, setCardDrafts, setEditAccountName, setEditingAccountId, setGpayAutoOpen, setGpayConfig, setGpayDraftPath, setGpayMessage, setGpayUserName, setOnlyLinkCreatedByMe, setParticipantList, setShowPw, setSplitDisplayFilter, showPw, splitDisplayFilter, sweeping }) {
  return (accounts.length === 0 ? (
      <div className="settings-empty">
        <FiCreditCard size={36} />
        <div className="settings-empty-title">No accounts yet</div>
        <div className="settings-empty-sub">
          {isAdmin ? 'Click “Add account” to link your first bank account.' : 'No accounts have been added.'}
        </div>
      </div>
    ) : (
      <div className="settings-stack" id="set-accounts-list">
        {accounts.map((acc, i) => (
          <section key={acc.id} className="setting-card account-card">
            <div className="setting-card-head">
              <div className="account-identity">
                <div className="settings-avatar">
                  {(acc.bankName || acc.accountHolderName || '?').charAt(0)}
                </div>
                <div style={{ minWidth: 0 }}>
                  {editingAccountId === acc.id ? (
                    <input
                      type="text"
                      value={editAccountName}
                      onChange={(e) => setEditAccountName(e.target.value.slice(0, 50))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdateAccount(acc.id);
                        if (e.key === 'Escape') { e.stopPropagation(); setEditingAccountId(null); }
                      }}
                      maxLength={50}
                      autoFocus
                      className="field-input"
                      aria-label="Account name"
                    />
                  ) : (
                    <h3 className="setting-card-title">{acc.accountHolderName || acc.bankName}</h3>
                  )}
                  <p className="setting-card-desc">
                    {acc.bankName} •••• {acc.accountNumber?.slice(-4) || '****'}
                    {acc.lastTransaction && <> · last txn {formatDate(acc.lastTransaction.date)}</>}
                  </p>
                </div>
              </div>

              {acc.balance != null && (
                <div className="account-balance">
                  <span className="account-balance-label">{acc.balanceLabel || 'Balance'}</span>
                  <span className="account-balance-value">{currencyFormatterFull.format(acc.balance)}</span>
                </div>
              )}

              {isAdmin && (
                <div className="setting-card-control">
                  {editingAccountId === acc.id ? (
                    <>
                      <button className="btn primary small" onClick={() => handleUpdateAccount(acc.id)}>Save</button>
                      <button className="btn small" onClick={() => setEditingAccountId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn small"
                        onClick={() => { setEditingAccountId(acc.id); setEditAccountName(acc.accountHolderName || ''); }}
                      >
                        <FiEdit2 size={13} /> Rename
                      </button>
                      <button className="btn danger small" onClick={() => handleDeleteAccount(acc.id)}>Delete</button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Credit-card-only metadata: usually auto-filled from the PDF
                statement; editable here as the manual fallback. */}
            {acc.bankName === 'HDFCCreditCard' && isAdmin && (() => {
              const dependentCards = cardAccounts.filter(a => a.sharedLimitAccountId === acc.id);
              const parentCard = cardAccounts.find(a => a.id === acc.sharedLimitAccountId);
              const isPrimary = dependentCards.length > 0;
              const sharedGroupLimit = acc.creditLimit || parentCard?.creditLimit || dependentCards.find(d => d.creditLimit)?.creditLimit;
              const sharedGroupDay = acc.statementDay || parentCard?.statementDay || dependentCards.find(d => d.statementDay)?.statementDay;

              return (
                <div className="account-panel" id={acc.id === cardAccounts[0]?.id ? 'set-card-details' : undefined}>
                  <div className="account-panel-head">
                    <div style={{ minWidth: 0 }}>
                      <h4 className="account-panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span>Card details</span>
                        {isPrimary && (
                          <Badge variant="blue">
                            Primary limit (Shared with {dependentCards.map(d => `•••• ${d.accountNumber?.slice(-4) || d.id}`).join(', ')})
                          </Badge>
                        )}
                        {parentCard && (
                          <Badge variant="purple">
                            Shares limit with •••• {parentCard.accountNumber?.slice(-4) || parentCard.id}
                          </Badge>
                        )}
                      </h4>
                      <span className="account-panel-hint">
                        {isPrimary
                          ? `This card holds the primary credit limit shared with ${dependentCards.map(d => `•••• ${d.accountNumber?.slice(-4) || d.id}`).join(', ')}.`
                          : parentCard
                          ? `This card shares the credit limit of primary card •••• ${parentCard.accountNumber?.slice(-4) || parentCard.id}.`
                          : 'Used for utilization and billing cycles'}
                      </span>
                    </div>
                  </div>
                  <div className="settings-field-grid" style={{ marginTop: 'var(--space-4)' }}>
                    <label className="settings-field sm">
                      <span className="settings-field-label">Credit limit (₹)</span>
                      <input
                        type="number"
                        min="0"
                        placeholder={sharedGroupLimit && !cardDraft(acc).creditLimit ? `Shared: ${sharedGroupLimit}` : "e.g. 100000"}
                        value={cardDraft(acc).creditLimit}
                        onChange={(e) => setCardDraft(acc.id, { creditLimit: e.target.value })}
                        className="field-input"
                      />
                    </label>
                    <label className="settings-field sm">
                      <span className="settings-field-label">Statement day (1–31)</span>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        placeholder={sharedGroupDay && !cardDraft(acc).statementDay ? `Shared: ${sharedGroupDay}` : "e.g. 23"}
                        value={cardDraft(acc).statementDay}
                        onChange={(e) => setCardDraft(acc.id, { statementDay: e.target.value })}
                        className="field-input"
                      />
                    </label>
                    {/* HDFC add-on/second cards draw on the primary card's limit;
                        linking them makes utilization count both cards together. */}
                    {cardAccounts.some(a => a.id !== acc.id) && (
                      <label className="settings-field lg">
                        <span className="settings-field-label">Shares limit with</span>
                        <select
                          value={cardDraft(acc).sharedLimitAccountId}
                          onChange={(e) => setCardDraft(acc.id, { sharedLimitAccountId: e.target.value })}
                          className="field-input"
                          disabled={isPrimary}
                          title={isPrimary ? "Other cards share this card's limit — unlink them first to change." : undefined}
                        >
                          <option value="">
                            {isPrimary
                              ? `Primary card (shared by ${dependentCards.map(d => `•••• ${d.accountNumber?.slice(-4) || d.id}`).join(', ')})`
                              : "None (own limit)"}
                          </option>
                          {cardAccounts.filter(a => a.id !== acc.id).map(a => (
                            <option key={a.id} value={a.id}>
                              •••• {a.accountNumber?.slice(-4) || a.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {cardDrafts[acc.id] && (
                    <div className="account-panel-actions">
                      <button className="btn primary small" onClick={() => handleSaveCardSettings(acc)}>
                        Save card details
                      </button>
                      <button
                        className="btn small"
                        onClick={() => setCardDrafts(prev => { const n = { ...prev }; delete n[acc.id]; return n; })}
                      >
                        Discard
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            <AccountStatementActions account={acc} />

            {/* Auto-import: a folder the backend sweeps ~once a minute,
                importing new statement files like a manual upload. The switch
                stays visible when collapsed so its state is always readable. */}
            {isAdmin && (
              <div className="account-panel" id={i === 0 ? 'set-auto-import' : undefined}>
                <div className="account-panel-head">
                  <div style={{ minWidth: 0 }}>
                    <h4 className="account-panel-title">
                      Auto-import
                      {acc.watchFolderPath && (acc.watchEnabled
                        ? <Badge variant="green">On</Badge>
                        : <Badge variant="amber">Paused</Badge>)}
                    </h4>
                    <span className="account-panel-hint">
                      {acc.watchFolderPath
                        ? acc.watchFolderPath
                        : 'Drop statements in a folder and they import themselves'}
                    </span>
                  </div>
                  <div className="account-panel-control">
                    {/* watchEnabled is null-means-enabled on the server, so it
                        reads true on a brand-new account — the watcher is only
                        really running once a folder is set. */}
                    <Switch
                      checked={!!acc.watchFolderPath && !!acc.watchEnabled}
                      disabled={!acc.watchFolderPath}
                      onChange={() => handleToggleAutoImport(acc)}
                      label={`Auto-import for ${acc.accountHolderName || acc.bankName}`}
                    />
                    <button
                      className="btn small ghost"
                      aria-expanded={!!autoOpen[acc.id]}
                      onClick={() => setAutoOpen(prev => ({ ...prev, [acc.id]: !prev[acc.id] }))}
                    >
                      {autoOpen[acc.id] ? <>Hide <FiChevronUp size={13} /></> : <>Set up <FiChevronDown size={13} /></>}
                    </button>
                  </div>
                </div>

                {autoOpen[acc.id] && (
                  <>
                    <div className="settings-field-grid" style={{ marginTop: 'var(--space-4)' }}>
                      <label className="settings-field grow">
                        <span className="settings-field-label">Folder to watch</span>
                        <input
                          type="text"
                          placeholder="e.g. D:\Statements\HDFC"
                          value={autoDraft(acc).watchFolderPath}
                          onChange={(e) => setAutoDraft(acc.id, { watchFolderPath: e.target.value })}
                          className="field-input"
                        />
                      </label>
                      <button type="button" className="btn small" onClick={() => openBrowse(acc)}>
                        <FiFolder size={13} /> Browse…
                      </button>
                      <label className="settings-field md">
                        <span className="settings-field-label">Statement PDF password</span>
                        <span className="field-affix">
                          <input
                            type={showPw[acc.id] ? "text" : "password"}
                            placeholder={acc.hasStatementPassword ? "••••• (saved)" : "optional"}
                            value={autoDraft(acc).statementPassword}
                            onChange={(e) => setAutoDraft(acc.id, { statementPassword: e.target.value })}
                            className="field-input"
                          />
                          <button
                            type="button"
                            className="field-affix-btn"
                            title={showPw[acc.id] ? "Hide password" : "Show password"}
                            aria-label={showPw[acc.id] ? "Hide password" : "Show password"}
                            onClick={() => setShowPw(prev => ({ ...prev, [acc.id]: !prev[acc.id] }))}
                          >
                            {showPw[acc.id] ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                          </button>
                        </span>
                      </label>
                    </div>

                    <div className="account-panel-actions">
                      {autoDrafts[acc.id] && (
                        <button className="btn primary small" onClick={() => handleSaveAutoImport(acc)}>
                          Save
                        </button>
                      )}
                      {acc.watchFolderPath && acc.watchEnabled && !autoDrafts[acc.id] && (
                        <button
                          type="button"
                          className="btn small"
                          disabled={!!sweeping[acc.id]}
                          onClick={() => handleImportNow(acc)}
                        >
                          <FiDownloadCloud size={13} />
                          {sweeping[acc.id] ? 'Checking folder…' : 'Import now'}
                        </button>
                      )}
                      {acc.hasStatementPassword && (
                        <button className="btn small ghost" onClick={() => handleSaveAutoImport(acc, { clearPassword: true })}>
                          Clear saved password
                        </button>
                      )}
                    </div>

                    {browse?.accId === acc.id && (
                      <div className="folder-browser">
                        <div className="folder-browser-head">
                          <span className="folder-browser-path">
                            {browse.path || 'Quick access & drives'}
                          </span>
                          {browse.path && (
                            <button type="button" className="btn small" onClick={() => loadBrowse(acc.id, browse.parent)}>Up</button>
                          )}
                          <button type="button" className="btn small" onClick={() => setBrowse(null)}>Close</button>
                        </div>
                        {browse.error && (
                          <div className="folder-browser-error">{browse.error}</div>
                        )}
                        <div className="folder-browser-list">
                          {browse.folders.length === 0 ? (
                            <div className="folder-browser-empty">No subfolders</div>
                          ) : browse.folders.map(f => (
                            <button
                              key={f.path}
                              type="button"
                              className="btn small folder-browser-item"
                              onClick={() => loadBrowse(acc.id, f.path)}
                            >
                              <FiFolder size={12} style={{ flexShrink: 0 }} /> {f.name}
                            </button>
                          ))}
                        </div>
                        {browse.path && (
                          <button
                            type="button"
                            className="btn primary small"
                            style={{ marginTop: 'var(--space-2)' }}
                            onClick={() => { setAutoDraft(acc.id, { watchFolderPath: browse.path }); setBrowse(null); }}
                          >
                            Use this folder
                          </button>
                        )}
                      </div>
                    )}

                    <p className="setting-note">
                      New statement files land in your transactions about a minute after they appear in this
                      folder. The password is stored on this computer and used to open protected PDFs.
                      Tip: in Explorer, right-click a folder → “Copy as path” and paste it here.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        ))}

        {/* ── Google Pay (GPay) Account & Auto-Import Card ── */}
        <section className="setting-card account-card gpay-account-card">
          <div className="setting-card-head">
            <div className="account-identity">
              <div className="settings-avatar gpay-avatar">
                G
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 className="setting-card-title gpay-title">
                  <span>Google Pay (GPay)</span>
                  <span style={{ fontSize: '11px', background: 'rgba(66, 133, 244, 0.12)', color: '#1a73e8', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                    Auto-Sync
                  </span>
                </h3>
                <p className="setting-card-desc">Google Takeout imports
                  {gpayConfig?.lastSyncUtc && <> · Last synced {formatDate(gpayConfig.lastSyncUtc)}</>}
                </p>
              </div>
            </div>

            {gpayConfig?.totalVolume > 0 && (
              <div className="account-balance">
                <span className="account-balance-label">Total expenses</span>
                <span className="account-balance-value">{currencyFormatterFull.format(gpayConfig.totalVolume)}</span>
              </div>
            )}

            {isAdmin && (
              <div className="setting-card-control">
                <button
                  className="btn small"
                  onClick={handleSweepGPay}
                  disabled={gpaySweeping}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <FiRefreshCw size={13} className={gpaySweeping ? 'spin' : ''} />
                  {gpaySweeping ? 'Syncing...' : 'Sync now'}
                </button>
              </div>
            )}
          </div>

          <div className="gpay-summary" aria-label="Google Pay import summary">
            <div><strong>{gpayConfig?.totalGroups || 0}</strong><span>Groups</span></div>
            <div><strong>{gpayConfig?.totalSplits || 0}</strong><span>Splits</span></div>
            <div><strong>{gpayConfig?.bankMatches || 0}</strong><span>Bank matches</span></div>
            {gpayConfig?.upiActivitiesEnriched > 0 && <div><strong>{gpayConfig.upiActivitiesEnriched}</strong><span>UPI enriched</span></div>}
            {gpayConfig?.cashbackTotalEarned > 0 && <div><strong>{currencyFormatterFull.format(gpayConfig.cashbackTotalEarned)}</strong><span>Cashback</span></div>}
            {gpayConfig?.activeVouchersCount > 0 && <div><strong>{gpayConfig.activeVouchersCount}</strong><span>Active coupons</span></div>}
          </div>

          <GPayProfileSettings config={gpayConfig} accounts={accounts} canEdit={isAdmin} busy={gpaySweeping} onConfig={config => { setGpayConfig(config); setGpayDraftPath(config.watchFolderPath || ''); setGpayUserName(config.userName || ''); setGpayMessage(null); setBrowse(null); setParticipantList([]); }} />

          {/* Auto-import: Google Pay watch folder */}
          {isAdmin && (
            <div className="account-panel">
              <div className="account-panel-head">
                <div style={{ minWidth: 0 }}>
                  <h4 className="account-panel-title">
                    Auto-import
                    {gpayConfig?.watchFolderPath && (gpayConfig?.watchEnabled
                      ? <Badge variant="green">On</Badge>
                      : <Badge variant="amber">Paused</Badge>)}
                  </h4>
                  <span className="account-panel-hint">
                    {gpayConfig?.watchFolderPath
                      ? gpayConfig.watchFolderPath
                      : 'Drop Google Pay Takeout exports in a folder to auto-sync groups & splits'}
                  </span>
                </div>
                <div className="account-panel-control">
                  <Switch
                    checked={!!gpayConfig?.watchFolderPath && !!gpayConfig?.watchEnabled}
                    disabled={!gpayConfig?.watchFolderPath}
                    onChange={handleToggleGPayAutoImport}
                    label="Auto-import for Google Pay"
                  />
                  <button
                    className="btn small ghost"
                    aria-expanded={!!gpayAutoOpen}
                    onClick={() => setGpayAutoOpen(prev => !prev)}
                  >
                    {gpayAutoOpen ? <>Hide <FiChevronUp size={13} /></> : <>Set up <FiChevronDown size={13} /></>}
                  </button>
                </div>
              </div>

              {gpayMessage && (
                <div style={{
                  background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success, #10b981)',
                  padding: '8px 12px', borderRadius: '6px', fontSize: '13px', marginTop: '10px',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}>
                  <FiCheckCircle size={14} />
                  <span>{gpayMessage}</span>
                </div>
              )}

              {gpayAutoOpen && (
                <>
                  <div className="settings-field-grid" style={{ marginTop: 'var(--space-4)' }}>
                    <label className="settings-field grow">
                      <span className="settings-field-label">Folder to watch for Google Pay exports</span>
                      <input
                        type="text"
                        placeholder="e.g. D:\BankStatements\Gpay"
                        value={gpayDraftPath}
                        onChange={(e) => setGpayDraftPath(e.target.value)}
                        className="field-input"
                      />
                    </label>
                    <button type="button" className="btn small" onClick={openBrowseGPay}>
                      <FiFolder size={13} /> Browse…
                    </button>
                  </div>

                  <div className="account-panel-actions">
                    <button className="btn primary small" onClick={handleSaveGPayAutoImport}>
                      Save GPay settings
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      disabled={gpaySweeping || !gpayConfig?.watchFolderPath}
                      onClick={handleSweepGPay}
                    >
                      <FiDownloadCloud size={13} />
                      {gpaySweeping ? 'Checking folder…' : 'Sweep / Sync now'}
                    </button>
                  </div>

                  {browse?.accId === 'gpay' && (
                    <div className="folder-browser">
                      <div className="folder-browser-head">
                        <span className="folder-browser-path">
                          {browse.path || 'Quick access & drives'}
                        </span>
                        {browse.path && (
                          <button type="button" className="btn small" onClick={() => loadBrowse('gpay', browse.parent)}>Up</button>
                        )}
                        <button type="button" className="btn small" onClick={() => setBrowse(null)}>Close</button>
                      </div>
                      {browse.error && (
                        <div className="folder-browser-error">{browse.error}</div>
                      )}
                      <div className="folder-browser-list">
                        {browse.folders.length === 0 ? (
                          <div className="folder-browser-empty">No subfolders</div>
                        ) : browse.folders.map(f => (
                          <button
                            key={f.path}
                            type="button"
                            className="btn small folder-browser-item"
                            onClick={() => loadBrowse('gpay', f.path)}
                          >
                            <FiFolder size={12} style={{ flexShrink: 0 }} /> {f.name}
                          </button>
                        ))}
                      </div>
                      {browse.path && (
                        <button
                          type="button"
                          className="btn primary small"
                          style={{ marginTop: 'var(--space-2)' }}
                          onClick={() => { setGpayDraftPath(browse.path); setBrowse(null); }}
                        >
                          Use this folder
                        </button>
                      )}
                    </div>
                  )}

                  <p className="setting-note">
                    <span>
                      Drop new <code>takeout-*.zip</code> archives (includes UPI activity, Cashback &amp; Subscriptions) or <code>Group expenses.json</code> into this folder.
                      The backend watcher sweeps the folder periodically and syncs splits, UPI merchant names, cashback, and subscriptions.
                    </span>
                  </p>
                </>
              )}
            </div>
          )}

          {/* Split & Repayment Preferences */}
          {isAdmin && (
            <div className="account-panel gpay-preferences">
              <div className="account-panel-head" style={{ marginBottom: '10px' }}>
                <div style={{ minWidth: 0 }}>
                  <h4 className="account-panel-title" style={{ fontSize: '14px' }}>Splits &amp; Repayment Preferences</h4>
                  <span className="account-panel-hint" style={{ fontSize: '12px' }}>Configure your split identity and transaction linking options</span>
                </div>
              </div>

              <div className="gpay-preferences-grid">
                {/* Name setting */}
                <div className="settings-field">
                  <span className="settings-field-label" style={{ fontSize: '12px', fontWeight: 600 }}>Your name in Google Pay</span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="text"
                      aria-label="Your name in Google Pay"
                      value={gpayUserName}
                      onChange={(e) => setGpayUserName(e.target.value)}
                      onBlur={(e) => handleSaveGPayUserName(e.target.value)}
                      placeholder="e.g. ARUN G, Arun"
                      className="field-input"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn small btn--outline"
                      onClick={handleOpenNamePicker}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', padding: '6px 10px', fontSize: '12px', cursor: 'pointer' }}
                      title="Pick name from detected bank accounts or contacts"
                    >
                      <FiUserCheck size={13} style={{ color: 'var(--primary, #3b82f6)' }} /> Choose name
                    </button>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                    <span>Matches your share and expenses.</span>
                    {gpayConfig?.candidateUserNames && gpayConfig.candidateUserNames.length > 0 && (
                      <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>Detected:</span>
                        {gpayConfig.candidateUserNames.slice(0, 3).map((name, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => handleSaveGPayUserName(name)}
                            style={{
                              fontSize: '11px', padding: '1px 6px', borderRadius: '10px',
                              border: gpayUserName.trim().toLowerCase() === name.toLowerCase() ? '1px solid var(--primary, #3b82f6)' : '1px solid var(--border-color, #d1d5db)',
                              background: gpayUserName.trim().toLowerCase() === name.toLowerCase() ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                              color: gpayUserName.trim().toLowerCase() === name.toLowerCase() ? 'var(--primary, #3b82f6)' : 'var(--text-muted)',
                              cursor: 'pointer', fontWeight: 600
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>

                {/* Default display setting */}
                <div className="settings-field">
                  <span className="settings-field-label" style={{ fontSize: '12px', fontWeight: 600 }}>Default splits view</span>
                  <select
                    aria-label="Default splits view"
                    value={splitDisplayFilter}
                    onChange={(e) => {
                      setSplitDisplayFilter(e.target.value);
                      localStorage.setItem('bsp_gpay_split_filter', e.target.value);
                    }}
                    className="field-input"
                  >
                    <option value="all">All confirmed splits</option>
                    <option value="owed_by_me">I need to pay</option>
                    <option value="to_collect">Others owe me</option>
                    <option value="created_by_me">Splits I created</option>
                    <option value="included">Splits involving me</option>
                  </select>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                    Initial filter tab shown on the Splits page.
                  </span>
                </div>
              </div>

              {/* Compact linking preference toggle */}
              <div style={{ marginTop: '12px', padding: '10px 14px', background: 'var(--surface-2, #f9fafb)', borderRadius: '6px', border: '1px solid var(--border-color, #e5e7eb)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>
                      Link transactions only for splits I created
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px', lineHeight: 1.3 }}>
                      Only match bank transactions when you paid the original bill.
                    </div>
                  </div>
                  <Switch
                    checked={onlyLinkCreatedByMe}
                    onChange={(checked) => {
                      setOnlyLinkCreatedByMe(checked);
                      localStorage.setItem('bsp_gpay_only_link_created_by_me', checked ? 'true' : 'false');
                    }}
                    label="Only link splits created by me"
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    ));
}
