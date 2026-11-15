import { FiFolder } from 'react-icons/fi';

// Presentation shared by statement and GPay watch-folder settings. The caller
// owns navigation, selection and errors so each workflow keeps its own behavior.
export default function FolderBrowser({ browse, onNavigate, onSelect, onClose }) {
  return <div className="folder-browser">
    <div className="folder-browser-head">
      <span className="folder-browser-path">{browse.path || 'Quick access & drives'}</span>
      {browse.path && <button type="button" className="btn small" onClick={() => onNavigate(browse.parent)}>Up</button>}
      <button type="button" className="btn small" onClick={onClose}>Close</button>
    </div>
    {browse.error && <div role="alert" className="folder-browser-error">{browse.error}</div>}
    <div className="folder-browser-list">
      {browse.folders.length === 0
        ? <div className="folder-browser-empty">No subfolders</div>
        : browse.folders.map(folder => <button key={folder.path} type="button" className="btn small folder-browser-item"
          onClick={() => onNavigate(folder.path)}>
          <FiFolder size={12} style={{ flexShrink: 0 }} /> {folder.name}
        </button>)}
    </div>
    {browse.path && <button type="button" className="btn primary small" style={{ marginTop: 'var(--space-2)' }}
      onClick={() => onSelect(browse.path)}>Use this folder</button>}
  </div>;
}
