import { useEffect, useState } from 'react';
import api from '../api/client';

export default function useAuthenticationOptions() {
  const [options, setOptions] = useState({ google: false, allowRegistration: false, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    api.get('/auth/options', { signal: controller.signal }).then(({ data }) => setOptions({ ...data, loading: false })).catch(() => {
      if (!controller.signal.aborted) setOptions({ google: false, allowRegistration: false, loading: false, unavailable: true });
    });
    return () => controller.abort();
  }, []);
  return options;
}
