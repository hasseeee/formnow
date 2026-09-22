// 公開API (/api/forms/*) — 認証不要。回答者向け。
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import * as db from '../db';
import { appendResponseToSheet } from '../sheets';
import { buildPublicFormView } from '../services';
import type { ApiError, MyResponsesView, Role } from '../../shared/types';

export const publicRoutes = new Hono<{ Bindings: Env }>();

const answerValueSchema = z.union([
  z.number().finite(),
  z.string().max(10000),
  z.array(z.string().max(10000)).max(100),
]);

const submitSchema = z.object({
  respondentId: z.number().int(),
  teamId: z.number().int(),
  answers: z
    .array(
      z.object({
        questionId: z.number().int(),
        value: answerValueSchema,
      }),
    )
    .max(200),
});

/** GET /api/forms/:slug */
publicRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const form = await db.getFormBySlug(c.env.DB, slug);
  if (!form || form.status === 'draft') {
    return c.json<ApiError>({ error: 'form not found' }, 404);
  }

  const view = await buildPublicFormView(c.env.DB, form);
  return c.json(view);
});

/** GET /api/forms/:slug/responses?respondentId=N */
publicRoutes.get('/:slug/responses', async (c) => {
  const slug = c.req.param('slug');
  const respondentIdRaw = c.req.query('respondentId');
  const respondentId = respondentIdRaw !== undefined ? Number(respondentIdRaw) : NaN;
  if (!respondentIdRaw || !Number.isInteger(respondentId)) {
    return c.json<ApiError>({ error: 'respondentId is required' }, 400);
  }

  const form = await db.getFormBySlug(c.env.DB, slug);
  if (!form || form.status === 'draft') {
    return c.json<ApiError>({ error: 'form not found' }, 404);
  }

  const view: MyResponsesView = await db.listMyResponses(c.env.DB, form.id, respondentId);
  return c.json(view);
});

/** POST /api/forms/:slug/responses */
publicRoutes.post('/:slug/responses', async (c) => {
  const slug = c.req.param('slug');
  const form = await db.getFormBySlug(c.env.DB, slug);
  if (!form) {
    return c.json<ApiError>({ error: 'form not found' }, 404);
  }
  if (form.status !== 'open') {
    return c.json<ApiError>({ error: 'form is not open' }, 409);
  }

  const json = await c.req.json().catch(() => null);
  const parsed = submitSchema.safeParse(json);
  if (!parsed.success) {
    return c.json<ApiError>({ error: 'invalid request body' }, 400);
  }
  const body = parsed.data;

  const requiredRole: Role = form.kind === 'judge' ? 'judge' : 'member';
  const respondent = await db.getRespondentById(c.env.DB, body.respondentId);
  if (!respondent || respondent.eventId !== form.eventId || respondent.role !== requiredRole) {
    return c.json<ApiError>({ error: 'respondent is not eligible for this form' }, 403);
  }

  if (form.kind === 'peer' && respondent.teamId !== null && respondent.teamId === body.teamId) {
    return c.json<ApiError>({ error: 'cannot evaluate own team' }, 403);
  }

  const team = await db.getTeamById(c.env.DB, body.teamId);
  if (!team || team.eventId !== form.eventId) {
    return c.json<ApiError>({ error: 'team not found' }, 400);
  }

  // answers配列内のquestionId重複を拒否する
  const seenQuestionIds = new Set<number>();
  for (const a of body.answers) {
    if (seenQuestionIds.has(a.questionId)) {
      return c.json<ApiError>({ error: `duplicate answer for question ${a.questionId}` }, 400);
    }
    seenQuestionIds.add(a.questionId);
  }

  const questions = await db.listQuestions(c.env.DB, form.id);
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const answerMap = new Map(body.answers.map((a) => [a.questionId, a.value]));

  /** 空文字・空配列も「未回答」として扱う */
  function isBlankAnswer(value: unknown): boolean {
    if (value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  for (const q of questions) {
    if (q.required && isBlankAnswer(answerMap.get(q.id))) {
      return c.json<ApiError>({ error: `question ${q.id} is required` }, 400);
    }
  }

  for (const a of body.answers) {
    const q = questionMap.get(a.questionId);
    if (!q) {
      return c.json<ApiError>({ error: `unknown question ${a.questionId}` }, 400);
    }
    if (q.type === 'rating' || q.type === 'number') {
      if (typeof a.value !== 'number' || Number.isNaN(a.value)) {
        return c.json<ApiError>({ error: `question ${q.id} requires a numeric value` }, 400);
      }
      if (a.value < 0) {
        return c.json<ApiError>({ error: `question ${q.id} value must not be negative` }, 400);
      }
      if (q.maxScore != null && a.value > q.maxScore) {
        return c.json<ApiError>({ error: `question ${q.id} exceeds max score` }, 400);
      }
    } else if (q.type === 'choice') {
      if (typeof a.value !== 'string') {
        return c.json<ApiError>({ error: `question ${q.id} requires a string value` }, 400);
      }
      if (a.value !== '') {
        const labels = new Set((q.options ?? []).map((o) => o.label));
        if (!labels.has(a.value)) {
          return c.json<ApiError>({ error: `question ${q.id} has an invalid option value` }, 400);
        }
      }
    } else if (q.type === 'checkbox') {
      if (!Array.isArray(a.value)) {
        return c.json<ApiError>({ error: `question ${q.id} requires an array value` }, 400);
      }
      const labels = new Set((q.options ?? []).map((o) => o.label));
      for (const v of a.value) {
        if (!labels.has(v)) {
          return c.json<ApiError>({ error: `question ${q.id} has an invalid option value` }, 400);
        }
      }
    } else {
      if (typeof a.value !== 'string') {
        return c.json<ApiError>({ error: `question ${q.id} requires a string value` }, 400);
      }
    }
  }

  const responseId = await db.upsertResponse(
    c.env.DB,
    form.id,
    body.respondentId,
    body.teamId,
    body.answers,
  );

  // シートへの追記は応答をブロックしないよう waitUntil に載せる (best-effort)
  c.executionCtx.waitUntil(
    appendResponseToSheet(c.env, form.id, responseId).catch(() => {
      // best-effort: シート追記の失敗は回答受付をブロックしない
    }),
  );

  return c.json({ ok: true });
});
