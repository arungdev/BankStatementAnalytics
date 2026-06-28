import { useState, useEffect } from 'react';
import api from '../api/client';
import Header from '../components/Header';
import Insights from '../pages/Insights';
import { InsightsHeader } from '../pages/Insights';

const toISODate = (d) => d ? d.toISOString().split('T')[0] : null;

export default function InsightsLayout() {
  const [accounts, setAccounts]              = useState([]);
  const [selectedAccountIds, setSelectedIds] = useState([]);
  const [range, setRange]                    = useState({ start: null, end: null, preset: 'ALL', label: 'All Time' });
  const [groupBy, setGroupBy]                = useState('byCategory');

  useEffect(() => {
    api.get('/statements/accounts')
      .then(res => {
        const list = res.data || [];
        setAccounts(list);
        if (list.length > 0) setSelectedIds(list.map(a => a.id));
      })
      .catch(err => console.error('Failed to load accounts', err));
  }, []);

  const toggleAccount = (id) =>
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );

  return (
    <>
      <Header>
        <InsightsHeader
          accounts={accounts}
          selectedAccountIds={selectedAccountIds}
          toggleAccount={toggleAccount}
          range={range}
          setRange={setRange}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
        />
      </Header>

      <Insights
        accounts={accounts}
        selectedAccountIds={selectedAccountIds}
        range={range}
        groupBy={groupBy}
      />
    </>
  );
}