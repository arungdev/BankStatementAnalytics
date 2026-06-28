import { useState } from 'react';
import { FiSettings } from 'react-icons/fi';
import Settings from '../pages/Settings';

export default function Header({ children }) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      backgroundColor: '#fff',
      borderBottom: '1px solid #e5e7eb',
      minHeight: '64px',
      gap: '16px',
      position: 'relative',
      zIndex: 400,
      overflow: 'visible',
    }}>
      {/* Left slot — page title or filter bar from the active page */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', overflow: 'visible' }}>
        {children}
      </div>

      {/* Right — settings gear */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setIsSettingsOpen(true)}
          style={{
            cursor: 'pointer',
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#374151',
            transition: 'background-color 0.2s',
          }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
          onMouseOut={(e)  => e.currentTarget.style.backgroundColor = '#f3f4f6'}
          title="Settings"
        >
          <FiSettings size={20} />
        </button>
        <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      </div>
    </header>
  );
}