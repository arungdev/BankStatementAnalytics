import { useContext } from 'react';
import { useAuth, usePreference } from '@common/client';
import { AccountContext } from '../context/AccountContext';
import { viewPreferenceKey } from '../utils/viewPreferences';

// Only the application knows which identity and account own a preference.
export default function usePagePreference(page, field, initialValue, options = {}) {
  const { username } = useAuth();
  const account = useContext(AccountContext);
  const key = viewPreferenceKey(username, options.scope ?? account?.selectedAccountId ?? 'pending', page, field);
  return usePreference(key, initialValue, options);
}
