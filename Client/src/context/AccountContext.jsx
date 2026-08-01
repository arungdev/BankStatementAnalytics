/* eslint-disable react-refresh/only-export-components */
import { createContext } from 'react';
import { usePersistedState } from "@common/client";

export const AccountContext = createContext();

export function AccountProvider({ children }) {
  const [selectedAccountId, setSelectedAccountId] = usePersistedState('selectedAccountId', null);

  return (
    <AccountContext.Provider value={{ selectedAccountId, setSelectedAccountId }}>
      {children}
    </AccountContext.Provider>
  );
}
