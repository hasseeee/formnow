// D1アクセス層: snake_case行 → camelCaseドメイン型へのマッピングを行う。
import type {
  AnswerValue,
  Event,
  Form,
  FormKind,
  FormStatus,
  Formula,
  Question,
  QuestionOption,
  QuestionType,
  Respondent,
  Role,
  Team,
} from '../shared/types';

// ---------- 行の型 (snake_case) ----------

interface EventRow {
  id: number;
  name: string;
  created_at: string;
}

interface TeamRow {
  id: number;
  event_id: number;
  name: string;
  sort_order: number;
}

interface RespondentRow {
  id: number;
  event_id: number;
  name: string;
  role: string;
  team_id: number | null;
  sort_order: number;
}

interface FormRow {
  id: number;
  event_id: number;
  slug: string;
  title: string;
  description_md: string;
  kind: string;
  status: string;
  sheet_id: string | null;
  created_at: string;
}

interface QuestionRow {
  id: number;
  form_id: number;
  sort_order: number;
  type: string;
  label_md: string;
  options_json: string | null;
  max_score: number | null;
  weight: number;
  required: number;
}

interface FormulaRow {
  id: number;
  event_id: number;
  name: string;
  expression: string;
}

// ---------- マッパー ----------

function mapEvent(row: EventRow): Event {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function mapTeam(row: TeamRow): Team {
  return { id: row.id, eventId: row.event_id, name: row.name, sortOrder: row.sort_order };
}

function mapRespondent(row: RespondentRow): Respondent {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    role: row.role as Role,
    teamId: row.team_id,
    sortOrder: row.sort_order,
  };
}

function mapForm(row: FormRow): Form {
  return {
    id: row.id,
    eventId: row.event_id,
    slug: row.slug,
    title: row.title,
    descriptionMd: row.description_md,
    kind: row.kind as FormKind,
    status: row.status as FormStatus,
    sheetId: row.sheet_id,
    createdAt: row.created_at,
  };
}

function mapQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    formId: row.form_id,
    sortOrder: row.sort_order,
    type: row.type as QuestionType,
    labelMd: row.label_md,
    options: row.options_json ? (JSON.parse(row.options_json) as QuestionOption[]) : null,
    maxScore: row.max_score,
    weight: row.weight,
    required: row.required === 1,
  };
}

function mapFormula(row: FormulaRow): Formula {
  return { id: row.id, eventId: row.event_id, name: row.name, expression: row.expression };
}

// ---------- 汎用: 子リストの upsert (id指定は更新、無指定は追加、リストに無いidは削除) ----------

interface HasOptionalId {
  id?: number;
}

async function upsertOrderedList<T extends HasOptionalId>(
  db: D1Database,
  table: string,
  parentColumn: string,
  parentId: number,
  items: T[],
  columns: string[],
  toValues: (item: T) => unknown[]
): Promise<void> {
  const existingRes = await db
    .prepare(`SELECT id FROM ${table} WHERE ${parentColumn} = ?`)
    .bind(parentId)
    .all<{ id: number }>();
  const existingIds = new Set((existingRes.results ?? []).map((r) => r.id));
  const keepIds = new Set(items.filter((i) => i.id != null).map((i) => i.id as number));
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));

  const stmts: D1PreparedStatement[] = [];
  for (const id of toDelete) {
    stmts.push(db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id));
  }
  for (const item of items) {
    const values = toValues(item);
    if (item.id != null && existingIds.has(item.id)) {
      const setClause = columns.map((col) => `${col} = ?`).join(', ');
      stmts.push(db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).bind(...values, item.id));
    } else {
      const colList = columns.join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      stmts.push(
        db
          .prepare(`INSERT INTO ${table} (${parentColumn}, ${colList}) VALUES (?, ${placeholders})`)
          .bind(parentId, ...values)
      );
    }
  }
  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

// ---------- 汎用: 削除しないマージ (id指定は更新、id無しはmatchKeyで既存行に解決、一致無しは追加) ----------

export interface MergeExistingRow {
  id: number;
  matchKey: string;
}

export interface MergeItemInput<T> {
  id?: number;
  matchKey: string;
  data: T;
}

export type MergePlanEntry<T> = { action: 'update'; id: number; data: T } | { action: 'insert'; data: T };

