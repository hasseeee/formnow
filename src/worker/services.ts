// 集計系のサービス関数。admin.ts (REST API) と mcp/tools.ts (MCPツール) の両方から
// 呼び出される共通ロジックをここに集約し、重複実装を避ける。
import * as db from './db';
import {
  aggregateTeamSummaries,
  computeRanks,
  computeRespondentSummaries,
  computeStandardizedTeamAverages,
  sortByRank,
  withStandardized,
} from './logic/aggregate';
import { evaluate } from './logic/formula';
import { maxPossibleScore } from './logic/scoring';
import type { Form, FormSummary, FormulaResults, PublicFormView } from '../shared/types';

/** evaluate() が「不明な変数」で投げた例外かどうかを判定する */
function isUnknownVariableError(e: unknown): boolean {
  return e instanceof Error && /^不明な変数です/.test(e.message);
}

/**
 * PublicFormView (回答画面用のフォーム一式) の組み立て。
 * 公開API (GET /api/forms/:slug) と管理APIのプレビュー (GET /api/admin/forms/:id/preview) の
 * 両方から呼び出される共通ロジック。draft/closed の可否判定は呼び出し側の責務とする。
 */
export async function buildPublicFormView(
  database: D1Database,
  form: Form,
): Promise<PublicFormView> {
  const [questions, teams, respondents] = await Promise.all([
    db.listQuestions(database, form.id),
    db.listTeams(database, form.eventId),
    db.listRespondentsForFormKind(database, form.eventId, form.kind),
  ]);

  return {
    form,
    // 採点の内部情報（weight・選択肢のscore）は回答者に公開しない
    questions: questions.map(({ weight: _weight, options, ...rest }) => ({
      ...rest,
      options: options ? options.map((o) => ({ label: o.label })) : null,
    })),
    teams,
    respondents: respondents.map((r) => ({ id: r.id, name: r.name, teamId: r.teamId })),
  };
}

/** フォームのチーム別集計 (GET /api/admin/forms/:id/summary と同じ計算)。フォームが無ければ null。 */
export async function computeFormSummary(
  database: D1Database,
  formId: number,
): Promise<FormSummary | null> {
  const form = await db.getFormById(database, formId);
  if (!form) return null;

  const [questions, teams, responses, respondents] = await Promise.all([
    db.listQuestions(database, formId),
    db.listTeams(database, form.eventId),
    db.listResponsesForScoring(database, formId),
    db.listRespondents(database, form.eventId),
  ]);

  return {
    formId: form.id,
    formSlug: form.slug,
    maxPossibleScore: maxPossibleScore(questions),
    teams: withStandardized(
      aggregateTeamSummaries(responses, questions, teams),
      computeStandardizedTeamAverages(responses, questions, teams),
    ),
    respondents: computeRespondentSummaries(responses, questions, respondents),
  };
}

/** イベント単位の自由計算式の結果 (GET /api/admin/events/:id/formula-results と同じ計算)。イベントが無ければ null。 */
export async function computeFormulaResults(
  database: D1Database,
  eventId: number,
): Promise<FormulaResults | null> {
  const event = await db.getEvent(database, eventId);
  if (!event) return null;

  const [formulas, teams, forms] = await Promise.all([
    db.listFormulas(database, eventId),
    db.listTeams(database, eventId),
    db.listForms(database, eventId),
  ]);

  const varsByTeam = new Map<number, Record<string, number>>();
  for (const team of teams) varsByTeam.set(team.id, {});

  for (const form of forms) {
    const [questions, responses] = await Promise.all([
      db.listQuestions(database, form.id),
      db.listResponsesForScoring(database, form.id),
    ]);
    const summaries = aggregateTeamSummaries(responses, questions, teams);
    for (const s of summaries) {
      const vars = varsByTeam.get(s.teamId);
      if (!vars) continue;
      // count=0 (回答0件) の場合、avg は欠損値であり 0 と区別する必要があるため変数登録しない
      // (未登録の変数を式が参照すると evaluate が「不明な変数」例外を投げ、そのチームの結果はnullになる)
      if (s.count > 0) {
        vars[`${form.slug}_avg`] = s.avg ?? 0;
      }
      vars[`${form.slug}_sum`] = s.sum;
      vars[`${form.slug}_count`] = s.count;
    }
    // 標準化平均も _avg と同じく、値がない (null) チームには登録しない
    for (const [teamId, { zAvg }] of computeStandardizedTeamAverages(responses, questions, teams)) {
      const vars = varsByTeam.get(teamId);
      if (vars && zAvg !== null) vars[`${form.slug}_zavg`] = zAvg;
    }
  }

  const formulaResults: FormulaResults['formulas'] = formulas.map((formula) => {
    const results: Record<number, number | null> = {};
    let errorMsg: string | null = null;
    for (const team of teams) {
      const vars = varsByTeam.get(team.id) ?? {};
      try {
        results[team.id] = evaluate(formula.expression, vars);
      } catch (e) {
        results[team.id] = null;
        // 「不明な変数」は回答0件由来の欠損なので、そのチームの結果をnullにするだけで
        // 式全体のエラーにはしない。それ以外 (構文エラー等、全チーム共通で失敗するもの) は従来どおり記録する。
        if (!errorMsg && !isUnknownVariableError(e)) {
          errorMsg = e instanceof Error ? e.message : String(e);
        }
      }
    }

    const rankMap = computeRanks(teams.map((t) => ({ id: t.id, value: results[t.id] })));
    const ranking = teams.map((team) => ({
      teamId: team.id,
      teamName: team.name,
      value: results[team.id],
      rank: rankMap.get(team.id) ?? null,
    }));

    return { formula, results, error: errorMsg, ranking: sortByRank(ranking) };
  });

  return { formulas: formulaResults };
}
