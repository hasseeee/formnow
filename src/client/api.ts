// FormNow フロントエンド用 fetch ラッパー。
// src/shared/types.ts のAPI契約に厳密に従う。管理系エンドポイントには自動で
// Authorization: Bearer <adminToken> を付与し、401時はリスナーに通知する。

import type {
  AnswerValue,
  Event,
  Form,
  FormKind,
  Formula,
  FormulaResults,
  FormStatus,
  FormSummary,
  MyResponsesView,
  PublicFormView,
  Question,
  QuestionOption,
  QuestionType,
  Respondent,
  Role,
  SubmitResponseRequest,
  Team,
} from '../shared/types';

// ---------- 管理トークン ----------

const ADMIN_TOKEN_KEY = 'formnow:adminToken';

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    /* localStorageが使用できない環境では無視する */
  }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

type UnauthorizedListener = () => void;
let unauthorizedListener: UnauthorizedListener | null = null;

/** 401応答を受け取った際に呼ばれるリスナーを登録する（管理画面のトークン入力に戻すため） */
export function setUnauthorizedListener(listener: UnauthorizedListener | null): void {
  unauthorizedListener = listener;
}

function notifyUnauthorized(): void {
  // 並行リクエストが同時に401を返すと複数回呼ばれうるため、
  // 既にトークンが失効済み（＝通知済み）なら再通知しない
  if (getAdminToken() === null) return;
  clearAdminToken();
  unauthorizedListener?.();
}

// ---------- 共通リクエスト処理 ----------

export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (data && typeof data.error === 'string' && data.error.trim() !== '') {
      return data.error;
    }
  } catch {
    /* JSONでないレスポンスはフォールバックメッセージを使う */
  }
  return fallback;
}

interface RequestOptions extends RequestInit {
  admin?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { admin, headers: rawHeaders, ...rest } = options;
  const headers = new Headers(rawHeaders);
  if (rest.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (admin) {
    const token = getAdminToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...rest, headers });

