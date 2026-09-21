// API・DBの結合テスト。Honoアプリを実際のSQL（インメモリSQLite）の上で動かし、
// 「回答データが消えない」「内部情報が漏れない」「認証が外れない」を守る。
import { beforeEach, describe, expect, it } from 'vitest';
import type { FormSummary, FormulaResults, MyResponsesView, PublicFormView } from '../../src/shared/types';
import * as db from '../../src/worker/db';
import { createTestClient, MCP_TOKEN, type TestClient } from '../helpers/app';
import { seed, submitJudge, type Fixture } from '../helpers/fixture';

let client: TestClient;
let f: Fixture;

beforeEach(async () => {
  client = createTestClient();
  f = await seed(client);
});

async function responseCount(formId: number): Promise<number> {
  const { responses } = await client.adminJson<{ responses: unknown[] }>('GET', `/api/admin/forms/${formId}/responses`);
  return responses.length;
}

describe('認証', () => {
  it('管理APIはトークンなし・誤ったトークンを拒否する', async () => {
    expect((await client.request('GET', '/api/admin/events')).status).toBe(401);
    expect((await client.request('GET', '/api/admin/events', undefined, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await client.admin('GET', '/api/admin/events')).status).toBe(200);
  });

  it('未定義の管理パスも認証の内側にある', async () => {
    expect((await client.request('GET', '/api/admin/no-such-path')).status).toBe(401);
  });

  it('MCPはトークンなし・管理トークンでは使えない', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const accept = { Accept: 'application/json, text/event-stream' };
    expect((await client.request('POST', '/mcp', init, accept)).status).toBe(401);
    expect((await client.request('POST', '/mcp', init, { ...accept, Authorization: 'Bearer test-admin-token' })).status).toBe(401);
    expect((await client.request('POST', '/mcp', init, { ...accept, Authorization: `Bearer ${MCP_TOKEN}` })).status).toBe(200);
  });

  it('シークレットが未設定なら、どんなトークンでも拒否する', async () => {
    const unset = createTestClient({ ADMIN_TOKEN: undefined as unknown as string, MCP_TOKEN: '' });
    expect((await unset.request('GET', '/api/admin/events', undefined, { Authorization: 'Bearer undefined' })).status).toBe(401);
    expect((await unset.request('GET', '/api/admin/events', undefined, { Authorization: 'Bearer ' })).status).toBe(401);
    expect((await unset.request('POST', '/mcp', {}, { Authorization: 'Bearer ' })).status).toBe(401);
  });
});

describe('回答者向けのフォーム取得', () => {
  it('重みと選択肢の配点を含めない', async () => {
    const res = await client.request('GET', '/api/forms/peer');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('weight');
    expect(text).not.toContain('score"');
    const view = JSON.parse(text) as PublicFormView;
    expect(view.questions[1].options).toEqual([{ label: 'ぜひ' }, { label: 'まあ' }, { label: 'うーん' }]);
  });

  it('フォームの種別に合う回答者だけを返す', async () => {
    const judge = (await (await client.request('GET', '/api/forms/judge')).json()) as PublicFormView;
    const peer = (await (await client.request('GET', '/api/forms/peer')).json()) as PublicFormView;
    expect(judge.respondents.map((r) => r.name)).toEqual(['審査員1', '審査員2']);
    expect(peer.respondents.map((r) => r.name)).toEqual(['メンバーA', 'メンバーB']);
  });

  it('下書きは回答者には見えないが、管理者のプレビューでは見える', async () => {
    await client.adminJson('PATCH', `/api/admin/forms/${f.judgeForm.id}`, { status: 'draft' });
    expect((await client.request('GET', '/api/forms/judge')).status).toBe(404);
    const preview = await client.adminJson<PublicFormView>('GET', `/api/admin/forms/${f.judgeForm.id}/preview`);
    expect(preview.questions).toHaveLength(3);
    expect(JSON.stringify(preview)).not.toContain('weight');
  });
});

