// MCPツール定義。db.ts / logic/ / services.ts / sheets.ts の既存ロジックを再利用し、
// ビジネスロジックを重複実装しない。
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Env } from '../env';
import * as db from '../db';
import { computeFormSummary, computeFormulaResults } from '../services';
import { responseScore } from '../logic/scoring';
import { syncFormToSheet, SheetsConfigError, SheetsApiError } from '../sheets';

// ---------- ヘルパー ----------

function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** ハンドラをtry/catchでラップし、例外を isError:true の結果に変換する */
function safe<Args extends unknown[]>(
  fn: (...args: Args) => Promise<CallToolResult>
): (...args: Args) => Promise<CallToolResult> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof SheetsConfigError) return errorResult(e.message);
      if (e instanceof SheetsApiError) return errorResult(`${e.message}: ${e.body}`);
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  };
}

const questionTypeSchema = z.enum(['rating', 'number', 'choice', 'checkbox', 'text', 'textarea']);
const roleSchema = z.enum(['judge', 'member']);
const formKindSchema = z.enum(['judge', 'peer']);
const optionSchema = z.object({ label: z.string().min(1), score: z.number().optional() });
const SLUG_RE = /^[a-z0-9-]+$/;

export function registerTools(server: McpServer, env: Env): void {
  const database = env.DB;

  // ---------- イベント管理 ----------

  server.registerTool(
    'list_events',
    { description: 'イベント一覧を取得する' },
    safe(async () => jsonResult(await db.listEvents(database)))
  );

  server.registerTool(
    'create_event',
    {
      description: '新しいイベントを作成する',
      inputSchema: { name: z.string().min(1).describe('イベント名') },
    },
    safe(async ({ name }) => jsonResult(await db.createEvent(database, name)))
  );

  server.registerTool(
    'get_event',
    {
      description: 'イベント詳細 (チーム・回答者・フォーム・計算式) を取得する',
      inputSchema: { eventId: z.number().int() },
    },
    safe(async ({ eventId }) => {
      const detail = await db.getEventDetail(database, eventId);
      if (!detail) throw new Error('イベントが見つかりません');
      return jsonResult(detail);
    })
  );

  server.registerTool(
    'set_teams',
    {
      description: 'イベントのチーム一覧を設定する (既存と同じupsert方式。idを指定した項目は更新、指定しない項目は追加、渡さなかった既存チームは削除される)',
      inputSchema: {
        eventId: z.number().int(),
        teams: z.array(
          z.object({
            id: z.number().int().optional(),
            name: z.string().min(1),
            sortOrder: z.number().int().optional(),
          })
        ),
      },
    },
    safe(async ({ eventId, teams }) => {
      const event = await db.getEvent(database, eventId);
      if (!event) throw new Error('イベントが見つかりません');
      const items = teams.map((t, i) => ({ id: t.id, name: t.name, sortOrder: t.sortOrder ?? i }));
      return jsonResult(await db.upsertTeams(database, eventId, items));
    })
  );

  server.registerTool(
    'set_respondents',
    {
      description:
        'イベントの回答者一覧を設定する (既存と同じupsert方式)。teamNameで所属チームを名前解決できる (見つからなければエラー)',
      inputSchema: {
        eventId: z.number().int(),
        respondents: z.array(
          z.object({
            id: z.number().int().optional(),
            name: z.string().min(1),
            role: roleSchema,
            teamName: z.string().optional().describe('所属チーム名 (memberの場合に指定。judgeは不要)'),
            sortOrder: z.number().int().optional(),
          })
        ),
      },
    },
    safe(async ({ eventId, respondents }) => {
      const event = await db.getEvent(database, eventId);
      if (!event) throw new Error('イベントが見つかりません');
      const teams = await db.listTeams(database, eventId);
      const teamByName = new Map(teams.map((t) => [t.name, t.id]));

      const items = respondents.map((r, i) => {
        let teamId: number | null = null;
        if (r.teamName) {
          const found = teamByName.get(r.teamName);
          if (found === undefined) throw new Error(`チーム名 "${r.teamName}" が見つかりません`);
          teamId = found;
        }
        return { id: r.id, name: r.name, role: r.role, teamId, sortOrder: r.sortOrder ?? i };
      });
      return jsonResult(await db.upsertRespondents(database, eventId, items));
    })
  );

  // ---------- フォーム管理 ----------

  server.registerTool(
    'list_forms',
    {
      description: 'フォーム一覧を取得する。eventIdを省略すると全イベントのフォームを返す',
      inputSchema: { eventId: z.number().int().optional() },
    },
    safe(async ({ eventId }) => {
      if (eventId != null) {
        return jsonResult(await db.listForms(database, eventId));
      }
      const events = await db.listEvents(database);
      const forms = (await Promise.all(events.map((e) => db.listForms(database, e.id)))).flat();
      return jsonResult(forms);
    })
  );

  server.registerTool(
    'get_form',
    {
      description: 'フォーム定義と質問一覧を取得する',
      inputSchema: { formId: z.number().int() },
    },
    safe(async ({ formId }) => {
      const form = await db.getFormById(database, formId);
      if (!form) throw new Error('フォームが見つかりません');
      const questions = await db.listQuestions(database, formId);
      return jsonResult({ form, questions });
    })
  );

  server.registerTool(
    'create_form',
    {
      description: 'フォームを作成する (kind: judge=審査員フォーム, peer=メンバー相互評価フォーム)',
      inputSchema: {
        eventId: z.number().int(),
        slug: z.string().regex(SLUG_RE, 'slugは半角英数字とハイフンのみ使用できます'),
        title: z.string().min(1),
        descriptionMd: z.string().optional(),
        kind: formKindSchema,
      },
    },
    safe(async ({ eventId, slug, title, descriptionMd, kind }) => {
      const event = await db.getEvent(database, eventId);
      if (!event) throw new Error('イベントが見つかりません');
      const existing = await db.getFormBySlug(database, slug);
      if (existing) throw new Error('このslugは既に使用されています');
      const form = await db.createForm(database, { eventId, slug, title, descriptionMd: descriptionMd ?? '', kind });
      return jsonResult(form);
    })
  );

  server.registerTool(
    'update_form',
    {
      description: 'フォームのタイトル・説明・シートIDを更新する',
      inputSchema: {
        formId: z.number().int(),
        title: z.string().min(1).optional(),
        descriptionMd: z.string().optional(),
        sheetId: z.string().nullable().optional(),
      },
    },
    safe(async ({ formId, title, descriptionMd, sheetId }) => {
      const existing = await db.getFormById(database, formId);
      if (!existing) throw new Error('フォームが見つかりません');
      const form = await db.updateForm(database, formId, { title, descriptionMd, sheetId });
      return jsonResult(form);
    })
  );

  server.registerTool(
    'set_questions',
    {
      description: 'フォームの質問一覧を全置換する (idを指定しなければ既存の全質問を削除して新規挿入する)',
      inputSchema: {
        formId: z.number().int(),
        questions: z.array(
          z.object({
            id: z.number().int().optional(),
            sortOrder: z.number().int().optional(),
            type: questionTypeSchema,
            labelMd: z.string().min(1),
            options: z.array(optionSchema).nullable().optional(),
            maxScore: z.number().nullable().optional(),
            weight: z.number().optional(),
            required: z.boolean().optional(),
          })
        ),
      },
    },
    safe(async ({ formId, questions }) => {
      const form = await db.getFormById(database, formId);
      if (!form) throw new Error('フォームが見つかりません');
      const items = questions.map((q, i) => ({
        id: q.id,
        sortOrder: q.sortOrder ?? i,
        type: q.type,
        labelMd: q.labelMd,
        options: q.options ?? null,
        maxScore: q.maxScore ?? null,
        weight: q.weight ?? 1,
        required: q.required ?? false,
      }));
      return jsonResult(await db.upsertQuestions(database, formId, items));
    })
  );

  server.registerTool(
    'open_form',
    {
      description: 'フォームを公開状態(open)にする。結果に回答用URLパスを含める',
      inputSchema: { formId: z.number().int() },
    },
    safe(async ({ formId }) => {
      const existing = await db.getFormById(database, formId);
      if (!existing) throw new Error('フォームが見つかりません');
      const form = await db.updateForm(database, formId, { status: 'open' });
      return jsonResult({ form, url: `/f/${form!.slug}` });
    })
  );

  server.registerTool(
    'close_form',
    {
      description: 'フォームを締切状態(closed)にする',
      inputSchema: { formId: z.number().int() },
    },
    safe(async ({ formId }) => {
      const existing = await db.getFormById(database, formId);
      if (!existing) throw new Error('フォームが見つかりません');
      const form = await db.updateForm(database, formId, { status: 'closed' });
      return jsonResult(form);
    })
  );

  // ---------- 集計・分析 ----------

  server.registerTool(
    'get_responses',
    {
      description: 'フォームの回答一覧を取得する (回答者名・チーム名・回答値・スコア付き)',
      inputSchema: { formId: z.number().int() },
    },
    safe(async ({ formId }) => {
      const form = await db.getFormById(database, formId);
      if (!form) throw new Error('フォームが見つかりません');
      const [questions, responses] = await Promise.all([
        db.listQuestions(database, formId),
        db.listResponsesForForm(database, formId),
      ]);
      const withScore = responses.map((r) => ({ ...r, score: responseScore(questions, r.answers) }));
      return jsonResult({ formId, responses: withScore });
    })
  );

  server.registerTool(
    'get_team_summary',
    {
      description: 'フォームのチーム別集計 (回答数・平均・合計・順位・質問別平均) を取得する',
      inputSchema: { formId: z.number().int() },
    },
    safe(async ({ formId }) => {
      const summary = await computeFormSummary(database, formId);
      if (!summary) throw new Error('フォームが見つかりません');
      return jsonResult(summary);
    })
  );

  server.registerTool(
    'set_formulas',
    {
      description: 'イベントの自由計算式一覧を設定する (既存と同じupsert方式)',
      inputSchema: {
        eventId: z.number().int(),
        formulas: z.array(
          z.object({
            id: z.number().int().optional(),
            name: z.string().min(1),
            expression: z
              .string()
              .min(1)
              .describe('例: judge_avg * 0.7 + peer_avg * 0.3 (変数は <form_slug>_avg / _sum / _count)'),
          })
        ),
      },
    },
    safe(async ({ eventId, formulas }) => {
      const event = await db.getEvent(database, eventId);
      if (!event) throw new Error('イベントが見つかりません');
      return jsonResult(await db.upsertFormulas(database, eventId, formulas));
    })
  );

  server.registerTool(
    'get_formula_results',
    {
      description: 'イベントの自由計算式の結果 (チームごとの値・順位) を取得する',
      inputSchema: { eventId: z.number().int() },
    },
    safe(async ({ eventId }) => {
      const results = await computeFormulaResults(database, eventId);
      if (!results) throw new Error('イベントが見つかりません');
      return jsonResult(results);
    })
  );

  // ---------- 連携 ----------

  server.registerTool(
    'sync_to_sheets',
    {
      description: 'フォームの全回答・チーム別集計をGoogleスプレッドシートへ一括同期する',
      inputSchema: { formId: z.number().int() },
    },
    safe(async ({ formId }) => {
      const result = await syncFormToSheet(env, formId);
      return jsonResult({ ok: true, rows: result.rows });
    })
  );
}
