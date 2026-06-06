import { useState } from 'react';
import { FiSettings } from 'react-icons/fi';
import Settings from '../pages/Settings'; // Adjust path if your pages folder is elsewhere

export default function Header() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <header style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 24px', backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ position: 'relative' }}>
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
            transition: 'background-color 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
          title="Settings"
        >
          <FiSettings size={20} />
        </button>

        <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      </div>
    </header>
  );
}