describe('回答の送信', () => {
  it('保存でき、自分の回答として取得できる', async () => {
    expect((await submitJudge(client, f, f.judges[0].id, f.teams.a.id, 8, 7)).status).toBe(200);
    const mine = (await (
      await client.request('GET', `/api/forms/judge/responses?respondentId=${f.judges[0].id}`)
    ).json()) as MyResponsesView;
    expect(mine.responses).toHaveLength(1);
    expect(mine.responses[0].teamId).toBe(f.teams.a.id);
  });

  it('同じ回答者×チームの再送信は上書きになり、件数は増えない', async () => {
    await submitJudge(client, f, f.judges[0].id, f.teams.a.id, 8, 7);
    await submitJudge(client, f, f.judges[0].id, f.teams.a.id, 3, 4);
    expect(await responseCount(f.judgeForm.id)).toBe(1);
    const summary = await client.adminJson<FormSummary>('GET', `/api/admin/forms/${f.judgeForm.id}/summary`);
    expect(summary.teams.find((t) => t.teamId === f.teams.a.id)?.sum).toBe(3 * 2 + 4);
  });

  it('不正な入力を拒否する', async () => {
    const post = (slug: string, body: unknown) => client.request('POST', `/api/forms/${slug}/responses`, body);
    const j = f.judges[0].id;
    const a = f.teams.a.id;
    const tech = f.jq.tech.id;
    const design = f.jq.design.id;

    // 審査員が相互評価フォームに回答 / メンバーが審査員フォームに回答
    const peerAnswers = [{ questionId: f.pq.like.id, value: 5 }, { questionId: f.pq.again.id, value: 'ぜひ' }];
    expect((await post('peer', { respondentId: j, teamId: a, answers: peerAnswers })).status).toBe(403);
    expect((await submitJudge(client, f, f.memberA.id, a, 5, 5)).status).toBe(403);
    // 自分のチームを評価
    expect((await post('peer', { respondentId: f.memberA.id, teamId: a, answers: peerAnswers })).status).toBe(403);
    // 必須の欠落・空文字
    expect((await post('judge', { respondentId: j, teamId: a, answers: [{ questionId: tech, value: 8 }] })).status).toBe(400);
    // 配点上限の超過・負の値
    expect((await submitJudge(client, f, j, a, 11, 5)).status).toBe(400);
    expect((await submitJudge(client, f, j, a, -1, 5)).status).toBe(400);
    // 同じ質問への重複回答
    const dup = [{ questionId: tech, value: 1 }, { questionId: tech, value: 2 }, { questionId: design, value: 3 }];
    expect((await post('judge', { respondentId: j, teamId: a, answers: dup })).status).toBe(400);
    // 選択肢にない値
    const badChoice = [{ questionId: f.pq.like.id, value: 5 }, { questionId: f.pq.again.id, value: '最高' }];
    expect((await post('peer', { respondentId: f.memberA.id, teamId: f.teams.b.id, answers: badChoice })).status).toBe(400);
    // 存在しないチーム・別フォームの質問
    expect((await submitJudge(client, f, j, 9999, 5, 5)).status).toBe(400);
    const foreign = [{ questionId: tech, value: 5 }, { questionId: design, value: 5 }, { questionId: f.pq.like.id, value: 5 }];
    expect((await post('judge', { respondentId: j, teamId: a, answers: foreign })).status).toBe(400);

    expect(await responseCount(f.judgeForm.id)).toBe(0);
    expect(await responseCount(f.peerForm.id)).toBe(0);
  });

  it('締め切ったフォームには送信できない', async () => {
    await client.adminJson('PATCH', `/api/admin/forms/${f.judgeForm.id}`, { status: 'closed' });
    expect((await submitJudge(client, f, f.judges[0].id, f.teams.a.id, 8, 7)).status).toBe(409);
  });

  it('不正な再送信で、保存済みの回答が壊れない', async () => {
    await submitJudge(client, f, f.judges[0].id, f.teams.a.id, 8, 7);
    const dup = [{ questionId: f.jq.tech.id, value: 1 }, { questionId: f.jq.tech.id, value: 2 }];
    const res = await client.request('POST', '/api/forms/judge/responses', {
      respondentId: f.judges[0].id,
      teamId: f.teams.a.id,
      answers: dup,
    });
    expect(res.status).toBe(400);
    const summary = await client.adminJson<FormSummary>('GET', `/api/admin/forms/${f.judgeForm.id}/summary`);
    expect(summary.teams.find((t) => t.teamId === f.teams.a.id)?.sum).toBe(8 * 2 + 7);
  });
});

