import { isCancel } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/axios';
import { toApiError, type ApiError } from '../api/errors';

interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
}

/**
 * GETs `path?query` and refetches whenever either changes. The previous request is aborted, so a slow
 * response can never overwrite a newer one. The last data stays on screen while the next request loads.
 * `query` is a preserialized string, so repeated keys (`status=A&status=B`) reach the API untouched.
 */
export function useApi<T>(path: string, query = '') {
  const [state, setState] = useState<ApiState<T>>({ data: undefined, error: undefined, loading: true });
  const [reloadCount, setReloadCount] = useState(0);
  const url = query ? `${path}?${query}` : path;

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true }));
    api
      .get<T>(url, { signal: controller.signal })
      .then(({ data }) => setState({ data, error: undefined, loading: false }))
      .catch((error: unknown) => {
        if (!isCancel(error)) setState({ data: undefined, error: toApiError(error), loading: false });
      });
    return () => controller.abort();
  }, [url, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);
  return { ...state, reload };
}
