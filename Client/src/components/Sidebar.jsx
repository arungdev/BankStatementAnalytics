import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { FiGrid, FiUsers, FiRepeat, FiUpload, FiChevronDown, FiChevronRight, FiPlus, FiTrendingUp, FiPieChart } from 'react-icons/fi';
import './Sidebar.css';

const Sidebar = ({
  accounts = [],
  selectedAccountId,
  onAccountChange,
  onAddAccount,
}) => {
  const [isDashboardOpen, setDashboardOpen] = useState(true);

  const toggleDashboardMenu = () => {
    setDashboardOpen(!isDashboardOpen);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-icon">
          <FiTrendingUp size={24} />
        </div>
        <span>Bank Analytics</span>
      </div>
      <nav className="sidebar-nav">
        <ul>
          <li>
            <div className="nav-item-header" onClick={toggleDashboardMenu}>
              <FiGrid />
              <span>Dashboard</span>
              <span className="chevron">
                {isDashboardOpen ? <FiChevronDown /> : <FiChevronRight />}
              </span>
            </div>
            {isDashboardOpen && (
              <ul className="submenu">
                <li>
                  <NavLink to="/dashboard" end>
                    Overview
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/trends">
                    Trends
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/insights">
                    <FiPieChart size={14} />
                    Insights
                  </NavLink>
                </li>
              </ul>
            )}
          </li>
          <li>
            <NavLink to="/merchants" className="nav-item-header">
              <FiUsers />
              <span>Merchants</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/transactions" className="nav-item-header">
              <FiRepeat />
              <span>Transactions</span>
            </NavLink>
          </li>
          <li>
             <NavLink to="/upload" className="nav-item-header">
              <FiUpload />
              <span>Upload Statement</span>
            </NavLink>
          </li>
        </ul>
      </nav>

      <div className="sidebar-section">
        <p className="sidebar-section-title">Selected Account</p>
        {accounts.length === 0 ? (
          <div className="account-item-placeholder">No accounts found</div>
        ) : (
          <select 
            className="account-select"
            value={selectedAccountId || ''}
            onChange={(e) => onAccountChange(Number(e.target.value))}
          >
            <option value="" disabled>Select an account...</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.accountHolderName || acc.bankName} ({acc.accountNumber?.slice(-4) || '****'})
              </option>
            ))}
          </select>
        )}
      </div>

      <button className="sidebar-add-btn" onClick={onAddAccount}>
        <FiPlus size={16} />
        <span>Add Account</span>
      </button>
    </aside>
  );
};

export default Sidebar;