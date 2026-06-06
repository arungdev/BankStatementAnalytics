import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import {
  FiHome,
  FiList,
  FiUsers,
  FiCreditCard,
  FiSearch,
  FiPlus,
  FiTrendingUp,
} from "react-icons/fi";

// Import pages
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Counterparties from "./pages/Counterparties";

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/counterparties" element={<Counterparties />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

function Layout({ children }) {
  const location = useLocation();

  const getPageTitle = (pathname) => {
    switch (pathname) {
      case "/": return "Dashboard";
      case "/transactions": return "Transactions";
      case "/counterparties": return "Counterparties";
      default: return "FinTrack";
    }
  };

  return (
    <div className="app">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <FiTrendingUp size={22} />
          </div>
          FinTrack
        </div>

        <nav className="nav">
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
            <FiHome /> Dashboard
          </Link>

          <Link to="/transactions" className={`nav-link ${location.pathname === '/transactions' ? 'active' : ''}`}>
            <FiList /> Transactions
          </Link>

          <Link to="/counterparties" className={`nav-link ${location.pathname === '/counterparties' ? 'active' : ''}`}>
            <FiUsers /> Counterparties
          </Link>
        </nav>

        <div className="accounts">
          <p className="section-title">Your Accounts</p>
          <div className="account-item">
            <FiCreditCard size={18} color="#4f46e5" />
            <span>IOB ****1234</span>
          </div>
          <div className="account-item">
            <FiCreditCard size={18} color="#10b981" />
            <span>SBI ****5678</span>
          </div>
        </div>

        <button className="addBtn">
          <FiPlus size={18} /> Add Account
        </button>
      </aside>

      {/* MAIN */}
      <main className="main">
        {/* TOPBAR */}
        <header className="topbar">
          <h2>{getPageTitle(location.pathname)}</h2>

          <div className="topbar-right">
            <div className="search">
              <FiSearch />
              <input placeholder="Search transactions, accounts..." />
            </div>
            <div className="avatar">AG</div>
          </div>
        </header>

        {/* CONTENT AREA */}
        <section className="content">
          {children}
        </section>
      </main>
    </div>
  );
}
