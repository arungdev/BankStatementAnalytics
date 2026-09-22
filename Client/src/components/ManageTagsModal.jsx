import { useState, useMemo } from "react";
import { FiPlus, FiEdit2, FiTrash2, FiSearch, FiCheck, FiX, FiTag } from "react-icons/fi";
import { Modal, Button } from "@common/client";
import api from "../api/client";

export default function ManageTagsModal({
  open,
  onClose,
  tags = [],
  onTagsUpdated,
  onTagRenamed,
  onTagDeleted,
}) {
  const [newTagName, setNewTagName] = useState("");
  const [newTagError, setNewTagError] = useState("");
  const [adding, setAdding] = useState(false);

  const [filterQuery, setFilterQuery] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteTag, setConfirmDeleteTag] = useState(null);

  const cleanName = (val) => {
    let s = (val || "").trim();
    if (s.startsWith("#")) s = s.slice(1).trim();
    return s;
  };

  const filteredTags = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, filterQuery]);

  const handleAddTag = async () => {
    const name = cleanName(newTagName);
    if (!name) {
      setNewTagError("Tag name is required.");
      return;
    }
    if (name.length > 50) {
      setNewTagError("Tag name can be at most 50 characters.");
      return;
    }
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      setNewTagError(`A tag named “${name}” already exists.`);
      return;
    }

    setAdding(true);
    setNewTagError("");
    try {
      const res = await api.post("/tags", { name });
      const created = res.data;
      const next = [...tags, created].sort((a, b) => a.name.localeCompare(b.name));
      onTagsUpdated?.(next);
      setNewTagName("");
    } catch (err) {
      console.error("Failed to create tag", err);
      setNewTagError(err.response?.data || "Failed to create tag.");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditError("");
  };

  const handleSaveEdit = async (tag) => {
    const name = cleanName(editName);
    if (!name) {
      setEditError("Tag name is required.");
      return;
    }
    if (name.length > 50) {
      setEditError("Tag name can be at most 50 characters.");
      return;
    }
    if (
      tags.some(
        (t) => t.id !== tag.id && t.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      setEditError(`A tag named “${name}” already exists.`);
      return;
    }

    setSavingEdit(true);
    setEditError("");
    try {
      await api.put(`/tags/${tag.id}`, { name });
      const oldName = tag.name;
      const next = tags
        .map((t) => (t.id === tag.id ? { ...t, name } : t))
        .sort((a, b) => a.name.localeCompare(b.name));
      onTagsUpdated?.(next);
      onTagRenamed?.(oldName, name);
      setEditingId(null);
    } catch (err) {
      console.error("Failed to update tag", err);
      setEditError(err.response?.data || "Failed to update tag.");
    } finally {
      setSavingEdit(false);
    }
  };

  const promptDelete = (tag) => {
    setConfirmDeleteTag(tag);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteTag) return;
    const { id, name } = confirmDeleteTag;
    setDeletingId(id);
    try {
      await api.delete(`/tags/${id}`);
      const next = tags.filter((t) => t.id !== id);
      onTagsUpdated?.(next);
      onTagDeleted?.(name);
      setConfirmDeleteTag(null);
    } catch (err) {
      console.error("Failed to delete tag", err);
      alert(err.response?.data || "Failed to delete tag. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Manage Tags">
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "320px", maxWidth: "480px" }}>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>
          Create, rename, or delete tags used across your transactions.
        </p>

        {/* Add new tag card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "12px",
            background: "var(--surface-2)",
            borderRadius: "8px",
            border: "1px solid var(--border-color)",
          }}
        >
          <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>
            Add a new tag
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              placeholder="e.g. Tax, Medical, Trip…"
              value={newTagName}
              onChange={(e) => {
                setNewTagName(e.target.value);
                setNewTagError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddTag();
              }}
              maxLength={50}
              className="field-input"
              style={{ flex: 1 }}
            />
            <Button
              variant="primary"
              onClick={handleAddTag}
              disabled={adding || !newTagName.trim()}
              style={{ display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
            >
              <FiPlus size={14} /> Add
            </Button>
          </div>
          {newTagError && (
            <p style={{ margin: 0, fontSize: "12px", color: "var(--danger)" }}>{newTagError}</p>
          )}
        </div>

        {/* Filter search if multiple tags */}
        {tags.length > 5 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 10px",
              background: "var(--surface)",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
            }}
          >
            <FiSearch size={14} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Filter tags…"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--text-main)",
                fontSize: "12px",
                outline: "none",
                width: "100%",
              }}
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery("")}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)" }}
              >
                <FiX size={13} />
              </button>
            )}
          </div>
        )}

        {/* Tag List */}
        <div
          style={{
            maxHeight: "280px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            paddingRight: "2px",
          }}
        >
          {filteredTags.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 8px", color: "var(--text-muted)", fontSize: "13px" }}>
              {filterQuery ? `No tags match “${filterQuery}”` : "No tags defined yet. Add one above."}
            </div>
          ) : (
            filteredTags.map((tag) => {
              const isEditing = editingId === tag.id;

              return (
                <div
                  key={tag.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color)",
                    background: "var(--surface)",
                    gap: "8px",
                  }}
                >
                  {isEditing ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => {
                            setEditName(e.target.value);
                            setEditError("");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit(tag);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          maxLength={50}
                          autoFocus
                          className="field-input"
                          style={{ flex: 1, padding: "4px 8px", fontSize: "13px" }}
                        />
                        <button
                          type="button"
                          className="btn primary small"
                          onClick={() => handleSaveEdit(tag)}
                          disabled={savingEdit}
                          title="Save tag"
                          style={{ padding: "4px 8px" }}
                        >
                          <FiCheck size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          onClick={cancelEdit}
                          title="Cancel edit"
                          style={{ padding: "4px 8px" }}
                        >
                          <FiX size={13} />
                        </button>
                      </div>
                      {editError && (
                        <p style={{ margin: 0, fontSize: "11px", color: "var(--danger)" }}>{editError}</p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            backgroundColor: "var(--primary-light, rgba(99, 102, 241, 0.08))",
                            color: "var(--primary)",
                            padding: "3px 8px",
                            borderRadius: "999px",
                            fontSize: "12px",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          #{tag.name}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          {tag.usageCount || 0} transaction{tag.usageCount === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <button
                          type="button"
                          className="btn icon small"
                          onClick={() => startEdit(tag)}
                          title="Rename tag"
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "6px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: "var(--text-muted)",
                          }}
                        >
                          <FiEdit2 size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn icon small"
                          onClick={() => promptDelete(tag)}
                          title="Delete tag"
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "6px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: "var(--danger)",
                          }}
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Delete confirmation dialog */}
        {confirmDeleteTag && (
          <div
            style={{
              padding: "12px",
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid var(--danger)",
              borderRadius: "8px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)" }}>
              Delete tag “#{confirmDeleteTag.name}”?
            </div>
            <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
              This will permanently delete the tag and remove it from {confirmDeleteTag.usageCount || 0} transaction{confirmDeleteTag.usageCount === 1 ? "" : "s"}.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                className="btn small"
                onClick={() => setConfirmDeleteTag(null)}
                disabled={deletingId != null}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger small"
                onClick={handleConfirmDelete}
                disabled={deletingId != null}
              >
                {deletingId != null ? "Deleting…" : "Delete Tag"}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "8px" }}>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