/**
 * 削除しないマージ計画を立てる純粋関数。
 * (a) idが指定され既存行に存在すればそのidを更新
 * (b) id無し、またはidが既存に無い場合は、未使用の既存行のうちmatchKeyが一致するものを更新
 * (c) 一致する既存行が無ければ新規追加
 * (d) items に含まれない既存行はそのまま残す (削除しない)
 */
export function planMergeUpsert<T>(existing: MergeExistingRow[], items: MergeItemInput<T>[]): MergePlanEntry<T>[] {
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const usedIds = new Set<number>();
  const plan: MergePlanEntry<T>[] = [];

  for (const item of items) {
    if (item.id != null && existingById.has(item.id) && !usedIds.has(item.id)) {
      usedIds.add(item.id);
      plan.push({ action: 'update', id: item.id, data: item.data });
      continue;
    }
    const match = existing.find((e) => e.matchKey === item.matchKey && !usedIds.has(e.id));
    if (match) {
      usedIds.add(match.id);
      plan.push({ action: 'update', id: match.id, data: item.data });
      continue;
    }
    plan.push({ action: 'insert', data: item.data });
  }

  return plan;
}

async function executeMergePlan<T>(
  db: D1Database,
  table: string,
  parentColumn: string,
  parentId: number,
  plan: MergePlanEntry<T>[],
  columns: string[],
  toValues: (item: T) => unknown[]
): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const entry of plan) {
    const values = toValues(entry.data);
    if (entry.action === 'update') {
      const setClause = columns.map((col) => `${col} = ?`).join(', ');
      stmts.push(db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).bind(...values, entry.id));
    } else {
      const colList = columns.join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      stmts.push(
        db
          .prepare(`INSERT INTO ${table} (${parentColumn}, ${colList}) VALUES (?, ${placeholders})`)
          .bind(parentId, ...values)
      );
    }
  }
  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

// ---------- events ----------

export async function createEvent(db: D1Database, name: string): Promise<Event> {
  const row = await db.prepare('INSERT INTO events (name) VALUES (?) RETURNING *').bind(name).first<EventRow>();
  return mapEvent(row!);
}

export async function listEvents(db: D1Database): Promise<Event[]> {
  const { results } = await db.prepare('SELECT * FROM events ORDER BY id DESC').all<EventRow>();
  return (results ?? []).map(mapEvent);
}

export async function getEvent(db: D1Database, id: number): Promise<Event | null> {
  const row = await db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
  return row ? mapEvent(row) : null;
}

export async function deleteEvent(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
}

export interface EventDetail {
  event: Event;
  teams: Team[];
  respondents: Respondent[];
  forms: Form[];
  formulas: Formula[];
}

export async function getEventDetail(db: D1Database, id: number): Promise<EventDetail | null> {
  const event = await getEvent(db, id);
  if (!event) return null;
  const [teams, respondents, forms, formulas] = await Promise.all([
    listTeams(db, id),
    listRespondents(db, id),
    listForms(db, id),
    listFormulas(db, id),
  ]);
  return { event, teams, respondents, forms, formulas };
}

// ---------- teams ----------

export interface TeamInput {
  id?: number;
  name: string;
  sortOrder: number;
}

export async function listTeams(db: D1Database, eventId: number): Promise<Team[]> {
  const { results } = await db
    .prepare('SELECT * FROM teams WHERE event_id = ? ORDER BY sort_order, id')
    .bind(eventId)
    .all<TeamRow>();
  return (results ?? []).map(mapTeam);
}

export async function getTeamById(db: D1Database, id: number): Promise<Team | null> {
  const row = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first<TeamRow>();
  return row ? mapTeam(row) : null;
}

export async function upsertTeams(db: D1Database, eventId: number, items: TeamInput[]): Promise<Team[]> {
  await upsertOrderedList(db, 'teams', 'event_id', eventId, items, ['name', 'sort_order'], (i) => [
    i.name,
    i.sortOrder,
  ]);
  return listTeams(db, eventId);
}

/**
 * チーム一覧を「削除しないマージ」で反映する (MCP set_teams用)。
 * idが一致すれば更新、id無しは既存チームと同名なら更新扱い、一致しなければ追加。
 * items に含まれない既存チームは削除しない。
 */