  if (!res.ok) {
    const fallback = `リクエストに失敗しました (${res.status})`;
    const message = await readErrorMessage(res, fallback);
    if (res.status === 401 && admin) {
      notifyUnauthorized();
    }
    throw new ApiRequestError(message, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  if (text === '') {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

function toJsonBody(body: unknown): string {
  return JSON.stringify(body);
}

// ---------- 公開API ----------

export function getPublicForm(slug: string): Promise<PublicFormView> {
  return request<PublicFormView>(`/api/forms/${encodeURIComponent(slug)}`);
}

export function getMyResponses(slug: string, respondentId: number): Promise<MyResponsesView> {
  const params = new URLSearchParams({ respondentId: String(respondentId) });
  return request<MyResponsesView>(
    `/api/forms/${encodeURIComponent(slug)}/responses?${params.toString()}`,
  );
}

export function submitResponse(slug: string, body: SubmitResponseRequest): Promise<void> {
  return request<void>(`/api/forms/${encodeURIComponent(slug)}/responses`, {
    method: 'POST',
    body: toJsonBody(body),
  });
}

// ---------- 管理API 補助型 ----------
// (以下はsrc/shared/types.tsに定義がないエンドポイントのための、クライアント側の想定型)

export interface EventDetailView {
  event: Event;
  teams: Team[];
  respondents: Respondent[];
  forms: Form[];
  formulas: Formula[];
}

export interface TeamInput {
  id?: number;
  name: string;
  sortOrder: number;
}

export interface RespondentInput {
  id?: number;
  name: string;
  role: Role;
  teamId: number | null;
  sortOrder: number;
}

export interface FormDetailView {
  form: Form;
  questions: Question[];
}

export interface QuestionInput {
  id?: number;
  sortOrder: number;
  type: QuestionType;
  labelMd: string;
  options: QuestionOption[] | null;
  maxScore: number | null;
  weight: number;
  required: boolean;
  /** 必須にしておくと、質問をコピーする箇所で書き漏らしたときに型チェックで分かる */
  scaleLabels: string[] | null;
}

export interface FormulaInput {
  id?: number;
  name: string;
  expression: string;
}

export interface FormResponseAnswer {
  questionId: number;
  value: AnswerValue;
}

export interface FormResponseItem {
  id: number;
  respondentId: number;
  respondentName: string;
  teamId: number;
  teamName: string;
  submittedAt: string;
  answers: FormResponseAnswer[];
}

export interface FormResponsesView {
  responses: FormResponseItem[];
}

export interface SyncSheetsResult {
  ok: boolean;
  rows?: number;
}

// ---------- 管理API ----------

export function listEvents(): Promise<Event[]> {
  return request<Event[]>('/api/admin/events', { admin: true });
}

export function createEvent(name: string): Promise<Event> {
  return request<Event>('/api/admin/events', {
    admin: true,
    method: 'POST',
    body: toJsonBody({ name }),
  });
}

export function getEventDetail(id: number): Promise<EventDetailView> {
  return request<EventDetailView>(`/api/admin/events/${id}`, { admin: true });
}

export function deleteEvent(id: number): Promise<void> {
  return request<void>(`/api/admin/events/${id}`, { admin: true, method: 'DELETE' });
}

export function saveTeams(eventId: number, teams: TeamInput[]): Promise<Team[]> {
  return request<Team[]>(`/api/admin/events/${eventId}/teams`, {
    admin: true,
    method: 'PUT',
    body: toJsonBody({ teams }),
  });
}

export function saveRespondents(
  eventId: number,
  respondents: RespondentInput[],
): Promise<Respondent[]> {
  return request<Respondent[]>(`/api/admin/events/${eventId}/respondents`, {
    admin: true,
    method: 'PUT',
    body: toJsonBody({ respondents }),
  });
}

export interface CreateFormInput {
  eventId: number;
  /** 省略時はサーバー側で自動生成 */
  slug?: string;
  title: string;
  descriptionMd: string;
  kind: FormKind;
}

export function createForm(input: CreateFormInput): Promise<Form> {
  return request<Form>('/api/admin/forms', {
    admin: true,
    method: 'POST',
    body: toJsonBody(input),
  });
}

export function getForm(id: number): Promise<FormDetailView> {
  return request<FormDetailView>(`/api/admin/forms/${id}`, { admin: true });
}

export function deleteForm(id: number): Promise<void> {
  return request<void>(`/api/admin/forms/${id}`, { admin: true, method: 'DELETE' });
}

export type UpdateFormPatch = Partial<
  Pick<Form, 'title' | 'descriptionMd' | 'status' | 'sheetId' | 'kind'>
>;

export function updateForm(id: number, patch: UpdateFormPatch): Promise<Form> {
  return request<Form>(`/api/admin/forms/${id}`, {
    admin: true,
    method: 'PATCH',
    body: toJsonBody(patch),
  });
}

/** GET /api/admin/forms/:id/preview — 回答画面プレビュー用。PublicFormViewと同一形状（draft/closedでも取得可） */
export function getFormPreview(id: number): Promise<PublicFormView> {
  return request<PublicFormView>(`/api/admin/forms/${id}/preview`, { admin: true });
}

export function saveQuestions(formId: number, questions: QuestionInput[]): Promise<Question[]> {
  return request<Question[]>(`/api/admin/forms/${formId}/questions`, {
    admin: true,
    method: 'PUT',
    body: toJsonBody({ questions }),
  });
}

export function saveFormulas(eventId: number, formulas: FormulaInput[]): Promise<Formula[]> {
  return request<Formula[]>(`/api/admin/events/${eventId}/formulas`, {
    admin: true,
    method: 'PUT',
    body: toJsonBody({ formulas }),
  });
}

export function getFormSummary(formId: number): Promise<FormSummary> {
  return request<FormSummary>(`/api/admin/forms/${formId}/summary`, { admin: true });
}

export function getFormResponses(formId: number): Promise<FormResponsesView> {
  return request<FormResponsesView>(`/api/admin/forms/${formId}/responses`, { admin: true });
}

export function getFormulaResults(eventId: number): Promise<FormulaResults> {
  return request<FormulaResults>(`/api/admin/events/${eventId}/formula-results`, {
    admin: true,
  });
}

export function syncSheets(formId: number): Promise<SyncSheetsResult> {
  return request<SyncSheetsResult>(`/api/admin/forms/${formId}/sync-sheets`, {
    admin: true,
    method: 'POST',
  });
}

export function exportCsvUrl(formId: number): string {
  return `/api/admin/forms/${formId}/export.csv`;
}

/** CSVをAuthorizationヘッダ付きで取得し、ブラウザにダウンロードさせる */
export async function downloadFormCsv(formId: number, filename: string): Promise<void> {
  const token = getAdminToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(exportCsvUrl(formId), { headers });
  if (!res.ok) {
    const fallback = `CSVのダウンロードに失敗しました (${res.status})`;
    const message = await readErrorMessage(res, fallback);
    if (res.status === 401) notifyUnauthorized();
    throw new ApiRequestError(message, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type { FormStatus };
