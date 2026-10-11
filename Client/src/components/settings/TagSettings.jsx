import { FiPlus, FiBookmark, FiEdit2 } from "react-icons/fi";

export default function TagSettings({ editTagName, editTagNameError, editingTagId, handleAddTag, handleDeleteTag, handleUpdateTag, isAdmin, newTagError, newTagName, setEditTagName, setEditTagNameError, setEditingTagId, setNewTagError, setNewTagName, tags }) {
  return (<>
      {isAdmin && (
        <div className="settings-add-card">
          <label className="settings-add-card-label" htmlFor="new-tag">Add a new tag</label>
          <div className="settings-add-row">
            <input
              id="new-tag"
              type="text"
              placeholder="e.g. Tax, Medical, Trip, Reimbursable…"
              value={newTagName}
              onChange={(e) => { setNewTagName(e.target.value); setNewTagError(""); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(); }}
              maxLength={50}
              className="field-input"
              style={{ flex: 1 }}
            />
            <button className="btn primary" style={{ whiteSpace: 'nowrap' }} onClick={handleAddTag}>
              <FiPlus size={15} /> Add
            </button>
          </div>
          {newTagError && <p className="settings-field-error">{newTagError}</p>}
        </div>
      )}

      {tags.length === 0 ? (
        <div className="settings-empty">
          <FiBookmark size={36} />
          <div className="settings-empty-title">No tags defined</div>
          <div className="settings-empty-sub">
            {isAdmin ? 'Add one above to start labeling your transactions.' : 'No tags have been added.'}
          </div>
        </div>
      ) : (
        <div className="settings-stack" id="set-tags-list">
          {tags.map(tag => (
            <section key={tag.id} className="setting-card">
              <div className="setting-card-head">
                {editingTagId === tag.id ? (
                  <div style={{ flex: 1 }}>
                    <div className="settings-inline-edit">
                      <input
                        type="text"
                        value={editTagName}
                        onChange={(e) => { setEditTagName(e.target.value); setEditTagNameError(""); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateTag(tag.id);
                          if (e.key === 'Escape') { e.stopPropagation(); setEditingTagId(null); setEditTagNameError(""); }
                        }}
                        maxLength={50}
                        autoFocus
                        className="field-input"
                        style={{ flex: 1 }}
                        aria-label="Tag name"
                      />
                      <button className="btn primary small" onClick={() => handleUpdateTag(tag.id)}>Save</button>
                      <button className="btn small" onClick={() => { setEditingTagId(null); setEditTagNameError(""); }}>Cancel</button>
                    </div>
                    {editTagNameError && <p className="settings-field-error">{editTagNameError}</p>}
                  </div>
                ) : (
                  <>
                    <div className="setting-card-text">
                      <h3 className="setting-card-title">
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          backgroundColor: 'var(--primary-light, rgba(99, 102, 241, 0.08))',
                          color: 'var(--primary)',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          fontSize: '13px',
                          fontWeight: 600,
                        }}>
                          #{tag.name}
                        </span>
                        {isAdmin && (
                          <button
                            className="settings-edit-link"
                            title="Rename tag"
                            aria-label={`Rename ${tag.name}`}
                            onClick={() => { setEditingTagId(tag.id); setEditTagName(tag.name); setEditTagNameError(""); }}
                          >
                            <FiEdit2 size={14} />
                          </button>
                        )}
                      </h3>
                      <p className="setting-card-desc">
                        {tag.usageCount || 0} transaction{tag.usageCount === 1 ? '' : 's'} with this tag
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="setting-card-control">
                        <button className="btn danger small" onClick={() => handleDeleteTag(tag.id, tag.name, tag.usageCount)}>Delete</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </>);
}
