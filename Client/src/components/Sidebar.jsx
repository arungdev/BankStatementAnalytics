import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  FiGrid, FiUsers, FiRepeat, FiUpload,
  FiChevronDown, FiChevronRight, FiPlus,
  FiTrendingUp, FiPieChart,
  FiChevronsLeft, FiChevronsRight,
} from 'react-icons/fi';
import './Sidebar.css';

const Sidebar = ({ accounts = [], selectedAccountId, onAccountChange, onAddAccount }) => {
  const [isOpen, setIsOpen]       = useState(true);
  const [isDashOpen, setDashOpen] = useState(true);

  return (
    <aside className={`sidebar ${isOpen ? 'sidebar--open' : 'sidebar--closed'}`}>

      {/* Header */}
      <div className="sidebar-header">
        <div className="brand-icon">
          <FiTrendingUp size={16} />
        </div>
        {isOpen && <span className="brand-label">Bank Analytics</span>}
        <button
          className="sidebar-toggle"
          onClick={() => setIsOpen(p => !p)}
          title={isOpen ? 'Collapse' : 'Expand'}
        >
          {isOpen ? <FiChevronsLeft size={15} /> : <FiChevronsRight size={15} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <ul>

          {/* Dashboard */}
          <li>
            <div
              className="nav-item-header"
              onClick={() => isOpen && setDashOpen(p => !p)}
              title="Dashboard"
            >
              <FiGrid size={16} />
              {isOpen && (
                <>
                  <span>Dashboard</span>
                  <span className="chevron">
                    {isDashOpen ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
                  </span>
                </>
              )}
            </div>

            {(isDashOpen || !isOpen) && (
              <ul className={`submenu${!isOpen ? ' submenu--compact' : ''}`}>
                <li>
                  <NavLink to="/trends" title="Trends">
                    <FiTrendingUp size={!isOpen ? 16 : 13} />
                    {isOpen && <span>Trends</span>}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/insights" title="Insights">
                    <FiPieChart size={!isOpen ? 16 : 13} />
                    {isOpen && <span>Insights</span>}
                  </NavLink>
                </li>
              </ul>
            )}
          </li>

          {/* Merchants */}
          <li>
            <NavLink to="/merchants" className="nav-item-header" title="Merchants">
              <FiUsers size={16} />
              {isOpen && <span>Merchants</span>}
            </NavLink>
          </li>

          {/* Transactions */}
          <li>
            <NavLink to="/transactions" className="nav-item-header" title="Transactions">
              <FiRepeat size={16} />
              {isOpen && <span>Transactions</span>}
            </NavLink>
          </li>

          {/* Upload */}
          <li>
            <NavLink to="/upload" className="nav-item-header" title="Upload Statement">
              <FiUpload size={16} />
              {isOpen && <span>Upload Statement</span>}
            </NavLink>
          </li>

        </ul>
      </nav>

      {/* Account selector */}
      {isOpen && accounts.length > 0 && (
        <div className="sidebar-section">
          <p className="sidebar-section-title">Selected Account</p>
          <select
            className="account-select"
            value={selectedAccountId || ''}
            onChange={e => onAccountChange(Number(e.target.value))}
          >
            <option value="" disabled>Select an account...</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.accountHolderName || acc.bankName} ({acc.accountNumber?.slice(-4) || '****'})
              </option>
            ))}
          </select>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;