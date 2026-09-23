// Honoアプリをテストから叩くためのヘルパー。HTTPサーバーは立てず、app.request() で直接呼ぶ。
import app from '../../src/worker/index';
import type { Env } from '../../src/worker/env';
import { createTestDb } from './d1';

export const ADMIN_TOKEN = 'test-admin-token';
export const MCP_TOKEN = 'test-mcp-token';
export const VIEWER_TOKEN = 'test-viewer-token';

export interface TestClient {
  env: Env;
  /** waitUntil に渡された処理（シート追記など）がすべて終わるのを待つ */
  settle(): Promise<void>;
  request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response>;
  admin(method: string, path: string, body?: unknown): Promise<Response>;
  /** 閲覧専用トークン（VIEWER_TOKEN）で管理APIを呼ぶ */
  viewer(method: string, path: string, body?: unknown): Promise<Response>;
  adminJson<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export function createTestClient(overrides: Partial<Env> = {}): TestClient {
  const env = { DB: createTestDb(), ADMIN_TOKEN, MCP_TOKEN, VIEWER_TOKEN, ...overrides } as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p.catch(() => undefined)),
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;

  const request: TestClient['request'] = async (method, path, body, headers = {}) => {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
    return app.request(path, init, env, ctx);
  };

  const admin: TestClient['admin'] = (method, path, body) =>
    request(method, path, body, { Authorization: `Bearer ${ADMIN_TOKEN}` });
  const viewer: TestClient['viewer'] = (method, path, body) =>
    request(method, path, body, { Authorization: `Bearer ${VIEWER_TOKEN}` });

  return {
    env,
    settle: async () => void (await Promise.all(pending)),
    request,
    admin,
    viewer,
    adminJson: async <T>(method: string, path: string, body?: unknown) => {
      const res = await admin(method, path, body);
      if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    },
  };
}
