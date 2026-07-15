/* eslint-disable react-refresh/only-export-components */
import { createContext } from 'react';
import usePersistedState from '../hooks/usePersistedState';
import { setAmountMasking } from '../utils/format';

export const PrivacyContext = createContext();

export function PrivacyProvider({ children }) {
  const [maskAmounts, setMaskAmounts] = usePersistedState('maskAmounts', false);

  // Sync during render (idempotent) so the formatters see the flag before
  // any child renders or effects (e.g. bill-reminder notifications) run.
  setAmountMasking(maskAmounts);

  return (
    <PrivacyContext.Provider value={{ maskAmounts, setMaskAmounts }}>
      {children}
    </PrivacyContext.Provider>
  );
}
