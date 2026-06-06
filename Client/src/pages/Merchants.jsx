import { useEffect, useState } from "react";
import api from "../api/client";

export default function Merchants() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Sidebar state
  const [selectedMerchantId, setSelectedMerchantId] = useState(null);
  const [merchantDetails, setMerchantDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ category: '', subCategory: '' });
  const [sidebarWidth, setSidebarWidth] = useState(450);
  const [isResizing, setIsResizing] = useState(false);
  const [categoriesList, setCategoriesList] = useState([]);
  const [txFilterName, setTxFilterName] = useState('ALL');
  
  // Merge state
  const [selectedIds, setSelectedIds] = useState([]);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [primaryMergeId, setPrimaryMergeId] = useState("");

  useEffect(() => {
    api.get("/merchants")
      .then(res => {
        setData(res.data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
      
    api.get("/categories")
      .then(res => setCategoriesList(res.data || []))
      .catch(err => console.error("Failed to load categories", err));
  }, []);

  // Handle dragging the sidebar to resize
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      // Calculate new width based on mouse position from the right edge
      const newWidth = window.innerWidth - e.clientX;
      // Constrain the width between 300px and the window width minus 50px
      if (newWidth >= 300 && newWidth <= window.innerWidth - 50) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none'; // Prevent text selection while dragging
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleRowClick = (id) => {
    setSelectedMerchantId(id);
    setLoadingDetails(true);
    setTxFilterName('ALL');
    
    api.get(`/merchants/${id}`)
      .then(res => {
        setMerchantDetails(res.data);
        setLoadingDetails(false);
      })
      .catch(err => {
        console.error(err);
        setLoadingDetails(false);
      });
  };

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
      api.get("/merchants").then(res => {
        setData(res.data || []);
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
      api.get("/merchants").then(res => setData(res.data || []));
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
      category: merchantDetails.category || '',
      subCategory: merchantDetails.subCategory || ''
    });
    setIsEditing(true);
  };

  const handleSaveClick = () => {
    api.put(`/merchants/${merchantDetails.id}`, editForm)
      .then(() => {
        setMerchantDetails({ ...merchantDetails, ...editForm });
        setIsEditing(false);
        // Update the main list so changes reflect immediately in the table
        setData(prevData => prevData.map(merchant => 
          merchant.id === merchantDetails.id ? { ...merchant, ...editForm } : merchant
        ));
      })
      .catch(err => {
        console.error("Failed to update merchant", err);
      });
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
    return merchant.friendlyName?.toLowerCase().includes(term) ||
           merchant.name?.toLowerCase().includes(term) || 
           merchant.category?.toLowerCase().includes(term) ||
           merchant.upiIds?.some(upi => upi?.toLowerCase().includes(term)) ||
           merchant.aliases?.some(alias => alias?.toLowerCase().includes(term));
  });

  const displayedTxs = merchantDetails?.transactions?.filter(tx => {
    if (txFilterName === 'ALL') return true;
    
    // Process of elimination: if searching for the primary name, return 
    // transactions that don't belong to any of the merged aliases
    if (txFilterName === merchantDetails.name) {
      const matchesAlias = merchantDetails.aliases?.some(alias => {
        if (!alias) return false;
        const aliasTerm = alias.toLowerCase();
        return tx.description?.toLowerCase().includes(aliasTerm) || 
               tx.upiReference?.toLowerCase().includes(aliasTerm);
      });
      return !matchesAlias;
    }

    const filterTerm = txFilterName.toLowerCase();
    return tx.description?.toLowerCase().includes(filterTerm) || 
           tx.upiReference?.toLowerCase().includes(filterTerm);
  }) || [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <h1 style={{ marginBottom: 0 }}>Merchants</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {selectedIds.length > 1 && (
            <button className="btn primary" onClick={() => { setShowMergeModal(true); setPrimaryMergeId(selectedIds[0]); }}>
              Merge Selected ({selectedIds.length})
            </button>
          )}
          <div className="badge blue" style={{ padding: '10px 18px', fontSize: '13px', fontWeight: 700 }}>
            {filteredData.length} Total Merchants
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input 
          type="text" 
          placeholder="Search merchants..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ padding: '8px 12px', width: '100%', maxWidth: '300px', borderRadius: '4px', border: '1px solid #d1d5db' }}
        />
      </div>

      <div className="table-container" style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
        <table>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f9fafb', zIndex: 10, boxShadow: 'inset 0 -1px 0 #e5e7eb' }}>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>
                <input 
                  type="checkbox" 
                  checked={filteredData.length > 0 && selectedIds.length === filteredData.length}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(filteredData.map(c => c.id));
                    else setSelectedIds([]);
                  }}
                />
              </th>
              <th>Name</th>
              <th>Category</th>
              <th>UPI IDs</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map(merchant => (
              <tr key={merchant.id} onClick={() => handleRowClick(merchant.id)} style={{ cursor: 'pointer', transition: 'background-color 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = '#f9fafb'} onMouseOut={e => e.currentTarget.style.backgroundColor = ''}>
                <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={selectedIds.includes(merchant.id)} onChange={(e) => toggleSelection(merchant.id, e)} />
                </td>
                <td style={{ fontWeight: 700, color: "#111827" }}>{merchant.friendlyName || merchant.name || "-"}</td>
                <td>
                  {merchant.category ? (
                    <span className="badge purple" style={{ textTransform: 'capitalize' }}>
                      {merchant.category}
                    </span>
                  ) : "-"}
                </td>
                <td style={{ fontFamily: 'monospace', color: '#4b5563', fontSize: '13px' }}>{merchant.upiIds?.join(", ") || "-"}</td>
                <td><span className="badge green">Active</span></td>
              </tr>
            ))}
            {filteredData.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '48px 24px', color: '#9ca3af', fontStyle: 'italic' }}>
                  {data.length === 0 ? "No merchants found." : "No merchants match your search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Merge Modal */}
      {showMergeModal && (
        <>
          <div onClick={() => setShowMergeModal(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '400px', backgroundColor: '#fff', padding: '24px', borderRadius: '8px', zIndex: 10001, boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h2 style={{ marginTop: 0 }}>Merge Merchants</h2>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>
              Select the primary merchant to keep. The others will be merged into this one and then deleted.
            </p>
            <div style={{ margin: '20px 0' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>Primary Merchant</label>
              <select 
                value={primaryMergeId} 
                onChange={e => setPrimaryMergeId(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px' }}
              >
                {selectedIds.map(id => {
                  const merchant = data.find(x => x.id === id);
                  return <option key={id} value={id}>{merchant?.name}</option>;
                })}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn" onClick={() => setShowMergeModal(false)}>Cancel</button>
              <button className="btn primary" onClick={handleMergeSubmit}>Confirm Merge</button>
            </div>
          </div>
        </>
      )}

      {/* RHS Sidebar Overlay */}
      {selectedMerchantId && (
        <>
          {/* Backdrop */}
          <div 
            onClick={closeSidebar}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 999 }}
          />
          
          {/* Sidebar */}
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: `${sidebarWidth}px`, maxWidth: '100vw',
            backgroundColor: '#fff', boxShadow: '-4px 0 15px rgba(0,0,0,0.1)',
            zIndex: 1000, display: 'flex', flexDirection: 'column'
          }}>
            {/* Resize Handle */}
            <div 
              onMouseDown={() => setIsResizing(true)}
              style={{
                position: 'absolute',
                left: 0, top: 0, bottom: 0, width: '6px',
                cursor: 'ew-resize',
                backgroundColor: isResizing ? '#3b82f6' : 'transparent',
                zIndex: 1001,
                transition: 'background-color 0.2s'
              }}
            />

            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f9fafb' }}>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#111827' }}>Merchant Details</h2>
              <button onClick={closeSidebar} style={{ cursor: 'pointer', background: 'none', border: 'none', fontSize: '28px', color: '#6b7280', lineHeight: 1 }}>&times;</button>
            </div>
            
            {/* Content */}
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              {loadingDetails ? (
                <div style={{ textAlign: 'center', color: '#6b7280', marginTop: '40px' }}>Loading details...</div>
              ) : merchantDetails ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ margin: '0 0 4px 0', fontSize: '20px', color: '#111827' }}>{merchantDetails.friendlyName || merchantDetails.name}</h3>
                      <p style={{ margin: '0 0 24px 0', color: '#6b7280', fontSize: '14px' }}>
                        {merchantDetails.friendlyName && merchantDetails.name !== merchantDetails.friendlyName ? `Original Name: ${merchantDetails.name}` : 'Original Name Matches'}
                      </p>
                    </div>
                    {!isEditing ? (
                      <button onClick={handleEditClick} style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}>Edit</button>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setIsEditing(false)} style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: '#fff', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={handleSaveClick} style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Save</button>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Category</div>
                      {isEditing ? (
                        <select 
                          value={editForm.category} 
                          onChange={(e) => setEditForm({...editForm, category: e.target.value, subCategory: ''})} 
                          style={{ marginTop: '4px', width: '100%', padding: '6px', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: '#fff' }} 
                        >
                          <option value="">-- None --</option>
                          {categoriesList.map(cat => (
                            <option key={cat.id} value={cat.name}>{cat.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ marginTop: '4px', color: '#111827' }}>{merchantDetails.category || '-'}</div>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Sub-Category</div>
                      {isEditing ? (
                        <select 
                          value={editForm.subCategory} 
                          onChange={(e) => setEditForm({...editForm, subCategory: e.target.value})} 
                          style={{ marginTop: '4px', width: '100%', padding: '6px', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: '#fff' }} 
                          disabled={!editForm.category || (categoriesList.find(c => c.name === editForm.category)?.subCategories?.length || 0) === 0}
                        >
                          <option value="">-- None --</option>
                          {categoriesList.find(c => c.name === editForm.category)?.subCategories?.map(sub => (
                            <option key={sub} value={sub}>{sub}</option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ marginTop: '4px', color: '#111827' }}>{merchantDetails.subCategory || '-'}</div>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Bank Code</div>
                      <div style={{ marginTop: '4px', color: '#111827' }}>{merchantDetails.bankCode || '-'}</div>
                    </div>
                  </div>

                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>UPI IDs</div>
                    {merchantDetails.upiIds?.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {merchantDetails.upiIds.map((upi, idx) => (
                          <span key={`${upi}-${idx}`} className="badge" style={{ backgroundColor: '#f3f4f6', color: '#374151', padding: '4px 8px', fontSize: '12px', border: '1px solid #e5e7eb' }}>
                            {upi}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#9ca3af', fontSize: '14px' }}>None</div>
                    )}
                  </div>

                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>Merged Names (Aliases)</div>
                    {merchantDetails.aliases?.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {merchantDetails.aliases.map((alias, idx) => (
                          <span key={`${alias}-${idx}`} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: '#fff', color: '#4b5563', padding: '4px 8px', fontSize: '12px', border: '1px dashed #d1d5db' }}>
                            {alias}
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleUnmerge(alias); }}
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0, fontWeight: 'bold', lineHeight: 1, fontSize: '14px', display: 'flex', alignItems: 'center' }}
                              title="Unmerge"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#9ca3af', fontSize: '14px' }}>None</div>
                    )}
                  </div>

                  <hr style={{ border: '0', borderTop: '1px solid #e5e7eb', margin: '24px 0' }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', color: '#111827' }}>Recent Transactions ({displayedTxs.length})</h4>
                    {merchantDetails.aliases?.length > 0 && (
                      <select 
                        value={txFilterName}
                        onChange={(e) => setTxFilterName(e.target.value)}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px', backgroundColor: '#fff', outline: 'none' }}
                      >
                        <option value="ALL">All Names</option>
                        <option value={merchantDetails.name}>{merchantDetails.name}</option>
                        {merchantDetails.aliases.map(alias => (
                          <option key={alias} value={alias}>{alias}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {displayedTxs.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
                      {displayedTxs.map((tx, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid #f3f4f6' }}>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>{new Date(tx.transactionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{tx.mode || 'Transfer'}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: tx.credit ? '#10b981' : '#ef4444' }}>
                              {tx.credit ? '+' : '-'}₹{Math.max(tx.credit, tx.debit).toLocaleString('en-IN')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: '#9ca3af', fontSize: '14px' }}>No matching transactions found for "{txFilterName}".</p>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#ef4444' }}>Failed to load details.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}