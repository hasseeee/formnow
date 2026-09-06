// Googleスプレッドシート連携。
// googleapis パッケージは Workers 環境では使えないため、REST APIを直叩きする。
// アクセストークンはサービスアカウントのJWT (RS256, WebCrypto署名) をoauth2.googleapis.comへ
// 交換して取得する。isolateの寿命内でベストエフォートにモジュールスコープへキャッシュする。
import type { Env } from './env';
import * as db from './db';
import type { AdminResponseView } from './db';
import { computeFormSummary, computeFormulaResults } from './services';
import { stripMarkdown } from './logic/csv';
import { responseScore } from './logic/scoring';
import type { AnswerValue, Question } from '../shared/types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/** sheet_id/シークレット未設定などの設定エラー。呼び出し側で400として扱う。 */
export class SheetsConfigError extends Error {}

/** Google Sheets API呼び出し失敗。呼び出し側で502として扱う。 */
export class SheetsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = 'SheetsApiError';
  }
}

// ---------- 純関数: PEM解析・base64url ----------

/** PEM形式 (-----BEGIN...-----/-----END...-----、改行含む) をArrayBufferにデコードする */
export function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlEncodeString(input: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(input));
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function parseServiceAccountJson(json: string): ServiceAccountKey {
  const parsed = JSON.parse(json) as Partial<ServiceAccountKey>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new SheetsConfigError('GOOGLE_SERVICE_ACCOUNT_JSON の形式が不正です (client_email/private_keyが必要)');
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

/** JWTのヘッダー+ペイロード部分 (署名前、base64url結合済み) を組み立てる。純粋関数。 */
export function buildJwtSigningInput(clientEmail: string, scope: string, nowEpochSeconds: number): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope,
    aud: TOKEN_URL,
    iat: nowEpochSeconds,
    exp: nowEpochSeconds + 3600,
  };
  return `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(payload))}`;
}

// ---------- アクセストークン取得 (isolate内キャッシュ、ベストエフォート) ----------

let cachedToken: { token: string; expiresAtMs: number; keyFingerprint: string } | null = null;

