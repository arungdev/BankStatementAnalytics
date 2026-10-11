import { CATEGORY_NAME_MAX } from "../../utils/categoryName";
import { FiPlus, FiTag, FiEdit2, FiX } from "react-icons/fi";

export default function CategorySettings({ activeSubCatInputId, categories, editCatName, editCatNameError, editingCatId, handleAddCategory, handleAddSubCategory, handleDeleteCategory, handleDeleteSubCategory, handleUpdateCategory, isAdmin, newCatName, newCatNameError, newSubCatName, newSubCatNameError, setActiveSubCatInputId, setEditCatName, setEditCatNameError, setEditingCatId, setNewCatName, setNewCatNameError, setNewSubCatName, setNewSubCatNameError }) {
  return (<>
      {isAdmin && (
        <div className="settings-add-card">
          <label className="settings-add-card-label" htmlFor="new-category">Add a new category</label>
          <div className="settings-add-row">
            <input
              id="new-category"
              type="text"
              placeholder="e.g. Groceries, Rent, Travel…"
              value={newCatName}
              onChange={(e) => { setNewCatName(e.target.value); setNewCatNameError(""); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
              maxLength={CATEGORY_NAME_MAX}
              className="field-input"
              style={{ flex: 1 }}
            />
            <button className="btn primary" style={{ whiteSpace: 'nowrap' }} onClick={handleAddCategory}>
              <FiPlus size={15} /> Add
            </button>
          </div>
          {newCatNameError && <p className="settings-field-error">{newCatNameError}</p>}
        </div>
      )}

      {categories.length === 0 ? (
        <div className="settings-empty">
          <FiTag size={36} />
          <div className="settings-empty-title">No categories defined</div>
          <div className="settings-empty-sub">
            {isAdmin ? 'Add one above to start organizing your transactions.' : 'No categories have been added.'}
          </div>
        </div>
      ) : (
        <div className="settings-stack" id="set-categories-list">
          {categories.map(cat => (
            <section key={cat.id} className="setting-card">
              <div className="setting-card-head">
                {editingCatId === cat.id ? (
                  <div style={{ flex: 1 }}>
                    <div className="settings-inline-edit">
                      <input
                        type="text"
                        value={editCatName}
                        onChange={(e) => { setEditCatName(e.target.value); setEditCatNameError(""); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateCategory(cat.id);
                          if (e.key === 'Escape') { e.stopPropagation(); setEditingCatId(null); setEditCatNameError(""); }
                        }}
                        maxLength={CATEGORY_NAME_MAX}
                        autoFocus
                        className="field-input"
                        style={{ flex: 1 }}
                        aria-label="Category name"
                      />
                      <button className="btn primary small" onClick={() => handleUpdateCategory(cat.id)}>Save</button>
                      <button className="btn small" onClick={() => { setEditingCatId(null); setEditCatNameError(""); }}>Cancel</button>
                    </div>
                    {editCatNameError && <p className="settings-field-error">{editCatNameError}</p>}
                  </div>
                ) : (
                  <>
                    <div className="setting-card-text">
                      <h3 className="setting-card-title">
                        {cat.name}
                        {isAdmin && (
                          <button
                            className="settings-edit-link"
                            title="Rename category"
                            aria-label={`Rename ${cat.name}`}
                            onClick={() => { setEditingCatId(cat.id); setEditCatName(cat.name); setEditCatNameError(""); }}
                          >
                            <FiEdit2 size={14} />
                          </button>
                        )}
                      </h3>
                      <p className="setting-card-desc">
                        {(cat.subCategories || []).length || 'No'} sub-categor
                        {(cat.subCategories || []).length === 1 ? 'y' : 'ies'}
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="setting-card-control">
                        <button className="btn danger small" onClick={() => handleDeleteCategory(cat.id, cat.name)}>Delete</button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="setting-card-body subcat-section">
                <div className="subcat-chips">
                  {(cat.subCategories || []).map((sub, idx) => (
                    <span key={idx} className="subcat-chip">
                      {sub}
                      {isAdmin && (
                        <button
                          className="subcat-chip-remove"
                          onClick={() => handleDeleteSubCategory(cat.id, sub)}
                          title={`Remove ${sub}`}
                          aria-label={`Remove ${sub}`}
                        >
                          <FiX size={13} />
                        </button>
                      )}
                    </span>
                  ))}

                  {isAdmin && (activeSubCatInputId === cat.id ? (
                    <span className="subcat-add-row">
                      <input
                        type="text"
                        placeholder="New sub-category"
                        value={newSubCatName}
                        onChange={(e) => { setNewSubCatName(e.target.value); setNewSubCatNameError(""); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddSubCategory(cat.id);
                          if (e.key === 'Escape') { e.stopPropagation(); setActiveSubCatInputId(null); setNewSubCatNameError(""); }
                        }}
                        maxLength={CATEGORY_NAME_MAX}
                        autoFocus
                        className="field-input"
                        aria-label="New sub-category"
                      />
                      <button className="btn primary small" onClick={() => handleAddSubCategory(cat.id)}>Add</button>
                      <button className="btn small" onClick={() => { setActiveSubCatInputId(null); setNewSubCatNameError(""); }}>Cancel</button>
                    </span>
                  ) : (
                    <button
                      className="subcat-add-btn"
                      onClick={() => { setActiveSubCatInputId(cat.id); setNewSubCatName(""); setNewSubCatNameError(""); }}
                    >
                      <FiPlus size={13} /> Add sub-category
                    </button>
                  ))}

                  {(cat.subCategories || []).length === 0 && activeSubCatInputId !== cat.id && !isAdmin && (
                    <span className="subcat-empty">None yet</span>
                  )}
                </div>
                {activeSubCatInputId === cat.id && newSubCatNameError && (
                  <p className="settings-field-error">{newSubCatNameError}</p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </>);
}
