// 閲覧専用トークン（VIEWER_TOKEN）の結合テスト。
// 「読み取りはできる」「書き込みはミドルウェアで 403」「未設定なら無効」「MCP では使えない」を守る。
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdminMe, ApiError } from '../../src/shared/types';
import { ADMIN_TOKEN, createTestClient, VIEWER_TOKEN, type TestClient } from '../helpers/app';
import { seed, submitJudge, type Fixture } from '../helpers/fixture';

const FORBIDDEN = '閲覧専用のトークンでは変更できません';

let client: TestClient;
let f: Fixture;

beforeEach(async () => {
  client = createTestClient();
  f = await seed(client);
  expect((await submitJudge(client, f, f.judges[0].id, f.teams.a.id, 8, 7)).status).toBe(200);
});

async function responseCount(formId: number): Promise<number> {
  const { responses } = await client.adminJson<{ responses: unknown[] }>(
    'GET',
    `/api/admin/forms/${formId}/responses`,
  );
  return responses.length;
}

describe('GET /api/admin/me', () => {
  it('閲覧専用トークンなら viewer を返す', async () => {
    const res = await client.viewer('GET', '/api/admin/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual<AdminMe>({ role: 'viewer' });
  });

  it('管理トークンなら admin を返す', async () => {
    const res = await client.admin('GET', '/api/admin/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual<AdminMe>({ role: 'admin' });
  });
});

describe('閲覧専用トークンの読み取り', () => {
  it('GET の管理APIはすべて使える', async () => {
    const paths = [
      '/api/admin/events',
      `/api/admin/events/${f.eventId}`,
      `/api/admin/events/${f.eventId}/formula-results`,
      `/api/admin/forms/${f.judgeForm.id}`,
      `/api/admin/forms/${f.judgeForm.id}/preview`,
      `/api/admin/forms/${f.judgeForm.id}/responses`,
      `/api/admin/forms/${f.judgeForm.id}/summary`,
    ];
    for (const path of paths) {
      const res = await client.viewer('GET', path);
      expect(res.status, path).toBe(200);
    }
  });

  it('CSV をダウンロードできる', async () => {
    const res = await client.viewer('GET', `/api/admin/forms/${f.judgeForm.id}/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
  });
});

/** 管理APIの書き込み操作すべて（sync-sheets は別に確かめる） */
function writeRequests(): [string, string, unknown?][] {
  return [
    ['POST', '/api/admin/events', { name: '勝手なイベント' }],
    [
      'POST',
      '/api/admin/forms',
      { eventId: f.eventId, title: '勝手なフォーム', descriptionMd: '', kind: 'judge' },
    ],
    ['PUT', `/api/admin/events/${f.eventId}/teams`, { teams: [] }],
    ['PUT', `/api/admin/events/${f.eventId}/respondents`, { respondents: [] }],
    ['PUT', `/api/admin/events/${f.eventId}/formulas`, { formulas: [] }],
    ['PUT', `/api/admin/forms/${f.judgeForm.id}/questions`, { questions: [] }],
    ['PATCH', `/api/admin/forms/${f.judgeForm.id}`, { status: 'closed' }],
    ['DELETE', `/api/admin/forms/${f.judgeForm.id}`],
    ['DELETE', `/api/admin/events/${f.eventId}`],
  ];
}

describe('閲覧専用トークンの書き込み', () => {
  it('POST / PUT / PATCH / DELETE はすべて 403 で、日本語の文言を返す', async () => {
    for (const [method, path, body] of writeRequests()) {
      const res = await client.viewer(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await res.json(), `${method} ${path}`).toEqual<ApiError>({ error: FORBIDDEN });
    }
  });

  it('403 のあと、イベント・フォーム・回答は変わっていない', async () => {
    const before = await client.adminJson<unknown>('GET', `/api/admin/events/${f.eventId}`);
    const beforeForm = await client.adminJson<unknown>('GET', `/api/admin/forms/${f.judgeForm.id}`);
    expect(await responseCount(f.judgeForm.id)).toBe(1);

    for (const [method, path, body] of writeRequests()) {
      await client.viewer(method, path, body);
    }

    expect(await client.adminJson<unknown>('GET', `/api/admin/events/${f.eventId}`)).toEqual(
      before,
    );
    expect(await client.adminJson<unknown>('GET', `/api/admin/forms/${f.judgeForm.id}`)).toEqual(
      beforeForm,
    );
    expect(await responseCount(f.judgeForm.id)).toBe(1);
    expect(await client.adminJson<unknown[]>('GET', '/api/admin/events')).toHaveLength(1);
  });

  it('シートへの一括同期はミドルウェアで 403 になる（未設定の 400 ではない）', async () => {
    const res = await client.viewer('POST', `/api/admin/forms/${f.judgeForm.id}/sync-sheets`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual<ApiError>({ error: FORBIDDEN });
  });
});

describe('VIEWER_TOKEN が未設定のとき', () => {
  it('未設定なら閲覧専用トークンの文字列でも 401', async () => {
    const unset = createTestClient({ VIEWER_TOKEN: undefined });
    const res = await unset.request('GET', '/api/admin/events', undefined, {
      Authorization: `Bearer ${VIEWER_TOKEN}`,
    });
    expect(res.status).toBe(401);
  });

  it('空文字なら空のトークンでも 401', async () => {
    const empty = createTestClient({ VIEWER_TOKEN: '' });
    const res = await empty.request('GET', '/api/admin/events', undefined, {
      Authorization: 'Bearer ',
    });
    expect(res.status).toBe(401);
  });
});

describe('管理トークン', () => {
  it('今までどおり書き込みができる', async () => {
    const res = await client.admin('PATCH', `/api/admin/forms/${f.judgeForm.id}`, {
      status: 'closed',
    });
    expect(res.status).toBe(200);
    const detail = await client.adminJson<{ form: { status: string } }>(
      'GET',
      `/api/admin/forms/${f.judgeForm.id}`,
    );
    expect(detail.form.status).toBe('closed');
  });
});

describe('ADMIN_TOKEN と VIEWER_TOKEN が同じ値のとき', () => {
  it('最小権限の viewer に倒し、書き込みは 403', async () => {
    const same = createTestClient({ VIEWER_TOKEN: ADMIN_TOKEN });
    const me = await same.admin('GET', '/api/admin/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual<AdminMe>({ role: 'viewer' });

    const res = await same.admin('PATCH', '/api/admin/forms/1', { status: 'open' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual<ApiError>({ error: FORBIDDEN });
  });
});

describe('MCP', () => {
  it('閲覧専用トークンでは使えない', async () => {
    const res = await client.request(
      'POST',
      '/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      {
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${VIEWER_TOKEN}`,
      },
    );
    expect(res.status).toBe(401);
  });
});
