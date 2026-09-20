import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiSearch, FiArrowRight, FiTag, FiCalendar, FiX } from 'react-icons/fi';
import api from '../api/client';
import { currencyFormatter as fmt, maskName, isAmountMasked, MASKED_AMOUNT } from '../utils/format';

export default function SearchModal({ isOpen, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ transactions: [], merchants: [], navigation: [] });
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults({ transactions: [], merchants: [], navigation: [] });
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResults({ transactions: [], merchants: [], navigation: [] });
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      api.get(`/search?q=${encodeURIComponent(query.trim())}`)
        .then(res => {
          setResults(res.data || { transactions: [], merchants: [], navigation: [] });
          setSelectedIndex(0);
        })
        .catch(err => console.error('Search error', err))
        .finally(() => setLoading(false));
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  // Flatten items for keyboard navigation
  const flatItems = [
    ...(results.navigation || []).map(item => ({ type: 'nav', data: item })),
    ...(results.merchants || []).map(item => ({ type: 'merchant', data: item })),
    ...(results.transactions || []).map(item => ({ type: 'tx', data: item })),
  ];

  const handleSelect = (item) => {
    if (!item) return;
    onClose();
    if (item.type === 'nav') {
      navigate(item.data.path);
    } else if (item.type === 'merchant') {
      navigate(`/transactions?q=${encodeURIComponent(item.data.name)}`);
    } else if (item.type === 'tx') {
      navigate(`/transactions?q=${encodeURIComponent(item.data.bankReference || item.data.description)}`);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < flatItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : Math.max(0, flatItems.length - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[selectedIndex]) {
        handleSelect(flatItems[selectedIndex]);
      }
    }
  };

  if (!isOpen) return null;

  let currentIndex = 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '10vh',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '640px',
          maxWidth: '92vw',
          maxHeight: '75vh',
          background: 'var(--surface)',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-color)',
          gap: '12px',
        }}>
          <FiSearch size={20} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search transactions, merchants, amounts, or jump to page..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '16px',
              color: 'var(--text-main)',
              fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: '4px',
              }}
            >
              <FiX size={16} />
            </button>
          )}
          <span style={{
            fontSize: '11px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            padding: '2px 6px',
            color: 'var(--text-muted)',
            fontWeight: 600,
          }}>
            ESC
          </span>
        </div>

        {/* Results Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          {loading && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              Searching across transactions and merchants...
            </div>
          )}

          {!loading && !query && (
            <div style={{ padding: '16px 12px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '10px' }}>
                Quick Jump
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                {[
                  { label: 'Overview', path: '/' },
                  { label: 'Transactions', path: '/transactions' },
                  { label: 'Trends & Heatmap', path: '/trends' },
                  { label: 'Goals', path: '/goals' },
                  { label: 'Bills & Subs', path: '/bills' },
                  { label: 'Reports', path: '/reports' },
                ].map(p => (
                  <button
                    key={p.path}
                    onClick={() => { onClose(); navigate(p.path); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      color: 'var(--text-main)',
                      fontSize: '13px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span>{p.label}</span>
                    <FiArrowRight size={12} style={{ color: 'var(--text-muted)' }} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {!loading && query && flatItems.length === 0 && (
            <div style={{ padding: '36px 20px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>No results found</p>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                Try searching for a different merchant, amount, or tag
              </p>
            </div>
          )}

          {/* Navigation matches */}
          {results.navigation?.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '0 8px 6px' }}>
                Pages
              </div>
              {results.navigation.map(nav => {
                const isSelected = currentIndex === selectedIndex;
                const thisIdx = currentIndex++;
                return (
                  <div
                    key={nav.path}
                    onClick={() => handleSelect({ type: 'nav', data: nav })}
                    onMouseEnter={() => setSelectedIndex(thisIdx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      background: isSelected ? 'var(--primary-light)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: isSelected ? 'var(--primary)' : 'var(--text-main)' }}>
                        {nav.title}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{nav.description}</div>
                    </div>
                    <FiArrowRight size={14} style={{ color: isSelected ? 'var(--primary)' : 'var(--text-muted)' }} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Merchant matches */}
          {results.merchants?.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '0 8px 6px' }}>
                Merchants
              </div>
              {results.merchants.map(m => {
                const isSelected = currentIndex === selectedIndex;
                const thisIdx = currentIndex++;
                return (
                  <div
                    key={m.id}
                    onClick={() => handleSelect({ type: 'merchant', data: m })}
                    onMouseEnter={() => setSelectedIndex(thisIdx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      background: isSelected ? 'var(--primary-light)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FiTag size={13} style={{ color: 'var(--primary)' }} />
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                        {maskName(m.name)}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '12px',
                        color: 'var(--text-muted)',
                      }}>
                        {m.category}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Filter transactions →</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Transaction matches */}
          {results.transactions?.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '0 8px 6px' }}>
                Transactions ({results.transactions.length})
              </div>
              {results.transactions.map(t => {
                const isSelected = currentIndex === selectedIndex;
                const thisIdx = currentIndex++;
                const isCredit = t.credit > 0;
                const amt = isCredit ? t.credit : t.debit;
                const displayAmt = isAmountMasked() ? MASKED_AMOUNT : fmt.format(amt);
                const dt = new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

                return (
                  <div
                    key={`${t.accountId}-${t.bankReference}-${t.date}`}
                    onClick={() => handleSelect({ type: 'tx', data: t })}
                    onMouseEnter={() => setSelectedIndex(thisIdx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      background: isSelected ? 'var(--primary-light)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                      gap: '12px',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontSize: '13px',
                          fontWeight: 700,
                          color: 'var(--text-main)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {maskName(t.merchant || t.description || 'Transaction')}
                        </span>
                        <span style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '10px',
                          background: 'var(--surface-2)',
                          color: 'var(--text-muted)',
                        }}>
                          {t.category}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', fontSize: '11px', color: 'var(--text-muted)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <FiCalendar size={11} /> {dt}
                        </span>
                        {t.narration && (
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            · {t.narration}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="tnum" style={{
                      fontWeight: 800,
                      fontSize: '13px',
                      color: isCredit ? 'var(--success)' : 'var(--text-main)',
                      flexShrink: 0,
                    }}>
                      {isCredit ? '+' : '−'}{displayAmt}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--surface-2)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '11px',
          color: 'var(--text-muted)',
        }}>
          <div style={{ display: 'flex', gap: '14px' }}>
            <span><kbd style={{ padding: '1px 4px', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: '3px' }}>↑</kbd> <kbd style={{ padding: '1px 4px', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: '3px' }}>↓</kbd> to navigate</span>
            <span><kbd style={{ padding: '1px 4px', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: '3px' }}>↵</kbd> to select</span>
          </div>
          <span>Tip: Type an amount or merchant</span>
        </div>
      </div>
    </div>
  );
}