export async function mergeTeams(db: D1Database, eventId: number, items: TeamInput[]): Promise<Team[]> {
  const existingRes = await db
    .prepare('SELECT id, name FROM teams WHERE event_id = ?')
    .bind(eventId)
    .all<{ id: number; name: string }>();
  const existing: MergeExistingRow[] = (existingRes.results ?? []).map((r) => ({ id: r.id, matchKey: r.name }));
  const mergeItems: MergeItemInput<TeamInput>[] = items.map((i) => ({ id: i.id, matchKey: i.name, data: i }));
  const plan = planMergeUpsert(existing, mergeItems);
  await executeMergePlan(db, 'teams', 'event_id', eventId, plan, ['name', 'sort_order'], (i) => [
    i.name,
    i.sortOrder,
  ]);
  return listTeams(db, eventId);
}

// ---------- respondents ----------

export interface RespondentInput {
  id?: number;
  name: string;
  role: Role;
  teamId: number | null;
  sortOrder: number;
}

export async function listRespondents(db: D1Database, eventId: number): Promise<Respondent[]> {
  const { results } = await db
    .prepare('SELECT * FROM respondents WHERE event_id = ? ORDER BY sort_order, id')
    .bind(eventId)
    .all<RespondentRow>();
  return (results ?? []).map(mapRespondent);
}

export async function getRespondentById(db: D1Database, id: number): Promise<Respondent | null> {
  const row = await db.prepare('SELECT * FROM respondents WHERE id = ?').bind(id).first<RespondentRow>();
  return row ? mapRespondent(row) : null;
}

/** 指定フォームkindの対象role (judge→judge, peer→member) の回答者一覧をsort_order順で返す */
export async function listRespondentsForFormKind(
  db: D1Database,
  eventId: number,
  kind: FormKind
): Promise<Respondent[]> {
  const role: Role = kind === 'judge' ? 'judge' : 'member';
  const { results } = await db
    .prepare('SELECT * FROM respondents WHERE event_id = ? AND role = ? ORDER BY sort_order, id')
    .bind(eventId, role)
    .all<RespondentRow>();
  return (results ?? []).map(mapRespondent);
}

/** teamIdが同一イベントのチームでない場合に投げるエラー。呼び出し側で400として扱う。 */
export class RespondentTeamMismatchError extends Error {}

