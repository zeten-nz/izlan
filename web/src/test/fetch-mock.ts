import { vi } from 'vitest';

export interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeResponseInit {
  status?: number;
  body?: unknown;
}

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Install a fetch mock. `handler(call)` returns a {status, body} or a Response. Records every call for assertions.
 * Header keys are lowercased for stable lookup.
 */
export function installFetchMock(handler: (call: MockCall) => FakeResponseInit | Response) {
  const calls: MockCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = v;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    const call: MockCall = { url, method: (init?.method ?? 'GET').toUpperCase(), headers, body };
    calls.push(call);
    const out = handler(call);
    if (out && 'ok' in out) return out as Response;
    const r = out as FakeResponseInit;
    return fakeResponse(r.status ?? 200, r.body);
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return {
    calls,
    countMatching: (pred: (c: MockCall) => boolean) => calls.filter(pred).length,
    fn,
  };
}
