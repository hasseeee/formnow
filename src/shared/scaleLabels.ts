// 評価（rating）の段階ごとの説明の検証と長さ合わせ。
// サーバー（管理API・MCP）とエディタが同じ規則を使うため shared に置く。DB・HTTP・React に依存しない純関数。
import type { QuestionType } from './types';

/** 1 つの説明の最大文字数 */
export const SCALE_LABEL_MAX_LENGTH = 40;
/** 説明を付けられる段階数の上限（= maxScore の上限） */
export const SCALE_LABELS_MAX_STEPS = 100;

function isValidSteps(n: number | null): n is number {
  return n !== null && Number.isInteger(n) && n >= 1 && n <= SCALE_LABELS_MAX_STEPS;
}

/** 保存前の検証と正規化。ok なら保存する値（null = 説明なし）を返す */
export function normalizeScaleLabels(q: {
  type: QuestionType;
  maxScore: number | null;
  scaleLabels?: string[] | null;
}): { ok: true; value: string[] | null } | { ok: false; error: string } {
  if (q.scaleLabels === undefined || q.scaleLabels === null) return { ok: true, value: null };
  const labels = q.scaleLabels.map((l) => l.trim());
  // 「説明なし」の表し方は null の 1 通りに揃える
  if (labels.every((l) => l === '')) return { ok: true, value: null };
  if (q.type !== 'rating') {
    return { ok: false, error: 'scaleLabels は評価（rating）の質問にだけ付けられます' };
  }
  if (!isValidSteps(q.maxScore)) {
    return {
      ok: false,
      error: 'scaleLabels を付けるには maxScore を 1〜100 の整数にしてください',
    };
  }
  if (labels.length !== q.maxScore) {
    return {
      ok: false,
      error: `scaleLabels の数（${labels.length}）が maxScore（${q.maxScore}）と一致しません`,
    };
  }
  return { ok: true, value: labels };
}

/**
 * 段階数を変えたときの配列の長さ合わせ（エディタ用）。
 * 両端の説明だけを引き継ぎ、途中は消す（5 段階の「3 = ふつう」は 7 段階では真ん中でなくなるため）。
 */
export function resizeScaleLabels(labels: string[] | null, newMax: number | null): string[] | null {
  if (labels === null) return null;
  if (!isValidSteps(newMax)) return null;
  if (labels.length === newMax) return labels;
  const next: string[] = Array(newMax).fill('');
  next[0] = labels[0] ?? '';
  if (newMax >= 2 && labels.length >= 2) next[newMax - 1] = labels[labels.length - 1];
  return next.every((l) => l === '') ? null : next;
}
