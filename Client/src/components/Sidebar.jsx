import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  FiGrid, FiUsers, FiRepeat,
  FiChevronDown, FiChevronRight,
  FiTrendingUp, FiPieChart, FiLogOut,
  FiChevronsLeft, FiChevronsRight, FiBell, FiHome, FiTarget,
  FiDollarSign, FiSun, FiMoon, FiMonitor, FiFileText, FiSettings,
  FiShuffle,
} from 'react-icons/fi';
import { useAuth } from '../context/useAuth';
import useTheme from '../context/useTheme';
import api from '../api/client';
import './Sidebar.css';

const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' };
const THEME_META = {
  system: { icon: FiMonitor, label: 'Theme: System' },
  light:  { icon: FiSun,     label: 'Theme: Light' },
  dark:   { icon: FiMoon,    label: 'Theme: Dark' },
};

const NARROW_BREAKPOINT = 900;

const Sidebar = () => {
  const [isOpen, setIsOpen]       = useState(() => typeof window === 'undefined' || window.innerWidth > NARROW_BREAKPOINT);
  const [isDashOpen, setDashOpen] = useState(true);
  const [upcomingBills, setUpcomingBills] = useState(0);
  const { username, role, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const ThemeIcon = THEME_META[preference]?.icon || FiMonitor;
  const themeLabel = THEME_META[preference]?.label || 'Theme';

  // ── Auto-collapse on narrow viewports; user can still toggle manually ──
  useEffect(() => {
    const handleResize = () => setIsOpen(window.innerWidth > NARROW_BREAKPOINT);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── Badge: how many confirmed bills are due soon and unpaid ──
  useEffect(() => {
    api.get('/bills/upcoming')
      .then(res => setUpcomingBills((res.data || []).length))
      .catch(() => setUpcomingBills(0));
  }, []);

  return (
    <aside className={`sidebar ${isOpen ? 'sidebar--open' : 'sidebar--closed'}`}>

      {/* Header */}
      <div className="sidebar-header">
        <div className="brand-icon">
          <img src="/icon-192.png" alt="Bank Analytics" />
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
                  <NavLink to="/" end title="Overview">
                    <FiHome size={!isOpen ? 16 : 13} />
                    {isOpen && <span>Overview</span>}
                  </NavLink>
                </li>
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
                <li>
                  <NavLink to="/reports" title="Reports">
                    <FiFileText size={!isOpen ? 16 : 13} />
                    {isOpen && <span>Reports</span>}
                  </NavLink>
                </li>
              </ul>
            )}
          </li>

          {/* ── Activity ── */}
          <li className="nav-group-label" aria-hidden={!isOpen}>
            {isOpen ? 'Activity' : <span className="nav-group-rule" />}
          </li>

          {/* Transactions */}
          <li>
            <NavLink to="/transactions" className="nav-item-header" title="Transactions">
              <FiRepeat size={16} />
              {isOpen && <span>Transactions</span>}
            </NavLink>
          </li>

          {/* Merchants */}
          <li>
            <NavLink to="/merchants" className="nav-item-header" title="Merchants">
              <FiUsers size={16} />
              {isOpen && <span>Merchants</span>}
            </NavLink>
          </li>

          {/* Transfers */}
          <li>
            <NavLink to="/transfers" className="nav-item-header" title="Transfers between your accounts">
              <FiShuffle size={16} />
              {isOpen && <span>Transfers</span>}
            </NavLink>
          </li>

          {/* ── Planning ── */}
          <li className="nav-group-label" aria-hidden={!isOpen}>
            {isOpen ? 'Planning' : <span className="nav-group-rule" />}
          </li>

          {/* Budgets */}
          <li>
            <NavLink to="/budgets" className="nav-item-header" title="Budgets">
              <FiTarget size={16} />
              {isOpen && <span>Budgets</span>}
            </NavLink>
          </li>

          {/* Bills & Reminders */}
          <li>
            <NavLink to="/bills" className="nav-item-header" title="Bills & Reminders">
              <FiBell size={16} />
              {isOpen && <span>Bills</span>}
              {upcomingBills > 0 && (
                <span
                  style={{
                    marginLeft: isOpen ? 'auto' : 0,
                    background: '#ef4444',
                    color: '#fff',
                    borderRadius: '999px',
                    fontSize: '10px',
                    fontWeight: 700,
                    minWidth: '16px',
                    height: '16px',
                    padding: '0 4px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {upcomingBills}
                </span>
              )}
            </NavLink>
          </li>

          {/* Investments */}
          <li>
            <NavLink to="/investments" className="nav-item-header" title="Investments">
              <FiDollarSign size={16} />
              {isOpen && <span>Investments</span>}
            </NavLink>
          </li>

        </ul>
      </nav>

      {/* Current user + logout */}
      {username && (
        <div className="sidebar-section" style={{ marginTop: 'auto' }}>
          {isOpen && (
            <p className="sidebar-section-title" style={{ marginBottom: '4px' }}>
              {username} · {role}
            </p>
          )}
          <NavLink to="/settings" className="nav-item-header" title="Settings">
            <FiSettings size={16} />
            {isOpen && <span>Settings</span>}
          </NavLink>
          <button
            className="nav-item-header"
            style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer' }}
            onClick={() => setPreference(THEME_CYCLE[preference] || 'system')}
            title={themeLabel}
          >
            <ThemeIcon size={16} />
            {isOpen && <span>{themeLabel}</span>}
          </button>
          <button
            className="nav-item-header"
            style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer' }}
            onClick={() => logout()}
            title="Log out"
          >
            <FiLogOut size={16} />
            {isOpen && <span>Log out</span>}
          </button>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;