describe('回答の保存はアトミック', () => {
  it('保存の途中で失敗しても、保存済みの回答は消えない', async () => {
    await submitJudge(client, f, f.judges[0].id, f.teams.a.id, 8, 7);
    // 同じ質問への回答を2つ渡すと、answers の主キー制約でINSERTが失敗する
    const broken = [
      { questionId: f.jq.tech.id, value: 1 },
      { questionId: f.jq.tech.id, value: 2 },
    ];
    await expect(
      db.upsertResponse(client.env.DB, f.judgeForm.id, f.judges[0].id, f.teams.a.id, broken)
    ).rejects.toThrow();
    const summary = await client.adminJson<FormSummary>('GET', `/api/admin/forms/${f.judgeForm.id}/summary`);
    expect(summary.teams.find((t) => t.teamId === f.teams.a.id)?.sum).toBe(8 * 2 + 7);
  });
});

describe('集計', () => {
  beforeEach(async () => {
    const [j1, j2] = f.judges;
    await submitJudge(client, f, j1.id, f.teams.a.id, 8, 7); // 23
    await submitJudge(client, f, j2.id, f.teams.a.id, 7, 8); // 22
    await submitJudge(client, f, j1.id, f.teams.b.id, 9, 5); // 23
    await submitJudge(client, f, j2.id, f.teams.b.id, 10, 9); // 29
    await client.request('POST', '/api/forms/peer/responses', {
      respondentId: f.memberB.id,
      teamId: f.teams.a.id,
      answers: [{ questionId: f.pq.like.id, value: 4 }, { questionId: f.pq.again.id, value: 'ぜひ' }], // 6
    });
    await client.request('POST', '/api/forms/peer/responses', {
      respondentId: f.memberA.id,
      teamId: f.teams.b.id,
      answers: [{ questionId: f.pq.like.id, value: 3 }, { questionId: f.pq.again.id, value: 'うーん' }], // 3
    });
  });

  it('重み付きの平均と順位を、順位の高い順に返す', async () => {
    const summary = await client.adminJson<FormSummary>('GET', `/api/admin/forms/${f.judgeForm.id}/summary`);
    expect(summary.maxPossibleScore).toBe(30);
    expect(summary.teams.map((t) => [t.teamName, t.count, t.avg, t.rank])).toEqual([
      ['B班', 2, 26, 1],
      ['A班', 2, 22.5, 2],
      ['C班', 0, null, null],
    ]);
  });

  it('計算式で複数フォームを合算し、回答のないチームは0点ではなく「なし」になる', async () => {
    await client.adminJson('PUT', `/api/admin/events/${f.eventId}/formulas`, {
      formulas: [{ name: '最終', expression: 'judge_avg * 0.7 + peer_avg * 0.3' }],
    });
    const { formulas } = await client.adminJson<FormulaResults>('GET', `/api/admin/events/${f.eventId}/formula-results`);
    expect(formulas[0].error).toBeNull();
    const ranking = formulas[0].ranking.map((r) => [r.teamName, r.value === null ? null : Number(r.value.toFixed(2)), r.rank]);
    expect(ranking).toEqual([
      ['B班', 19.1, 1], // 26*0.7 + 3*0.3
      ['A班', 17.55, 2], // 22.5*0.7 + 6*0.3
      ['C班', null, null],
    ]);
  });

  it('計算式の構文エラーは式のエラーとして返し、他の式は計算する', async () => {
    await client.adminJson('PUT', `/api/admin/events/${f.eventId}/formulas`, {
      formulas: [
        { name: '壊れた式', expression: 'judge_avg * (' },
        { name: '正常な式', expression: 'judge_avg' },
      ],
    });
    const { formulas } = await client.adminJson<FormulaResults>('GET', `/api/admin/events/${f.eventId}/formula-results`);
    expect(formulas[0].error).not.toBeNull();
    expect(formulas[1].error).toBeNull();
    expect(formulas[1].ranking[0].teamName).toBe('B班');
  });

  it('CSVはBOM付きで、数式として解釈される文字列を無害化する', async () => {
    await client.request('POST', '/api/forms/judge/responses', {
      respondentId: f.judges[0].id,
      teamId: f.teams.c.id,
      answers: [
        { questionId: f.jq.tech.id, value: 5 },
        { questionId: f.jq.design.id, value: 5 },
        { questionId: f.jq.comment.id, value: '=HYPERLINK("http://evil.example","x")' },
      ],
    });
    const res = await client.admin('GET', `/api/admin/forms/${f.judgeForm.id}/export.csv`);
    // text() はBOMを取り除いてしまうので、バイト列で確認する
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain(`"'=HYPERLINK`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

describe('データを消さないための約束', () => {
  beforeEach(async () => {
    await submitJudge(client, f, f.judges[0].id, f.teams.a.id, 8, 7);
    await submitJudge(client, f, f.judges[0].id, f.teams.b.id, 6, 6);
  });

  it('管理画面の保存: idを付けて送れば、名前や順番を変えても回答は残る', async () => {
    await client.adminJson('PUT', `/api/admin/events/${f.eventId}/teams`, {
      teams: [
        { id: f.teams.b.id, name: 'B班（改名）', sortOrder: 1 },
        { id: f.teams.a.id, name: 'A班', sortOrder: 2 },
        { id: f.teams.c.id, name: 'C班', sortOrder: 3 },
        { name: 'D班', sortOrder: 4 },
      ],
    });
    expect(await responseCount(f.judgeForm.id)).toBe(2);
  });

  it('管理画面の保存: 一覧から外したチームは削除され、その回答も消える（仕様）', async () => {
    await client.adminJson('PUT', `/api/admin/events/${f.eventId}/teams`, {
      teams: [
        { id: f.teams.a.id, name: 'A班', sortOrder: 1 },
        { id: f.teams.c.id, name: 'C班', sortOrder: 2 },
      ],
    });
    expect(await responseCount(f.judgeForm.id)).toBe(1);
  });

  it('MCPのマージ: idなしの一覧を渡しても、既存のチームと回答は消えない', async () => {
    const teams = await db.mergeTeams(client.env.DB, f.eventId, [
      { name: 'A班', sortOrder: 0 },
      { name: 'D班', sortOrder: 1 },
    ]);
    expect(teams.map((t) => t.name).sort()).toEqual(['A班', 'B班', 'C班', 'D班']);
    expect(teams.find((t) => t.name === 'A班')?.id).toBe(f.teams.a.id);
    expect(await responseCount(f.judgeForm.id)).toBe(2);
  });

  it('MCPのマージ: 質問を渡し直しても、既存の質問と回答値は残る', async () => {
    await db.mergeQuestions(client.env.DB, f.judgeForm.id, [
      { sortOrder: 0, type: 'rating', labelMd: '技術力', options: null, maxScore: 10, weight: 3, required: true },
      { sortOrder: 5, type: 'rating', labelMd: '発表', options: null, maxScore: 10, weight: 1, required: false },
    ]);
    const questions = await db.listQuestions(client.env.DB, f.judgeForm.id);
    expect(questions.map((q) => q.labelMd).sort()).toEqual(['デザイン', '技術力', '発表', '講評'].sort());
    expect(questions.find((q) => q.labelMd === '技術力')).toMatchObject({ id: f.jq.tech.id, weight: 3 });
    const summary = await client.adminJson<FormSummary>('GET', `/api/admin/forms/${f.judgeForm.id}/summary`);
    expect(summary.teams.find((t) => t.teamId === f.teams.a.id)?.sum).toBe(8 * 3 + 7);
  });

  it('回答者の所属に、別のイベントのチームは指定できない', async () => {
    const other = await client.adminJson<{ id: number }>('POST', '/api/admin/events', { name: '別イベント' });
    const [otherTeam] = await client.adminJson<{ id: number }[]>('PUT', `/api/admin/events/${other.id}/teams`, {
      teams: [{ name: 'よそのチーム', sortOrder: 1 }],
    });
    const res = await client.admin('PUT', `/api/admin/events/${f.eventId}/respondents`, {
      respondents: [{ name: '迷子', role: 'member', teamId: otherTeam.id, sortOrder: 1 }],
    });
    expect(res.status).toBe(400);
    expect(await responseCount(f.judgeForm.id)).toBe(2);
  });
});

describe('フォームの作成', () => {
  it('URL名を省略すると自動生成され、重複しない', async () => {
    const make = () =>
      client.adminJson<{ slug: string; status: string }>('POST', '/api/admin/forms', {
        eventId: f.eventId,
        title: '無題のフォーム',
        kind: 'judge',
      });
    const [x, y] = [await make(), await make()];
    expect(x.slug).toMatch(/^judge-[a-z0-9]{4}$/);
    expect(x.slug).not.toBe(y.slug);
    expect(x.status).toBe('draft');
  });

  it('URL名の重複は409', async () => {
    const res = await client.admin('POST', '/api/admin/forms', { eventId: f.eventId, slug: 'judge', title: 'x', kind: 'judge' });
    expect(res.status).toBe(409);
  });
});
