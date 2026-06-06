import { useState, useEffect } from "react";
import api from "../api/client";

export default function Settings({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('categories');
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  
  // Category states
  const [newCatName, setNewCatName] = useState("");
  const [editingCatId, setEditingCatId] = useState(null);
  const [editCatName, setEditCatName] = useState("");

  // Sub-category states
  const [newSubCatName, setNewSubCatName] = useState("");
  const [activeSubCatInputId, setActiveSubCatInputId] = useState(null);

  // Account states
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editAccountName, setEditAccountName] = useState("");

  useEffect(() => {
    if (isOpen) {
      fetchCategories();
      fetchAccounts();
    }
  }, [isOpen]);

  const fetchCategories = async () => {
    try {
      const res = await api.get("/categories");
      setCategories(res.data || []);
    } catch (err) {
      console.error("Failed to load categories", err);
    }
  };

  const fetchAccounts = async () => {
    try {
      const res = await api.get("/statements/accounts");
      setAccounts(res.data || []);
    } catch (err) {
      console.error("Failed to load accounts", err);
    }
  };

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      const res = await api.post("/categories", { name: newCatName.trim() });
      setCategories([...categories, res.data]);
      setNewCatName("");
    } catch (err) { console.error(err); }
  };

  const handleDeleteCategory = async (id) => {
    try {
      await api.delete(`/categories/${id}`);
      setCategories(categories.filter(c => c.id !== id));
    } catch (err) { console.error(err); }
  };

  const handleUpdateCategory = async (id) => {
    if (!editCatName.trim()) return;
    try {
      await api.put(`/categories/${id}`, { name: editCatName.trim() });
      setCategories(categories.map(c => c.id === id ? { ...c, name: editCatName.trim() } : c));
      setEditingCatId(null);
    } catch (err) { console.error(err); }
  };

  const handleAddSubCategory = async (catId) => {
    if (!newSubCatName.trim()) return;
    try {
      await api.post(`/categories/${catId}/subcategories`, { name: newSubCatName.trim() });
      setCategories(categories.map(c => 
        c.id === catId ? { ...c, subCategories: [...c.subCategories, newSubCatName.trim()] } : c
      ));
      setNewSubCatName("");
      setActiveSubCatInputId(null);
    } catch (err) { console.error(err); }
  };

  const handleDeleteSubCategory = async (catId, subCatIndex, subCatName) => {
    try {
      await api.delete(`/categories/${catId}/subcategories/${encodeURIComponent(subCatName)}`);
      setCategories(categories.map(c => {
        if (c.id === catId) {
          const newSub = [...c.subCategories];
          newSub.splice(subCatIndex, 1);
          return { ...c, subCategories: newSub };
        }
        return c;
      }));
    } catch (err) { console.error(err); }
  };

  const handleUpdateAccount = async (id) => {
    if (!editAccountName.trim()) return;
    try {
      await api.put(`/accounts/${id}`, { accountHolderName: editAccountName.trim() });
      setAccounts(accounts.map(a => a.id === id ? { ...a, accountHolderName: editAccountName.trim() } : a));
      setEditingAccountId(null);
      // Reload the page to ensure the main App sidebar and global context refresh
      window.location.reload();
    } catch (err) {
      console.error("Failed to update account", err);
      alert("Failed to update account. Please try again.");
    }
  };

  const handleDeleteAccount = async (id) => {
    if (!window.confirm("Are you sure you want to delete this account? All associated transactions will be removed permanently.")) return;
    try {
      await api.delete(`/accounts/${id}`);
      setAccounts(accounts.filter(a => a.id !== id));
      // Reload the page to ensure the main App sidebar and global context refresh
      window.location.reload();
    } catch (err) {
      console.error("Failed to delete account", err);
      alert("Failed to delete account. Please try again.");
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        onClick={onClose}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999 }}
      />
      {/* Modal Container */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: '900px', maxWidth: '95vw', height: '650px', maxHeight: '95vh',
        backgroundColor: '#fff', borderRadius: '8px', zIndex: 10000,
        boxShadow: '0 10px 25px rgba(0,0,0,0.2)', display: 'flex', overflow: 'hidden'
      }}>
        {/* Close Button (Absolute to Modal) */}
        <button onClick={onClose} style={{ position: 'absolute', top: '16px', right: '20px', cursor: 'pointer', background: 'none', border: 'none', fontSize: '28px', color: '#6b7280', lineHeight: 1, zIndex: 10 }}>&times;</button>

        {/* LHS - Sidebar */}
        <div style={{ width: '240px', backgroundColor: '#f9fafb', borderRight: '1px solid #e5e7eb', padding: '32px 0', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ margin: '0 0 24px 24px', fontSize: '20px', color: '#111827' }}>Settings</h2>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <button 
              onClick={() => setActiveTab('general')}
              style={{ padding: '12px 24px', textAlign: 'left', background: activeTab === 'general' ? '#eff6ff' : 'transparent', color: activeTab === 'general' ? '#2563eb' : '#4b5563', border: 'none', borderRight: activeTab === 'general' ? '3px solid #3b82f6' : '3px solid transparent', cursor: 'pointer', fontWeight: activeTab === 'general' ? 600 : 400, fontSize: '15px' }}
            >
              General
            </button>
            <button 
              onClick={() => setActiveTab('accounts')}
              style={{ padding: '12px 24px', textAlign: 'left', background: activeTab === 'accounts' ? '#eff6ff' : 'transparent', color: activeTab === 'accounts' ? '#2563eb' : '#4b5563', border: 'none', borderRight: activeTab === 'accounts' ? '3px solid #3b82f6' : '3px solid transparent', cursor: 'pointer', fontWeight: activeTab === 'accounts' ? 600 : 400, fontSize: '15px' }}
            >
              Accounts
            </button>
            <button 
              onClick={() => setActiveTab('categories')}
              style={{ padding: '12px 24px', textAlign: 'left', background: activeTab === 'categories' ? '#eff6ff' : 'transparent', color: activeTab === 'categories' ? '#2563eb' : '#4b5563', border: 'none', borderRight: activeTab === 'categories' ? '3px solid #3b82f6' : '3px solid transparent', cursor: 'pointer', fontWeight: activeTab === 'categories' ? 600 : 400, fontSize: '15px' }}
            >
              Categories
            </button>
            <button 
              onClick={() => setActiveTab('profile')}
              style={{ padding: '12px 24px', textAlign: 'left', background: activeTab === 'profile' ? '#eff6ff' : 'transparent', color: activeTab === 'profile' ? '#2563eb' : '#4b5563', border: 'none', borderRight: activeTab === 'profile' ? '3px solid #3b82f6' : '3px solid transparent', cursor: 'pointer', fontWeight: activeTab === 'profile' ? 600 : 400, fontSize: '15px' }}
            >
              Profile
            </button>
          </div>
        </div>
      
        {/* RHS - Main Content Area */}
        <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
          {activeTab === 'general' && (
            <div>
              <h1 style={{ margin: '0 0 32px 0', fontSize: '24px' }}>General Settings</h1>
              <p style={{ color: '#6b7280' }}>Application-wide settings can be configured here.</p>
            </div>
          )}
          
          {activeTab === 'profile' && (
            <div>
              <h1 style={{ margin: '0 0 32px 0', fontSize: '24px' }}>Profile Settings</h1>
              <p style={{ color: '#6b7280' }}>User account and preferences can be configured here.</p>
            </div>
          )}

          {activeTab === 'accounts' && (
            <div>
              <h1 style={{ margin: '0 0 32px 0', fontSize: '24px' }}>Manage Accounts</h1>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {accounts.map(acc => (
                  <div key={acc.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      {editingAccountId === acc.id ? (
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                          <input 
                            type="text" 
                            value={editAccountName}
                            onChange={(e) => setEditAccountName(e.target.value)}
                            style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px' }}
                          />
                        </div>
                      ) : (
                        <h3 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{acc.accountHolderName || acc.bankName}</h3>
                      )}
                      <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>{acc.bankName} ending in {acc.accountNumber?.slice(-4) || '****'}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {editingAccountId === acc.id ? (
                        <>
                          <button className="btn primary small" onClick={() => handleUpdateAccount(acc.id)}>Save</button>
                          <button className="btn small" onClick={() => setEditingAccountId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="btn small" onClick={() => { setEditingAccountId(acc.id); setEditAccountName(acc.accountHolderName || ''); }}>Edit Name</button>
                          <button className="btn danger small" onClick={() => handleDeleteAccount(acc.id)}>Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {accounts.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#6b7280', padding: '32px' }}>
                    No accounts found.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'categories' && (
            <div>
              <h1 style={{ margin: '0 0 32px 0', fontSize: '24px' }}>Settings: Categories</h1>
              
              <div className="card" style={{ marginBottom: '32px' }}>
                <h3 style={{ marginTop: 0 }}>Add New Category</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    placeholder="Category Name" 
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '4px', flex: 1 }}
                  />
                  <button className="btn primary" onClick={handleAddCategory}>Add Category</button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {categories.map(cat => (
                  <div key={cat.id} className="card">
                    {/* Category Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      {editingCatId === cat.id ? (
                        <div style={{ display: 'flex', gap: '8px', flex: 1, marginRight: '16px' }}>
                          <input 
                            type="text" 
                            value={editCatName}
                            onChange={(e) => setEditCatName(e.target.value)}
                            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', flex: 1 }}
                          />
                          <button className="btn" style={{ padding: '6px 12px' }} onClick={() => handleUpdateCategory(cat.id)}>Save</button>
                          <button className="btn" style={{ padding: '6px 12px' }} onClick={() => setEditingCatId(null)}>Cancel</button>
                        </div>
                      ) : (
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {cat.name}
                          <button 
                            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}
                            onClick={() => { setEditingCatId(cat.id); setEditCatName(cat.name); }}
                          >
                            Edit
                          </button>
                        </h3>
                      )}
                      
                      <button className="btn danger small" onClick={() => handleDeleteCategory(cat.id)}>Delete</button>
                    </div>

                    {/* Sub-Categories */}
                    <div>
                      <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>Sub-Categories</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {cat.subCategories.map((sub, idx) => (
                          <span key={idx} className="badge" style={{ backgroundColor: '#f3f4f6', color: '#374151', padding: '6px 10px', fontSize: '13px', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {sub}
                            <button 
                              onClick={() => handleDeleteSubCategory(cat.id, idx, sub)}
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0, fontWeight: 'bold', lineHeight: 1 }}
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>

                      {/* Add Sub-Category Input */}
                      {activeSubCatInputId === cat.id ? (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                          <input 
                            type="text" 
                            placeholder="New Sub-Category"
                            value={newSubCatName}
                            onChange={(e) => setNewSubCatName(e.target.value)}
                            style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                          />
                          <button className="btn primary small" onClick={() => handleAddSubCategory(cat.id)}>Add</button>
                          <button className="btn small" onClick={() => setActiveSubCatInputId(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => { setActiveSubCatInputId(cat.id); setNewSubCatName(""); }}
                          style={{ marginTop: '12px', padding: '4px 8px', fontSize: '12px', backgroundColor: '#fff', border: '1px dashed #d1d5db', borderRadius: '4px', cursor: 'pointer', color: '#6b7280' }}
                        >
                          + Add Sub-Category
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {categories.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#6b7280', padding: '32px' }}>
                    No categories defined. Add one above!
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}