/** items内のteamId (null以外) が全て同一イベントのチームであることを検証する。違えばエラーを投げる。 */
async function validateRespondentTeamIds(
  db: D1Database,
  eventId: number,
  items: { teamId: number | null }[]
): Promise<void> {
  const teamIds = [...new Set(items.map((i) => i.teamId).filter((id): id is number => id != null))];
  if (teamIds.length === 0) return;
  const placeholders = teamIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT id FROM teams WHERE event_id = ? AND id IN (${placeholders})`)
    .bind(eventId, ...teamIds)
    .all<{ id: number }>();
  const validIds = new Set((results ?? []).map((r) => r.id));
  const invalid = teamIds.filter((id) => !validIds.has(id));
  if (invalid.length > 0) {
    throw new RespondentTeamMismatchError(`teamId ${invalid.join(', ')} は同じイベントのチームではありません`);
  }
}

export async function upsertRespondents(
  db: D1Database,
  eventId: number,
  items: RespondentInput[]
): Promise<Respondent[]> {
  await validateRespondentTeamIds(db, eventId, items);
  await upsertOrderedList(
    db,
    'respondents',
    'event_id',
    eventId,
    items,
    ['name', 'role', 'team_id', 'sort_order'],
    (i) => [i.name, i.role, i.teamId, i.sortOrder]
  );
  return listRespondents(db, eventId);
}

/**
 * 回答者一覧を「削除しないマージ」で反映する (MCP set_respondents用)。
 * idが一致すれば更新、id無しは既存回答者と同名なら更新扱い、一致しなければ追加。
 * items に含まれない既存回答者は削除しない。teamIdは同一イベントのチームか検証する。
 */
export async function mergeRespondents(
  db: D1Database,
  eventId: number,
  items: RespondentInput[]
): Promise<Respondent[]> {
  await validateRespondentTeamIds(db, eventId, items);
  const existingRes = await db
    .prepare('SELECT id, name FROM respondents WHERE event_id = ?')
    .bind(eventId)
    .all<{ id: number; name: string }>();
  const existing: MergeExistingRow[] = (existingRes.results ?? []).map((r) => ({ id: r.id, matchKey: r.name }));
  const mergeItems: MergeItemInput<RespondentInput>[] = items.map((i) => ({ id: i.id, matchKey: i.name, data: i }));
  const plan = planMergeUpsert(existing, mergeItems);
  await executeMergePlan(
    db,
    'respondents',
    'event_id',
    eventId,
    plan,
    ['name', 'role', 'team_id', 'sort_order'],
    (i) => [i.name, i.role, i.teamId, i.sortOrder]
  );
  return listRespondents(db, eventId);
}

// ---------- forms ----------

export interface FormCreateInput {
  eventId: number;
  slug: string;
  title: string;
  descriptionMd: string;
  kind: FormKind;
}

export interface FormPatch {
  title?: string;
  descriptionMd?: string;
  status?: FormStatus;
  sheetId?: string | null;
  slug?: string;
}

export async function createForm(db: D1Database, input: FormCreateInput): Promise<Form> {
  const row = await db
    .prepare('INSERT INTO forms (event_id, slug, title, description_md, kind) VALUES (?, ?, ?, ?, ?) RETURNING *')
    .bind(input.eventId, input.slug, input.title, input.descriptionMd, input.kind)
    .first<FormRow>();
  return mapForm(row!);
}

/** slug未指定時の自動生成: `<base>-x7k2` 形式で衝突しないものを返す */
export async function generateUniqueSlug(db: D1Database, base: string): Promise<string> {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const suffix = Array.from(bytes, (b) => chars[b % chars.length]).join('');
    const slug = `${base}-${suffix}`;
    if (!(await getFormBySlug(db, slug))) return slug;
  }
  throw new Error('スラッグの自動生成に失敗しました');
}

export async function getFormBySlug(db: D1Database, slug: string): Promise<Form | null> {
  const row = await db.prepare('SELECT * FROM forms WHERE slug = ?').bind(slug).first<FormRow>();
  return row ? mapForm(row) : null;
}

export async function getFormById(db: D1Database, id: number): Promise<Form | null> {
  const row = await db.prepare('SELECT * FROM forms WHERE id = ?').bind(id).first<FormRow>();
  return row ? mapForm(row) : null;
}

export async function listForms(db: D1Database, eventId: number): Promise<Form[]> {
  const { results } = await db.prepare('SELECT * FROM forms WHERE event_id = ? ORDER BY id').bind(eventId).all<FormRow>();
  return (results ?? []).map(mapForm);
}

export async function updateForm(db: D1Database, id: number, patch: FormPatch): Promise<Form | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    fields.push('title = ?');
    values.push(patch.title);
  }
  if (patch.descriptionMd !== undefined) {
    fields.push('description_md = ?');
    values.push(patch.descriptionMd);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (patch.sheetId !== undefined) {
    fields.push('sheet_id = ?');
    values.push(patch.sheetId);
  }
  if (patch.slug !== undefined) {
    fields.push('slug = ?');
    values.push(patch.slug);
  }
  if (fields.length === 0) return getFormById(db, id);
  const row = await db
    .prepare(`UPDATE forms SET ${fields.join(', ')} WHERE id = ? RETURNING *`)
    .bind(...values, id)
    .first<FormRow>();
  return row ? mapForm(row) : null;
}

export async function deleteForm(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM forms WHERE id = ?').bind(id).run();
}

// ---------- questions ----------

export interface QuestionInput {
  id?: number;
  sortOrder: number;
  type: QuestionType;
  labelMd: string;
  options: QuestionOption[] | null;
  maxScore: number | null;
  weight: number;
  required: boolean;
}

export async function listQuestions(db: D1Database, formId: number): Promise<Question[]> {
  const { results } = await db
    .prepare('SELECT * FROM questions WHERE form_id = ? ORDER BY sort_order, id')
    .bind(formId)
    .all<QuestionRow>();
  return (results ?? []).map(mapQuestion);
}

export async function upsertQuestions(db: D1Database, formId: number, items: QuestionInput[]): Promise<Question[]> {
  await upsertOrderedList(
    db,
    'questions',
    'form_id',
    formId,
    items,
    ['sort_order', 'type', 'label_md', 'options_json', 'max_score', 'weight', 'required'],
    (i) => [
      i.sortOrder,
      i.type,
      i.labelMd,
      i.options ? JSON.stringify(i.options) : null,
      i.maxScore,
      i.weight,
      i.required ? 1 : 0,
    ]
  );
  return listQuestions(db, formId);
}

/**
 * 質問一覧を「削除しないマージ」で反映する (MCP set_questions用)。
 * idが一致すれば更新、id無しはlabelMdが完全一致する既存質問があれば更新扱い、一致しなければ追加。
 * items に含まれない既存質問は削除しない。
 */
export async function mergeQuestions(db: D1Database, formId: number, items: QuestionInput[]): Promise<Question[]> {
  const existingRes = await db
    .prepare('SELECT id, label_md FROM questions WHERE form_id = ?')
    .bind(formId)
    .all<{ id: number; label_md: string }>();
  const existing: MergeExistingRow[] = (existingRes.results ?? []).map((r) => ({ id: r.id, matchKey: r.label_md }));
  const mergeItems: MergeItemInput<QuestionInput>[] = items.map((i) => ({ id: i.id, matchKey: i.labelMd, data: i }));
  const plan = planMergeUpsert(existing, mergeItems);
  await executeMergePlan(
    db,
    'questions',
    'form_id',
    formId,
    plan,
    ['sort_order', 'type', 'label_md', 'options_json', 'max_score', 'weight', 'required'],
    (i) => [
      i.sortOrder,
      i.type,
      i.labelMd,
      i.options ? JSON.stringify(i.options) : null,
      i.maxScore,
      i.weight,
      i.required ? 1 : 0,
    ]
  );
  return listQuestions(db, formId);
}

// ---------- responses / answers ----------

export interface AnswerInput {
  questionId: number;
  value: AnswerValue;
}

async function getAnswersByResponseIds(
  db: D1Database,
  responseIds: number[]
): Promise<Map<number, AnswerInput[]>> {
  const map = new Map<number, AnswerInput[]>();
  if (responseIds.length === 0) return map;
  const placeholders = responseIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT response_id, question_id, value_json FROM answers WHERE response_id IN (${placeholders})`)
    .bind(...responseIds)
    .all<{ response_id: number; question_id: number; value_json: string }>();
  for (const row of results ?? []) {
    const list = map.get(row.response_id) ?? [];
    list.push({ questionId: row.question_id, value: JSON.parse(row.value_json) as AnswerValue });
    map.set(row.response_id, list);
  }
  return map;
}

