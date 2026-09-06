// 公開API (/api/forms/*) — 認証不要。回答者向け。
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import * as db from '../db';
import { appendResponseToSheet } from '../sheets';
import type { ApiError, MyResponsesView, PublicFormView, Role } from '../../shared/types';

export const publicRoutes = new Hono<{ Bindings: Env }>();

const answerValueSchema = z.union([z.number(), z.string(), z.array(z.string())]);

const submitSchema = z.object({
  respondentId: z.number().int(),
  teamId: z.number().int(),
  answers: z.array(
    z.object({
      questionId: z.number().int(),
      value: answerValueSchema,
    })
  ),
});

/** GET /api/forms/:slug */
publicRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const form = await db.getFormBySlug(c.env.DB, slug);
  if (!form || form.status === 'draft') {
    return c.json<ApiError>({ error: 'form not found' }, 404);
  }

  const [questions, teams, respondents] = await Promise.all([
    db.listQuestions(c.env.DB, form.id),
    db.listTeams(c.env.DB, form.eventId),
    db.listRespondentsForFormKind(c.env.DB, form.eventId, form.kind),
  ]);

  const view: PublicFormView = {
    form,
    questions,
    teams,
    respondents: respondents.map((r) => ({ id: r.id, name: r.name, teamId: r.teamId })),
  };
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

  const questions = await db.listQuestions(c.env.DB, form.id);
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const answerMap = new Map(body.answers.map((a) => [a.questionId, a.value]));

  for (const q of questions) {
    if (q.required && !answerMap.has(q.id)) {
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
    } else if (q.type === 'checkbox') {
      if (!Array.isArray(a.value)) {
        return c.json<ApiError>({ error: `question ${q.id} requires an array value` }, 400);
      }
    } else {
      if (typeof a.value !== 'string') {
        return c.json<ApiError>({ error: `question ${q.id} requires a string value` }, 400);
      }
    }
  }

  const responseId = await db.upsertResponse(c.env.DB, form.id, body.respondentId, body.teamId, body.answers);

  try {
    await appendResponseToSheet(c.env, form.id, responseId);
  } catch {
    // best-effort: シート追記の失敗は回答受付をブロックしない
  }

  return c.json({ ok: true });
});
