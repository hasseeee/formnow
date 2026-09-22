import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AnswerValue, PublicQuestion, Team } from '../../../shared/types';
import { ApiRequestError } from '../../api';
import QuestionField from './QuestionField';

export type AnswerMap = Record<number, AnswerValue | null>;

interface Props {
  team: Team;
  questions: PublicQuestion[];
  initialAnswers: AnswerMap;
  progressLabel: string;
  /** 送信ボタンの文言（保存後の遷移先に合わせて呼び出し側が決める） */
  submitLabel: string;
  onSubmit: (answers: AnswerMap) => Promise<void>;
  onPrev?: () => void;
  /** 入力が変わるたびに呼ぶ（チームを移っても入力途中の内容を残すため） */
  onAnswersChange?: (answers: AnswerMap) => void;
  submitting: boolean;
}

export default function TeamEvaluationStep({
  team,
  questions,
  initialAnswers,
  progressLabel,
  submitLabel,
  onSubmit,
  onPrev,
  onAnswersChange,
  submitting,
}: Props) {
  const [answers, setAnswers] = useState<AnswerMap>(() => ({ ...initialAnswers }));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // 検証に失敗するたびに +1 する。エラー表示が DOM に出た後の描画で最初のエラー項目へスクロールする
  const [scrollRequest, setScrollRequest] = useState(0);
  const questionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRequest === 0) return;
    // QuestionField はエラー時に外枠へ has-error を付ける。DOM 順＝質問の並び順なので最初の1件が一番上
    const field = questionsRef.current?.querySelector<HTMLElement>('.question-field.has-error');
    if (!field) return;
    field
      .querySelector<HTMLElement>('input, textarea, select, button')
      ?.focus({ preventScroll: true });
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // プレビューの固定バナーに隠れないよう、上端ではなく縦中央に合わせる
    field.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [scrollRequest]);

  const setAnswer = (questionId: number, value: AnswerValue | null) => {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    onAnswersChange?.(next);
    setErrors((prev) => {
      if (!(questionId in prev)) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  const validate = (): boolean => {
    const nextErrors: Record<number, string> = {};
    for (const q of questions) {
      const v = answers[q.id];
      if (q.required) {
        if (v === null || v === undefined) {
          nextErrors[q.id] = '必須項目です';
          continue;
        } else if (typeof v === 'string' && v.trim() === '') {
          nextErrors[q.id] = '必須項目です';
          continue;
        } else if (Array.isArray(v) && v.length === 0) {
          nextErrors[q.id] = '必須項目です';
          continue;
        }
      }
      if (q.type === 'number' && typeof v === 'number') {
        const max = q.maxScore;
        if (v < 0 || (max !== null && v > max)) {
          nextErrors[q.id] =
            max !== null ? `0〜${max}点で入力してください` : '0以上の値を入力してください';
        }
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) {
      setFormError('未入力の必須項目があります。すべての必須項目を入力してください。');
      setScrollRequest((n) => n + 1);
      return;
    }
    try {
      await onSubmit(answers);
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : '保存に失敗しました。');
    }
  };

  return (
    <form className="card eval-card" onSubmit={handleSubmit}>
      <p className="eval-progress">{progressLabel}</p>
      <h2 className="eval-team-name">{team.name}</h2>
      <div className="eval-questions" ref={questionsRef}>
        {questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            value={answers[q.id] ?? null}
            error={errors[q.id]}
            onChange={(v) => setAnswer(q.id, v)}
          />
        ))}
        {questions.length === 0 && <p className="muted">このフォームには質問がありません。</p>}
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <div className="eval-actions">
        {onPrev && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onPrev}
            disabled={submitting}
          >
            前のチームへ
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? '保存中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