async function signJwt(serviceAccountJson: string): Promise<string> {
  const key = parseServiceAccountJson(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const signingInput = buildJwtSigningInput(key.client_email, SHEETS_SCOPE, now);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(key.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const fingerprint = serviceAccountJson.length + ':' + serviceAccountJson.slice(0, 32);
  const now = Date.now();
  if (cachedToken && cachedToken.keyFingerprint === fingerprint && cachedToken.expiresAtMs > now + 60_000) {
    return cachedToken.token;
  }

  const assertion = await signJwt(serviceAccountJson);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SheetsApiError('アクセストークンの取得に失敗しました', res.status, body);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAtMs: now + data.expires_in * 1000,
    keyFingerprint: fingerprint,
  };
  return data.access_token;
}

// ---------- 純関数: シート名・範囲・行データの組み立て ----------

/** シート名をrange表記用にシングルクォートでエスケープする (内部の ' は '' にする) */
export function escapeSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

export function responseTabName(slug: string): string {
  return `${slug}_回答`;
}

export function summaryTabName(slug: string): string {
  return `${slug}_集計`;
}

type CellValue = string | number;

/** 回答タブのヘッダー行 */
export function buildResponseHeaderRow(questions: Question[]): CellValue[] {
  return ['回答者', 'チーム', '送信日時', ...questions.map((q) => stripMarkdown(q.labelMd)), '合計スコア'];
}

/** 回答タブの1行分のデータ */
export function buildResponseDataRow(
  questions: Question[],
  response: { respondentName: string; teamName: string; submittedAt: string; answers: { questionId: number; value: AnswerValue }[] }
): CellValue[] {
  const answerByQuestion = new Map(response.answers.map((a) => [a.questionId, a.value]));
  const score = responseScore(questions, response.answers);
  const cells = questions.map((q) => {
    const value = answerByQuestion.get(q.id);
    if (value === undefined) return '';
    return Array.isArray(value) ? value.join(', ') : value;
  });
  return [response.respondentName, response.teamName, response.submittedAt, ...cells, score];
}

export interface SummarySheetTeamRow {
  rank: number | null;
  teamName: string;
  count: number;
  sum: number;
  avg: number | null;
  questionAvgs: Record<number, number>;
}

export interface SummarySheetFormulaSection {
  name: string;
  ranking: { teamName: string; value: number | null; rank: number | null }[];
}

/**
 * 「集計」タブの全行を組み立てる。
 * 順位, チーム, 回答数, 平均, 合計, 質問別平均列 のあと、計算式があれば空行を挟んで
 * 各計算式のランキング (順位, チーム, 値) を続ける。
 */
export function buildSummarySheetRows(
  teamRows: SummarySheetTeamRow[],
  scoredQuestions: Question[],
  formulaSections: SummarySheetFormulaSection[]
): CellValue[][] {
  const header: CellValue[] = ['順位', 'チーム', '回答数', '平均', '合計', ...scoredQuestions.map((q) => stripMarkdown(q.labelMd))];
  const rows: CellValue[][] = [header];
  for (const t of teamRows) {
    rows.push([
      t.rank ?? '',
      t.teamName,
      t.count,
      t.avg ?? '',
      t.sum,
      ...scoredQuestions.map((q) => t.questionAvgs[q.id] ?? ''),
    ]);
  }

  for (const section of formulaSections) {
    rows.push([]);
    rows.push([`計算式: ${section.name}`]);
    rows.push(['順位', 'チーム', '値']);
    for (const r of section.ranking) {
      rows.push([r.rank ?? '', r.teamName, r.value ?? '']);
    }
  }

  return rows;
}

// ---------- Sheets API呼び出し ----------

async function sheetsFetch(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${SHEETS_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SheetsApiError(`Google Sheets APIエラー (${path})`, res.status, body);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

async function getSheetTitles(accessToken: string, spreadsheetId: string): Promise<string[]> {
  const data = (await sheetsFetch(
    accessToken,
    `/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`
  )) as { sheets?: { properties?: { title?: string } }[] };
  return (data.sheets ?? []).map((s) => s.properties?.title).filter((t): t is string => !!t);
}

async function addSheetTab(accessToken: string, spreadsheetId: string, title: string): Promise<void> {
  await sheetsFetch(accessToken, `/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
}

/** タブが無ければ作成する */
async function ensureTabExists(accessToken: string, spreadsheetId: string, tabName: string): Promise<void> {
  const titles = await getSheetTitles(accessToken, spreadsheetId);
  if (!titles.includes(tabName)) {
    await addSheetTab(accessToken, spreadsheetId, tabName);
  }
}

async function clearSheet(accessToken: string, spreadsheetId: string, tabName: string): Promise<void> {
  const range = `${escapeSheetName(tabName)}`;
  await sheetsFetch(accessToken, `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

async function writeSheetValues(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  values: CellValue[][]
): Promise<void> {
  const range = `${escapeSheetName(tabName)}!A1`;
  await sheetsFetch(
    accessToken,
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      body: JSON.stringify({ range, values }),
    }
  );
}

async function appendSheetRow(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  row: CellValue[]
): Promise<void> {
  const range = `${escapeSheetName(tabName)}!A1`;
  await sheetsFetch(
    accessToken,
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      body: JSON.stringify({ range, values: [row] }),
    }
  );
}

// ---------- 公開関数 ----------

/**
 * 回答1件を「<slug>_回答」タブに1行追記する。
 * フォームにsheet_idが無い、またはシークレット未設定なら何もしない (silent no-op)。
 * Google API呼び出しに失敗した場合は例外を投げる (呼び出し側 public.ts がbest-effortで握りつぶす)。
 */
export async function appendResponseToSheet(env: Env, formId: number, responseId: number): Promise<void> {
  const form = await db.getFormById(env.DB, formId);
  if (!form || !form.sheetId || !env.GOOGLE_SERVICE_ACCOUNT_JSON) return;

  const accessToken = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const [questions, responses] = await Promise.all([
    db.listQuestions(env.DB, formId),
    db.listResponsesForForm(env.DB, formId),
  ]);
  const response = responses.find((r) => r.id === responseId);
  if (!response) return;

  const tabName = responseTabName(form.slug);
  await ensureTabExists(accessToken, form.sheetId, tabName);

  // ヘッダー行が無ければ (新規タブ) 書いておく
  const headerRow = buildResponseHeaderRow(questions);
  await writeSheetValuesIfEmpty(accessToken, form.sheetId, tabName, headerRow);

  const row = buildResponseDataRow(questions, response);
  await appendSheetRow(accessToken, form.sheetId, tabName, row);
}

async function writeSheetValuesIfEmpty(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  headerRow: CellValue[]
): Promise<void> {
  const range = `${escapeSheetName(tabName)}!A1:A1`;
  const data = (await sheetsFetch(accessToken, `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`)) as {
    values?: unknown[][];
  } | null;
  const hasHeader = !!data?.values && data.values.length > 0;
  if (!hasHeader) {
    await writeSheetValues(accessToken, spreadsheetId, tabName, [headerRow]);
  }
}

async function requireSheetsContext(
  env: Env,
  formId: number
): Promise<{ sheetId: string; slug: string; eventId: number; serviceAccountJson: string }> {
  const form = await db.getFormById(env.DB, formId);
  if (!form) throw new SheetsConfigError('フォームが見つかりません');
  if (!form.sheetId) throw new SheetsConfigError('シートIDが設定されていません');
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new SheetsConfigError('Sheets連携が未設定です(GOOGLE_SERVICE_ACCOUNT_JSON)');
  }
  return { sheetId: form.sheetId, slug: form.slug, eventId: form.eventId, serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON };
}

function isScorableType(type: Question['type']): boolean {
  return type === 'rating' || type === 'number' || type === 'choice' || type === 'checkbox';
}

/**
 * フォームの全回答で「<slug>_回答」タブを書き直し、「<slug>_集計」タブにチーム別集計
 * (＋イベントに計算式があればその結果ランキング) を書く。
 */
export async function syncFormToSheet(env: Env, formId: number): Promise<{ rows: number }> {
  const { sheetId, slug, eventId, serviceAccountJson } = await requireSheetsContext(env, formId);
  const accessToken = await getAccessToken(serviceAccountJson);

  const [questions, responses] = await Promise.all([
    db.listQuestions(env.DB, formId),
    db.listResponsesForForm(env.DB, formId),
  ]);

  const responseTab = responseTabName(slug);
  const headerRow = buildResponseHeaderRow(questions);
  const dataRows = responses.map((r: AdminResponseView) => buildResponseDataRow(questions, r));
  await ensureTabExists(accessToken, sheetId, responseTab);
  await clearSheet(accessToken, sheetId, responseTab);
  await writeSheetValues(accessToken, sheetId, responseTab, [headerRow, ...dataRows]);

  const summary = await computeFormSummary(env.DB, formId);
  const scoredQuestions = questions.filter((q) => isScorableType(q.type));
  const teamRows: SummarySheetTeamRow[] = (summary?.teams ?? []).map((t) => ({
    rank: t.rank,
    teamName: t.teamName,
    count: t.count,
    sum: t.sum,
    avg: t.avg,
    questionAvgs: t.questionAvgs,
  }));

  const formulaResults = await computeFormulaResults(env.DB, eventId);
  const formulaSections: SummarySheetFormulaSection[] = (formulaResults?.formulas ?? []).map((f) => ({
    name: f.formula.name,
    ranking: f.ranking.map((r) => ({ teamName: r.teamName, value: r.value, rank: r.rank })),
  }));

  const summaryTab = summaryTabName(slug);
  const summaryRows = buildSummarySheetRows(teamRows, scoredQuestions, formulaSections);
  await ensureTabExists(accessToken, sheetId, summaryTab);
  await clearSheet(accessToken, sheetId, summaryTab);
  await writeSheetValues(accessToken, sheetId, summaryTab, summaryRows);

  return { rows: dataRows.length };
}
