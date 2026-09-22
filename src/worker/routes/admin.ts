// 管理API (/api/admin/*) — Authorization: Bearer <ADMIN_TOKEN> 必須。
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import * as db from '../db';
import { buildPublicFormView, computeFormSummary, computeFormulaResults } from '../services';
import { responseScore } from '../logic/scoring';
import { CSV_BOM, stripMarkdown, toCsv } from '../logic/csv';
import { SheetsConfigError, SheetsApiError, syncFormToSheet } from '../sheets';
import { timingSafeEqual } from '../logic/security';
import type { ApiError, FormulaResults } from '../../shared/types';

export const adminRoutes = new Hono<{ Bindings: Env }>();

const SLUG_RE = /^[a-z0-9-]+$/;

adminRoutes.use('*', async (c, next) => {
  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (!token || !timingSafeEqual(token, c.env.ADMIN_TOKEN)) {
    return c.json<ApiError>({ error: 'unauthorized' }, 401);
  }
  await next();
});

function parseIdParam(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

// ---------- schemas ----------

const createEventSchema = z.object({ name: z.string().min(1).max(200) });

const teamItemSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1).max(200),
  sortOrder: z.number().int(),
});
const teamsSchema = z.object({ teams: z.array(teamItemSchema).max(500) });

const respondentItemSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1).max(200),
  role: z.enum(['judge', 'member']),
  teamId: z.number().int().nullable(),
  sortOrder: z.number().int(),
});
const respondentsSchema = z.object({ respondents: z.array(respondentItemSchema).max(1000) });

const createFormSchema = z.object({
  eventId: z.number().int(),
  slug: z.string().regex(SLUG_RE).optional(),
  title: z.string().min(1).max(200),
  descriptionMd: z.string().max(10000).default(''),
  kind: z.enum(['judge', 'peer']),
});

const patchFormSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  descriptionMd: z.string().max(10000).optional(),
  status: z.enum(['draft', 'open', 'closed']).optional(),
  sheetId: z.string().max(200).nullable().optional(),
  slug: z.string().regex(SLUG_RE).optional(),
  kind: z.enum(['judge', 'peer']).optional(),
});

const optionSchema = z.object({
  label: z.string().min(1).max(200),
  score: z.number().finite().optional(),
});

const questionItemSchema = z.object({
  id: z.number().int().optional(),
  sortOrder: z.number().int(),
  type: z.enum(['rating', 'number', 'choice', 'checkbox', 'text', 'textarea']),
  labelMd: z.string().min(1).max(10000),
  options: z.array(optionSchema).max(50).nullable(),
  maxScore: z.number().finite().nullable(),
  weight: z.number().finite().min(0),
  required: z.boolean(),
});
const questionsSchema = z.object({ questions: z.array(questionItemSchema).max(200) });

const formulaItemSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1).max(200),
  expression: z.string().min(1).max(500),
});
const formulasSchema = z.object({ formulas: z.array(formulaItemSchema).max(100) });

// ---------- events ----------

adminRoutes.post('/events', async (c) => {
  const parsed = createEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json<ApiError>({ error: 'invalid request body' }, 400);
  const event = await db.createEvent(c.env.DB, parsed.data.name);
  return c.json(event, 201);
});

adminRoutes.get('/events', async (c) => {
  const events = await db.listEvents(c.env.DB);
  return c.json(events);
});

adminRoutes.get('/events/:id', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const detail = await db.getEventDetail(c.env.DB, id);
  if (!detail) return c.json<ApiError>({ error: 'event not found' }, 404);
  return c.json(detail);
});

adminRoutes.delete('/events/:id', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const event = await db.getEvent(c.env.DB, id);
  if (!event) return c.json<ApiError>({ error: 'event not found' }, 404);
  await db.deleteEvent(c.env.DB, id);
  return c.json({ ok: true });
});

adminRoutes.put('/events/:id/teams', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const event = await db.getEvent(c.env.DB, id);
  if (!event) return c.json<ApiError>({ error: 'event not found' }, 404);
  const parsed = teamsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json<ApiError>({ error: 'invalid request body' }, 400);
  const teams = await db.upsertTeams(c.env.DB, id, parsed.data.teams);
  return c.json(teams);
});

adminRoutes.put('/events/:id/respondents', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const event = await db.getEvent(c.env.DB, id);
  if (!event) return c.json<ApiError>({ error: 'event not found' }, 404);
  const parsed = respondentsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json<ApiError>({ error: 'invalid request body' }, 400);
  try {
    const respondents = await db.upsertRespondents(c.env.DB, id, parsed.data.respondents);
    return c.json(respondents);
  } catch (e) {
    if (e instanceof db.RespondentTeamMismatchError) {
      return c.json<ApiError>({ error: e.message }, 400);
    }
    throw e;
  }
});

adminRoutes.put('/events/:id/formulas', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const event = await db.getEvent(c.env.DB, id);
  if (!event) return c.json<ApiError>({ error: 'event not found' }, 404);
  const parsed = formulasSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json<ApiError>({ error: 'invalid request body' }, 400);
  const formulas = await db.upsertFormulas(c.env.DB, id, parsed.data.formulas);
  return c.json(formulas);
});

/** GET /api/admin/events/:id/formula-results */
adminRoutes.get('/events/:id/formula-results', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const event = await db.getEvent(c.env.DB, id);
  if (!event) return c.json<ApiError>({ error: 'event not found' }, 404);

  const result = await computeFormulaResults(c.env.DB, id);
  return c.json(result! satisfies FormulaResults);
});

