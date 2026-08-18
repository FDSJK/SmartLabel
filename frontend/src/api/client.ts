const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public body?: unknown,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

  private async _raise(res: Response): Promise<never> {
    const body: unknown = await res.json().catch(() => null);
    const detail = this._detail(body, res.statusText);
    throw new ApiError(res.status, detail, body);
  }

  private _detail(body: unknown, fallback: string): string {
    if (body && typeof body === 'object' && 'detail' in body) {
      const d = (body as { detail: unknown }).detail;
      if (typeof d === 'string') return d;
      if (d != null) return JSON.stringify(d);
    }
    return fallback;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, { headers: this.headers() });
    if (!res.ok) return this._raise(res);
    return res.json();
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return this._raise(res);
    return res.json();
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return this._raise(res);
    return res.json();
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) return this._raise(res);
  }

  async uploadFiles<T>(path: string, files: File[]): Promise<T> {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    const h: Record<string, string> = {};
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: h,
      body: formData,
    });
    if (!res.ok) return this._raise(res);
    return res.json();
  }
}

export const apiClient = new ApiClient();