export async function getResponse(
  db: D1Database,
  formId: number,
  respondentId: number,
  teamId: number
): Promise<{ id: number; submittedAt: string } | null> {
  const row = await db
    .prepare('SELECT id, submitted_at FROM responses WHERE form_id = ? AND respondent_id = ? AND team_id = ?')
    .bind(formId, respondentId, teamId)
    .first<{ id: number; submitted_at: string }>();
  return row ? { id: row.id, submittedAt: row.submitted_at } : null;
}

/**
 * 回答をupsertする。
 * 1. INSERT ... ON CONFLICT DO UPDATE で responses 行をアトミックに作成/更新し id を得る
 *    (TOCTOU: 事前にgetResponseで存在確認してからINSERTする方式だと競合時に重複行やエラーが起こりうるため)
 * 2. answers の DELETE + INSERT を単一 batch にまとめる
 *    (別batchだとDELETE成功後にINSERTが失敗した場合、既存回答が消えたまま復元できない事故が起こる)
 */
export async function upsertResponse(
  db: D1Database,
  formId: number,
  respondentId: number,
  teamId: number,
  answers: AnswerInput[]
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO responses (form_id, respondent_id, team_id) VALUES (?, ?, ?)
       ON CONFLICT(form_id, respondent_id, team_id) DO UPDATE SET submitted_at = datetime('now')
       RETURNING id`
    )
    .bind(formId, respondentId, teamId)
    .first<{ id: number }>();
  const responseId = row!.id;

  const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM answers WHERE response_id = ?').bind(responseId)];
  for (const a of answers) {
    stmts.push(
      db
        .prepare('INSERT INTO answers (response_id, question_id, value_json) VALUES (?, ?, ?)')
        .bind(responseId, a.questionId, JSON.stringify(a.value))
    );
  }
  await db.batch(stmts);
  return responseId;
}

export async function listMyResponses(
  db: D1Database,
  formId: number,
  respondentId: number
): Promise<{ responses: { teamId: number; submittedAt: string; answers: AnswerInput[] }[] }> {
  const { results } = await db
    .prepare(
      'SELECT id, team_id, submitted_at FROM responses WHERE form_id = ? AND respondent_id = ? ORDER BY team_id'
    )
    .bind(formId, respondentId)
    .all<{ id: number; team_id: number; submitted_at: string }>();
  const rows = results ?? [];
  const answersMap = await getAnswersByResponseIds(db, rows.map((r) => r.id));
  return {
    responses: rows.map((r) => ({
      teamId: r.team_id,
      submittedAt: r.submitted_at,
      answers: answersMap.get(r.id) ?? [],
    })),
  };
}

export interface AdminResponseView {
  id: number;
  respondentId: number;
  respondentName: string;
  teamId: number;
  teamName: string;
  submittedAt: string;
  answers: AnswerInput[];
}

export async function listResponsesForForm(db: D1Database, formId: number): Promise<AdminResponseView[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id as id, r.respondent_id as respondent_id, resp.name as respondent_name,
              r.team_id as team_id, t.name as team_name, r.submitted_at as submitted_at
       FROM responses r
       JOIN respondents resp ON resp.id = r.respondent_id
       JOIN teams t ON t.id = r.team_id
       WHERE r.form_id = ?
       ORDER BY t.sort_order, resp.sort_order, r.id`
    )
    .bind(formId)
    .all<{
      id: number;
      respondent_id: number;
      respondent_name: string;
      team_id: number;
      team_name: string;
      submitted_at: string;
    }>();
  const rows = results ?? [];
  const answersMap = await getAnswersByResponseIds(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    respondentId: r.respondent_id,
    respondentName: r.respondent_name,
    teamId: r.team_id,
    teamName: r.team_name,
    submittedAt: r.submitted_at,
    answers: answersMap.get(r.id) ?? [],
  }));
}

