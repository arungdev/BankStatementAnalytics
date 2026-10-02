import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  FiGrid, FiUsers, FiRepeat,
  FiChevronDown, FiChevronRight,
  FiTrendingUp, FiPieChart, FiLogOut,
  FiChevronsLeft, FiChevronsRight, FiBell, FiHome, FiTarget,
  FiDollarSign, FiSun, FiMoon, FiMonitor, FiFileText, FiSettings,
  FiShuffle, FiFlag, FiX, FiScissors,
} from 'react-icons/fi';
import { useAuth, useTheme } from "@common/client";
import api from '../api/client';
import './Sidebar.css';

const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' };
const THEME_META = {
  system: { icon: FiMonitor, label: 'Theme: System' },
  light:  { icon: FiSun,     label: 'Theme: Light' },
  dark:   { icon: FiMoon,    label: 'Theme: Dark' },
};

const DESKTOP_BREAKPOINT = 1024;

const Sidebar = ({ mobileOpen = false, onMobileClose }) => {
  const [isOpen, setIsOpen]       = useState(() => typeof window === 'undefined' || window.innerWidth > DESKTOP_BREAKPOINT);
  const [isDashOpen, setDashOpen] = useState(true);
  const [upcomingBills, setUpcomingBills] = useState(0);
  const [hasUpdate, setHasUpdate] = useState(false);
  const { username, role, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const ThemeIcon = THEME_META[preference]?.icon || FiMonitor;
  const themeLabel = THEME_META[preference]?.label || 'Theme';

  // Effective open: expanded on desktop, or open as drawer on mobile
  const effectiveOpen = mobileOpen || isOpen;

  // Auto-collapse on desktop viewport resizing
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= DESKTOP_BREAKPOINT) {
        onMobileClose?.();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [onMobileClose]);

  // Badge: how many confirmed bills are due soon and unpaid
  useEffect(() => {
    api.get('/bills/upcoming')
      .then(res => setUpcomingBills((res.data || []).length))
      .catch(() => setUpcomingBills(0));
  }, []);

  // Software update badge
  useEffect(() => {
    api.get('/update/status')
      .then(res => setHasUpdate(!!res.data?.updateInfo?.isUpdateAvailable))
      .catch(() => setHasUpdate(false));
  }, []);

  const handleNavClick = () => {
    onMobileClose?.();
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${isOpen ? 'sidebar--open' : 'sidebar--closed'} ${mobileOpen ? 'sidebar--mobile-open' : ''}`}>

        {/* Header */}
        <div className="sidebar-header">
          <div className="brand-icon">
            <img src="/icon-192.png" alt="Bank Analytics" />
          </div>
          {effectiveOpen && <span className="brand-label">Bank Analytics</span>}

          {/* Desktop collapse toggle */}
          <button
            className="sidebar-toggle"
            onClick={() => setIsOpen(p => !p)}
            title={isOpen ? 'Collapse' : 'Expand'}
            aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {isOpen ? <FiChevronsLeft size={15} /> : <FiChevronsRight size={15} />}
          </button>

          {/* Mobile close button */}
          <button
            className="sidebar-close-btn"
            onClick={onMobileClose}
            title="Close menu"
            aria-label="Close navigation menu"
          >
            <FiX size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          <ul>

            {/* Dashboard */}
            <li>
              <div
                className="nav-item-header"
                onClick={() => effectiveOpen && setDashOpen(p => !p)}
                title="Dashboard"
              >
                <FiGrid size={16} />
                {effectiveOpen && (
                  <>
                    <span>Dashboard</span>
                    <span className="chevron">
                      {isDashOpen ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
                    </span>
                  </>
                )}
              </div>

              {(isDashOpen || !effectiveOpen) && (
                <ul className={`submenu${!effectiveOpen ? ' submenu--compact' : ''}`}>
                  <li>
                    <NavLink to="/" end title="Overview" onClick={handleNavClick}>
                      <FiHome size={!effectiveOpen ? 16 : 13} />
                      {effectiveOpen && <span>Overview</span>}
                    </NavLink>
                  </li>
                  <li>
                    <NavLink to="/trends" title="Trends" onClick={handleNavClick}>
                      <FiTrendingUp size={!effectiveOpen ? 16 : 13} />
                      {effectiveOpen && <span>Trends</span>}
                    </NavLink>
                  </li>
                  <li>
                    <NavLink to="/insights" title="Insights" onClick={handleNavClick}>
                      <FiPieChart size={!effectiveOpen ? 16 : 13} />
                      {effectiveOpen && <span>Insights</span>}
                    </NavLink>
                  </li>
                  <li>
                    <NavLink to="/reports" title="Reports" onClick={handleNavClick}>
                      <FiFileText size={!effectiveOpen ? 16 : 13} />
                      {effectiveOpen && <span>Reports</span>}
                    </NavLink>
                  </li>
                </ul>
              )}
            </li>

            {/* ── Activity ── */}
            <li className="nav-group-label" aria-hidden={!effectiveOpen}>
              {effectiveOpen ? 'Activity' : <span className="nav-group-rule" />}
            </li>

            {/* Transactions */}
            <li>
              <NavLink to="/transactions" className="nav-item-header" title="Transactions" onClick={handleNavClick}>
                <FiRepeat size={16} />
                {effectiveOpen && <span>Transactions</span>}
              </NavLink>
            </li>

            {/* Merchants */}
            <li>
              <NavLink to="/merchants" className="nav-item-header" title="Merchants" onClick={handleNavClick}>
                <FiUsers size={16} />
                {effectiveOpen && <span>Merchants</span>}
              </NavLink>
            </li>

            {/* Transfers */}
            <li>
              <NavLink to="/transfers" className="nav-item-header" title="Transfers between your accounts" onClick={handleNavClick}>
                <FiShuffle size={16} />
                {effectiveOpen && <span>Transfers</span>}
              </NavLink>
            </li>

            {/* Bill Splits & Groups */}
            <li>
              <NavLink to="/splits" className="nav-item-header" title="GPay & Bill Splits" onClick={handleNavClick}>
                <FiScissors size={16} />
                {effectiveOpen && <span>Bill Splits</span>}
              </NavLink>
            </li>

            {/* ── Planning ── */}
            <li className="nav-group-label" aria-hidden={!effectiveOpen}>
              {effectiveOpen ? 'Planning' : <span className="nav-group-rule" />}
            </li>

            {/* Budgets */}
            <li>
              <NavLink to="/budgets" className="nav-item-header" title="Budgets" onClick={handleNavClick}>
                <FiTarget size={16} />
                {effectiveOpen && <span>Budgets</span>}
              </NavLink>
            </li>

            {/* Goals */}
            <li>
              <NavLink to="/goals" className="nav-item-header" title="Savings Goals" onClick={handleNavClick}>
                <FiFlag size={16} />
                {effectiveOpen && <span>Goals</span>}
              </NavLink>
            </li>

            {/* Bills & Reminders */}
            <li>
              <NavLink to="/bills" className="nav-item-header" title="Bills & Reminders" onClick={handleNavClick}>
                <FiBell size={16} />
                {effectiveOpen && <span>Bills</span>}
                {upcomingBills > 0 && (
                  <span
                    style={{
                      marginLeft: effectiveOpen ? 'auto' : 0,
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
              <NavLink to="/investments" className="nav-item-header" title="Investments" onClick={handleNavClick}>
                <FiDollarSign size={16} />
                {effectiveOpen && <span>Investments</span>}
              </NavLink>
            </li>

          </ul>
        </nav>

        {/* Current user + logout */}
        {username && (
          <div className="sidebar-section" style={{ marginTop: 'auto' }}>
            {effectiveOpen && (
              <p className="sidebar-section-title" style={{ marginBottom: '4px' }}>
                {username} · {role}
              </p>
            )}
            <NavLink
              to={hasUpdate ? "/settings?tab=updates" : "/settings"}
              className="nav-item-header"
              title={hasUpdate ? "Settings (New version available)" : "Settings"}
              onClick={handleNavClick}
            >
              <FiSettings size={16} />
              {effectiveOpen && <span>Settings</span>}
              {hasUpdate && (
                <span
                  style={{
                    marginLeft: 'auto',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--primary, #6366f1)',
                    boxShadow: '0 0 0 2px var(--surface, #fff)',
                    display: 'inline-block',
                  }}
                  title="Update available"
                />
              )}
            </NavLink>
            <button
              className="nav-item-header"
              style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer' }}
              onClick={() => {
                setPreference(THEME_CYCLE[preference] || 'system');
              }}
              title={themeLabel}
            >
              <ThemeIcon size={16} />
              {effectiveOpen && <span>{themeLabel}</span>}
            </button>
            <button
              className="nav-item-header"
              style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer' }}
              onClick={() => {
                handleNavClick();
                logout();
              }}
              title="Log out"
            >
              <FiLogOut size={16} />
              {effectiveOpen && <span>Log out</span>}
            </button>
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;