// ---------- forms ----------

adminRoutes.post('/forms', async (c) => {
  const parsed = createFormSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json<ApiError>({ error: 'invalid request body' }, 400);
  const event = await db.getEvent(c.env.DB, parsed.data.eventId);
  if (!event) return c.json<ApiError>({ error: 'event not found' }, 400);
  let slug = parsed.data.slug;
  if (slug) {
    const existing = await db.getFormBySlug(c.env.DB, slug);
    if (existing) return c.json<ApiError>({ error: 'slug already exists' }, 409);
  } else {
    slug = await db.generateUniqueSlug(c.env.DB, parsed.data.kind);
  }
  const form = await db.createForm(c.env.DB, { ...parsed.data, slug });
  return c.json(form, 201);
});

adminRoutes.patch('/forms/:id', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const existing = await db.getFormById(c.env.DB, id);
  if (!existing) return c.json<ApiError>({ error: 'form not found' }, 404);
  const parsed = patchFormSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json<ApiError>({ error: 'invalid request body' }, 400);
  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const conflict = await db.getFormBySlug(c.env.DB, parsed.data.slug);
    if (conflict) return c.json<ApiError>({ error: 'slug already exists' }, 409);
  }
  const form = await db.updateForm(c.env.DB, id, parsed.data);
  return c.json(form);
});

adminRoutes.delete('/forms/:id', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const existing = await db.getFormById(c.env.DB, id);
  if (!existing) return c.json<ApiError>({ error: 'form not found' }, 404);
  await db.deleteForm(c.env.DB, id);
  return c.json({ ok: true });
});

adminRoutes.get('/forms/:id', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const form = await db.getFormById(c.env.DB, id);
  if (!form) return c.json<ApiError>({ error: 'form not found' }, 404);
  const questions = await db.listQuestions(c.env.DB, id);
  return c.json({ form, questions });
});

/**
 * GET /api/admin/forms/:id/preview
 * PublicFormView と同一形状を、管理認証のもとで draft/closed でも返す（回答画面のプレビュー用）。
 */
adminRoutes.get('/forms/:id/preview', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const form = await db.getFormById(c.env.DB, id);
  if (!form) return c.json<ApiError>({ error: 'form not found' }, 404);

  const view = await buildPublicFormView(c.env.DB, form);
  return c.json(view);
});

adminRoutes.put('/forms/:id/questions', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const form = await db.getFormById(c.env.DB, id);
  if (!form) return c.json<ApiError>({ error: 'form not found' }, 404);
  const parsed = questionsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json<ApiError>({ error: 'invalid request body' }, 400);
  const questions = await db.upsertQuestions(c.env.DB, id, parsed.data.questions);
  return c.json(questions);
});

adminRoutes.get('/forms/:id/responses', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const form = await db.getFormById(c.env.DB, id);
  if (!form) return c.json<ApiError>({ error: 'form not found' }, 404);
  const responses = await db.listResponsesForForm(c.env.DB, id);
  return c.json({ responses });
});

/** GET /api/admin/forms/:id/summary */
adminRoutes.get('/forms/:id/summary', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const form = await db.getFormById(c.env.DB, id);
  if (!form) return c.json<ApiError>({ error: 'form not found' }, 404);

  const summary = await computeFormSummary(c.env.DB, id);
  return c.json(summary!);
});

/** GET /api/admin/forms/:id/export.csv */
adminRoutes.get('/forms/:id/export.csv', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const form = await db.getFormById(c.env.DB, id);
  if (!form) return c.json<ApiError>({ error: 'form not found' }, 404);

  const [questions, responses] = await Promise.all([
    db.listQuestions(c.env.DB, id),
    db.listResponsesForForm(c.env.DB, id),
  ]);

  const header = [
    '回答者',
    'チーム',
    '送信日時',
    ...questions.map((q) => stripMarkdown(q.labelMd)),
    '合計スコア',
  ];
  const rows: string[][] = [header];
  for (const r of responses) {
    const answerByQuestion = new Map(r.answers.map((a) => [a.questionId, a.value]));
    const score = responseScore(questions, r.answers);
    const cells = questions.map((q) => {
      const value = answerByQuestion.get(q.id);
      if (value === undefined) return '';
      return Array.isArray(value) ? value.join(', ') : String(value);
    });
    rows.push([r.respondentName, r.teamName, r.submittedAt, ...cells, String(score)]);
  }

  const csv = CSV_BOM + toCsv(rows);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${form.slug}.csv"`,
    },
  });
});

/** POST /api/admin/forms/:id/sync-sheets */
adminRoutes.post('/forms/:id/sync-sheets', async (c) => {
  const id = parseIdParam(c.req.param('id'));
  if (id === null) return c.json<ApiError>({ error: 'invalid id' }, 400);
  const form = await db.getFormById(c.env.DB, id);
  if (!form) return c.json<ApiError>({ error: 'form not found' }, 404);

  try {
    const result = await syncFormToSheet(c.env, id);
    return c.json({ ok: true, rows: result.rows });
  } catch (e) {
    if (e instanceof SheetsConfigError) {
      return c.json<ApiError>({ error: e.message }, 400);
    }
    if (e instanceof SheetsApiError) {
      return c.json<ApiError>({ error: `${e.message}: ${e.body}` }, 502);
    }
    return c.json<ApiError>({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
