/* eslint-disable react-refresh/only-export-components */
import { createContext, useState } from 'react';

export const AccountContext = createContext();

export function AccountProvider({ children }) {
  const [selectedAccountId, setSelectedAccountId] = useState(null);

  return (
    <AccountContext.Provider value={{ selectedAccountId, setSelectedAccountId }}>
      {children}
    </AccountContext.Provider>
  );
}
