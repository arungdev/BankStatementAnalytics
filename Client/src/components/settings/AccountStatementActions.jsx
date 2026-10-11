import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Drawer, EmptyState, Modal, Tabs, useAuth } from '@common/client';
import { FiUploadCloud, FiFileText, FiRotateCcw, FiAlertCircle, FiRefreshCw } from 'react-icons/fi';
import UploadStatement from '../../pages/UploadStatement';
import RequestError from '../RequestError';
import useAsyncResource from '../../hooks/useAsyncResource';
import api from '../../api/client';
import { revertStatement, retryAutoImport } from '../../api/statements';
export default function AccountStatementActions({ account }) {
 const { isAdmin } = useAuth(); const navigate = useNavigate();
 const [showUpload, setShowUpload] = useState(false);
 const [uploadHistoryOpen, setUploadHistoryOpen] = useState(false);
 const [uploadTab, setUploadTab] = useState('success');
 const [sidebarWidth, setSidebarWidth] = useState(450);
 const [retryPw, setRetryPw] = useState({}); const [retrying, setRetrying] = useState({});
 const [actionError, setActionError] = useState('');
 const [reverting, setReverting] = useState({});
 const closeUploadHistory = () => setUploadHistoryOpen(false);
 const loadHistory = useCallback(async signal => {
  if (!uploadHistoryOpen) return { uploads: [], importFails: [] };
  const [success, failures] = await Promise.all([api.get('/statements/uploads', { signal }), api.get('/statements/auto-imports', { signal, params: { accountId: account.id } })]);
  return { uploads: (success.data || []).filter(u => String(u.accountId) === String(account.id)).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)), importFails: (failures.data || []).filter(f => f.status === 'Failed' && String(f.accountId) === String(account.id)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) };
 }, [uploadHistoryOpen, account.id]);
 const { data, loading: loadingUploads, error, retry } = useAsyncResource(loadHistory, { uploads: [], importFails: [] });
 const { uploads, importFails } = data;
 const showNewTransactions = upload => navigate('/transactions?accountId=' + encodeURIComponent(account.id) + '&uploadId=' + encodeURIComponent(upload.id));
 const handleRevert = async upload => {
  if (reverting[upload.id]) return;
  if (!window.confirm('Revert "' + upload.fileName + '"? Its imported transactions will be removed.')) return;
  setActionError('');
  setReverting(prev => ({ ...prev, [upload.id]: true }));
  try { await revertStatement(upload.id); retry(); } catch { setActionError('Could not revert this upload. Please try again.'); }
  finally { setReverting(prev => ({ ...prev, [upload.id]: false })); }
 };
 const handleRetryImport = async fail => {
  if (retrying[fail.id]) return;
  setRetrying(prev => ({ ...prev, [fail.id]: true })); setActionError('');
  try { await retryAutoImport(fail.id, retryPw[fail.id] || ''); setRetryPw(prev => ({ ...prev, [fail.id]: '' })); retry(); }
  catch (err) { setActionError(err.response?.data?.message || 'Retry failed. Please check the password and try again.'); }
  finally { setRetrying(prev => ({ ...prev, [fail.id]: false })); }
 };
 return <>
  <section className="account-panel account-import-panel" id={`set-manual-import-${account.id}`} aria-label="Manual import">
   <div className="account-panel-head">
    <div>
     <h4 className="account-panel-title">Manual import</h4>
     <span className="account-panel-hint">Upload a statement file. History includes manual uploads and automatic imports for this account.</span>
    </div>
   </div>
   <div className="account-panel-actions">
   {isAdmin && <button type="button" className="btn primary small" onClick={() => setShowUpload(true)}><FiUploadCloud size={13} /> Upload Statement</button>}
   <button type="button" className="btn small" onClick={() => { setUploadTab('success'); setActionError(''); setUploadHistoryOpen(true); }}><FiFileText size={13} /> Upload History</button>
   </div>
  </section>
      <Drawer
        open={uploadHistoryOpen}
        onClose={closeUploadHistory}
        title={`Upload History — ${account.accountHolderName || account.bankName} · •••• ${account.accountNumber?.slice(-4) || '****'}`}
        width={typeof window !== 'undefined' && window.innerWidth <= 640 ? '100vw' : sidebarWidth}
        onWidthChange={setSidebarWidth}
        modal={typeof window !== 'undefined' && window.innerWidth <= 1024}
      >
        <RequestError error={error} onRetry={retry} />
        {actionError && <p role="alert" style={{ color: 'var(--danger)' }}>{actionError}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
          <button type="button" className="btn small" disabled={loadingUploads} onClick={retry}><FiRefreshCw size={13} /> {loadingUploads ? 'Refreshing…' : 'Refresh'}</button>
        </div>
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
                <EmptyState message="No statements have been imported for this account yet." />
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

                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            <Badge variant="blue">{upload.totalCount ?? upload.transactionCount ?? 0} total</Badge>
                            {(upload.newCount ?? 0) > 0 ? (
                              <button
                                type="button"
                                className="import-new-link"
                                onClick={() => showNewTransactions(upload)}
                                title="Show the transactions this upload added"
                              >
                                {upload.newCount} new
                              </button>
                            ) : (
                              <Badge variant="green">0 new</Badge>
                            )}
                            <Badge variant={upload.autoImported ? "purple" : "gray"}>{upload.autoImported ? "Auto" : "Manual"}</Badge>
                            {isAdmin && (
                              <button type="button" className="btn danger small" disabled={!!reverting[upload.id]} onClick={() => handleRevert(upload)}>
                                <FiRotateCcw size={12} /> {reverting[upload.id] ? 'Reverting…' : 'Revert'}
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
                <EmptyState message="No failed imports for this account." />
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

<Modal open={showUpload} onClose={() => setShowUpload(false)} width={760}><UploadStatement accountId={account.id} showHistory={false} /></Modal></>;
}
