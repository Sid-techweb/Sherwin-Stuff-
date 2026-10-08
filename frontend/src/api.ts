const TOKEN_KEY = 'bmw_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface Meta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  cache?: 'HIT' | 'MISS';
}

type Query = Record<string, string | number | boolean | undefined | null>;

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query } = {},
): Promise<{ data: T; meta: Meta }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = `/api${path}${qs.toString() ? `?${qs}` : ''}`;
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Is the API running?');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    if (res.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event('bmw:unauthorized'));
    }
    const e = json?.error;
    const fieldErrors = e?.details?.fieldErrors as Record<string, string[]> | undefined;
    const detail = fieldErrors ? Object.entries(fieldErrors).map(([f, m]) => `${f}: ${m.join(', ')}`).join('; ') : '';
    throw new ApiError(res.status, e?.code ?? 'ERROR', detail ? `${e.message} (${detail})` : (e?.message ?? `Request failed (${res.status})`), e?.details);
  }
  return { data: json.data as T, meta: json.meta ?? {} };
}