/** 集計計算用: フォームの全回答を {teamId, answers} の形で返す */
export async function listResponsesForScoring(
  db: D1Database,
  formId: number
): Promise<{ teamId: number; answers: AnswerInput[] }[]> {
  const { results } = await db
    .prepare('SELECT id, team_id FROM responses WHERE form_id = ?')
    .bind(formId)
    .all<{ id: number; team_id: number }>();
  const rows = results ?? [];
  const answersMap = await getAnswersByResponseIds(db, rows.map((r) => r.id));
  return rows.map((r) => ({ teamId: r.team_id, answers: answersMap.get(r.id) ?? [] }));
}

// ---------- formulas ----------

export interface FormulaInput {
  id?: number;
  name: string;
  expression: string;
}

export async function listFormulas(db: D1Database, eventId: number): Promise<Formula[]> {
  const { results } = await db
    .prepare('SELECT * FROM formulas WHERE event_id = ? ORDER BY id')
    .bind(eventId)
    .all<FormulaRow>();
  return (results ?? []).map(mapFormula);
}

export async function upsertFormulas(db: D1Database, eventId: number, items: FormulaInput[]): Promise<Formula[]> {
  await upsertOrderedList(db, 'formulas', 'event_id', eventId, items, ['name', 'expression'], (i) => [
    i.name,
    i.expression,
  ]);
  return listFormulas(db, eventId);
}

/**
 * 計算式一覧を「削除しないマージ」で反映する (MCP set_formulas用)。
 * idが一致すれば更新、id無しは既存の計算式と同名なら更新扱い、一致しなければ追加。
 * items に含まれない既存の計算式は削除しない。
 */
export async function mergeFormulas(db: D1Database, eventId: number, items: FormulaInput[]): Promise<Formula[]> {
  const existingRes = await db
    .prepare('SELECT id, name FROM formulas WHERE event_id = ?')
    .bind(eventId)
    .all<{ id: number; name: string }>();
  const existing: MergeExistingRow[] = (existingRes.results ?? []).map((r) => ({ id: r.id, matchKey: r.name }));
  const mergeItems: MergeItemInput<FormulaInput>[] = items.map((i) => ({ id: i.id, matchKey: i.name, data: i }));
  const plan = planMergeUpsert(existing, mergeItems);
  await executeMergePlan(db, 'formulas', 'event_id', eventId, plan, ['name', 'expression'], (i) => [
    i.name,
    i.expression,
  ]);
  return listFormulas(db, eventId);
}
