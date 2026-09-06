// 純粋関数: 回答1件のスコア計算。D1に依存しない。
import type { AnswerValue, Question } from '../../shared/types';

/** 採点対象になりうる質問タイプ (text/textarea は対象外) */
function isScorableType(type: Question['type']): boolean {
  return type === 'rating' || type === 'number' || type === 'choice' || type === 'checkbox';
}

/**
 * 回答値を数値化する。
 * - rating/number: 値そのもの (数値化できなければ null)
 * - choice: options 内で label が一致する選択肢の score (無ければ0)
 * - checkbox: 選択した各 label に対応する選択肢の score の合計 (一致なしは0扱い)
 * - text/textarea: 採点対象外 (null)
 */
export function numericValue(question: Question, value: AnswerValue): number | null {
  switch (question.type) {
    case 'rating':
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'choice': {
      if (typeof value !== 'string') return null;
      const opt = (question.options ?? []).find((o) => o.label === value);
      return opt ? (opt.score ?? 0) : 0;
    }
    case 'checkbox': {
      if (!Array.isArray(value)) return null;
      const options = question.options ?? [];
      return value.reduce((sum: number, label) => {
        const opt = options.find((o) => o.label === label);
        return sum + (opt?.score ?? 0);
      }, 0);
    }
    case 'text':
    case 'textarea':
    default:
      return null;
  }
}

/** 回答1件のスコア = Σ(数値化した回答値 × 質問weight)。採点対象外の質問は無視する。 */
export function responseScore(
  questions: Question[],
  answers: { questionId: number; value: AnswerValue }[]
): number {
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  let total = 0;
  for (const answer of answers) {
    const question = questionMap.get(answer.questionId);
    if (!question) continue;
    const value = numericValue(question, answer.value);
    if (value === null) continue;
    total += value * question.weight;
  }
  return total;
}

/**
 * フォーム全体の理論上の最大スコア。
 * - rating/number: maxScore × weight
 * - choice: 選択肢の最大 score × weight
 * - checkbox: 全選択肢の score 合計 × weight
 * - text/textarea: 0 (採点対象外)
 */
export function maxPossibleScore(questions: Question[]): number {
  let total = 0;
  for (const question of questions) {
    if (!isScorableType(question.type)) continue;
    switch (question.type) {
      case 'rating':
      case 'number':
        total += (question.maxScore ?? 0) * question.weight;
        break;
      case 'choice': {
        const max = (question.options ?? []).reduce((m, o) => Math.max(m, o.score ?? 0), 0);
        total += max * question.weight;
        break;
      }
      case 'checkbox': {
        const sum = (question.options ?? []).reduce((s, o) => s + (o.score ?? 0), 0);
        total += sum * question.weight;
        break;
      }
      default:
        break;
    }
  }
  return total;
}
