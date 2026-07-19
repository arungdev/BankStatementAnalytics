/* eslint-disable react-refresh/only-export-components */
import { createContext } from 'react';
import usePersistedState from '../hooks/usePersistedState';
import { setAmountMasking, setNameMasking } from '../utils/format';

export const PrivacyContext = createContext();

export function PrivacyProvider({ children }) {
  const [maskAmounts, setMaskAmounts] = usePersistedState('maskAmounts', false);
  // Settings → Privacy: whether the eye toggle also hides merchant/bill names.
  const [maskNamesEnabled, setMaskNamesEnabled] = usePersistedState('maskNamesEnabled', false);

  // Sync during render (idempotent) so the formatters see the flags before
  // any child renders or effects (e.g. bill-reminder notifications) run.
  setAmountMasking(maskAmounts);
  setNameMasking(maskAmounts && maskNamesEnabled);

  return (
    <PrivacyContext.Provider value={{ maskAmounts, setMaskAmounts, maskNamesEnabled, setMaskNamesEnabled }}>
      {children}
    </PrivacyContext.Provider>
  );
}
