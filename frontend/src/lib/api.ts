/**
 * Cliente HTTP da API do SYC Hub.
 * A sessão vai no cookie httpOnly gravado pelo login (credentials: 'include').
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api';

/** Chamado quando a API responde 401 (sessão expirada): o app volta para a tela de login */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar à API. Verifique se o backend está rodando.');
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  // 401 fora das rotas de login = sessão expirou
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Erro ${res.status}`, data?.details);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Erro inesperado';
