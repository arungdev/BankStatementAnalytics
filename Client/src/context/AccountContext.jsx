/* eslint-disable react-refresh/only-export-components */
import { createContext, useState } from 'react';
import { useAuth, usePersistedState } from "@common/client";
import { resolveAccountSelection } from '../utils/accountSelection';

export const AccountContext = createContext();

export function AccountProvider({ children }) {
  const { username } = useAuth();
  return <WorkspaceAccounts key={username || 'anonymous'}>{children}</WorkspaceAccounts>;
}

function WorkspaceAccounts({ children }) {
  const [savedAccountId, setSelectedAccountId] = usePersistedState('selectedAccountId', null);
  const [availableAccounts, setAvailableAccounts] = useState([]);
  const selectedAccountId = resolveAccountSelection(savedAccountId, availableAccounts);

  return (
    <AccountContext.Provider value={{ selectedAccountId, setSelectedAccountId, setAvailableAccounts }}>
      {children}
    </AccountContext.Provider>
  );
}
