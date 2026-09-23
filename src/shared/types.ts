// FormNow 共有型定義 — API契約。バックエンド/フロントエンド/MCPはすべてここに従う。

export type Role = 'judge' | 'member';
export type FormKind = 'judge' | 'peer';
export type FormStatus = 'draft' | 'open' | 'closed';
export type QuestionType = 'rating' | 'number' | 'choice' | 'checkbox' | 'text' | 'textarea';

export interface Event {
  id: number;
  name: string;
  createdAt: string;
}

export interface Team {
  id: number;
  eventId: number;
  name: string;
  sortOrder: number;
}

export interface Respondent {
  id: number;
  eventId: number;
  name: string;
  role: Role;
  teamId: number | null;
  sortOrder: number;
}

/** choice/checkbox の選択肢。score を持つ選択肢は採点対象になる */
export interface QuestionOption {
  label: string;
  score?: number;
}

export interface Question {
  id: number;
  formId: number;
  sortOrder: number;
  type: QuestionType;
  labelMd: string;
  options: QuestionOption[] | null;
  maxScore: number | null;
  weight: number;
  required: boolean;
  /**
   * 評価（rating）の段階ごとの説明。labels[i] が値 i+1 の説明、長さは maxScore と同じ。
   * 説明を付けない段階は空文字。説明がまったくなければ null。rating 以外は常に null
   */
  scaleLabels: string[] | null;
}

export interface Form {
  id: number;
  eventId: number;
  slug: string;
  title: string;
  descriptionMd: string;
  kind: FormKind;
  status: FormStatus;
  sheetId: string | null;
  createdAt: string;
}

/**
 * 回答値:
 * - rating/number: number
 * - choice: string (選択肢label)
 * - checkbox: string[]
 * - text/textarea: string
 */
export type AnswerValue = number | string | string[];

// ---------- 公開API ----------

/**
 * 回答者に公開する質問。採点の内部情報（weight・選択肢のscore）は含めない。
 * 段階の説明（scaleLabels）は回答者に見せる情報なので公開する。
 * サーバー側で buildPublicFormView がこの形に落とす。
 */
export type PublicQuestion = Omit<Question, 'weight' | 'options'> & {
  options: Pick<QuestionOption, 'label'>[] | null;
};

/** GET /api/forms/:slug */
export interface PublicFormView {
  form: Form;
  questions: PublicQuestion[];
  teams: Team[];
  /** このフォームの対象回答者（judge形式ならjudge、peer形式ならmember）。名前選択UI用 */
  respondents: Pick<Respondent, 'id' | 'name' | 'teamId'>[];
}

/** POST /api/forms/:slug/responses のボディ */
export interface SubmitResponseRequest {
  respondentId: number;
  teamId: number;
  answers: { questionId: number; value: AnswerValue }[];
}

/** GET /api/forms/:slug/responses?respondentId=N */
export interface MyResponsesView {
  responses: {
    teamId: number;
    submittedAt: string;
    answers: { questionId: number; value: AnswerValue }[];
  }[];
}

// ---------- 集計 ----------

/** チーム別集計（フォーム単位） GET /api/admin/forms/:id/summary */
export interface TeamSummary {
  teamId: number;
  teamName: string;
  count: number;
  sum: number;
  avg: number | null;
  rank: number | null;
  /** 質問ID→平均スコア（採点対象の質問のみ） */
  questionAvgs: Record<number, number>;
  /**
   * 標準化平均: 回答者ごとに自分のスコアを平均0・ばらつき1にそろえた値の、このチームでの平均。
   * 回答1件だけ・全部同じ点の回答者の回答は使わない。使える回答がなければ null
   */
  zAvg: number | null;
  /** zAvg の降順の順位（同点は同順位）。zAvg が null なら null */
  zRank: number | null;
}

/** 回答者ごとの傾向（フォーム単位）。1件以上回答した回答者だけ、名簿順 */
export interface RespondentSummary {
  respondentId: number;
  respondentName: string;
  /** 回答したチーム数 */
  count: number;
  /** この回答者が付けたスコア（回答1件のスコア）の平均 */
  avg: number;
  /** avg − フォームの全回答のスコア平均。プラスなら甘め */
  avgDiff: number;
  /** スコアの母標準偏差。count が 1 なら null */
  sd: number | null;
  /** 標準化平均の計算に使ったか（count ≥ 2 かつ sd > 0） */
  standardized: boolean;
}

export interface FormSummary {
  formId: number;
  formSlug: string;
  maxPossibleScore: number;
  teams: TeamSummary[];
  respondents: RespondentSummary[];
}

export interface Formula {
  id: number;
  eventId: number;
  name: string;
  expression: string;
}

/** GET /api/admin/events/:id/formula-results */
export interface FormulaResults {
  formulas: {
    formula: Formula;
    /** teamId→計算結果。エラー時は error にメッセージ */
    results: Record<number, number | null>;
    error: string | null;
    ranking: { teamId: number; teamName: string; value: number | null; rank: number | null }[];
  }[];
}

// ---------- エラー ----------

export interface ApiError {
  error: string;
}

// ---------- 管理画面の権限 ----------

export type AdminRole = 'admin' | 'viewer';

export interface AdminMe {
  role: AdminRole;
}
