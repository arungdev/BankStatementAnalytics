import { getGroupDisplayMembers, isImportedGPayGroup } from "../../utils/groupMembers";
import { FiArrowLeft, FiUserPlus, FiTrash2, FiMessageSquare, FiCheckCircle, FiClock, FiChevronRight, FiUsers, FiFileText, FiPlus } from "react-icons/fi";
import { currencyFormatter } from "../../utils/format";

export default function SplitGroupChat({ group, fmtDate, formatChatDate, getAvatarColor, getInitials, groupViewSubTab, handleDeleteBillGroup, handleLinkRepaymentForGroupMember, openAddMemberModal, openCreateSplitForGroup, setGroupViewSubTab, setSelectedBillGroupId, setSelectedSplitDetail }) {
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
  }
