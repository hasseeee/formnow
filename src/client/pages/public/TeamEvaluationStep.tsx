import { useState, type FormEvent } from 'react';
import type { AnswerValue, Question, Team } from '../../../shared/types';
import { ApiRequestError } from '../../api';
import QuestionField from './QuestionField';

export type AnswerMap = Record<number, AnswerValue | null>;

interface Props {
  team: Team;
  questions: Question[];
  initialAnswers: AnswerMap;
  progressLabel: string;
  onSubmit: (answers: AnswerMap) => Promise<void>;
  onPrev?: () => void;
  submitting: boolean;
}

export default function TeamEvaluationStep({
  team,
  questions,
  initialAnswers,
  progressLabel,
  onSubmit,
  onPrev,
  submitting,
}: Props) {
  const [answers, setAnswers] = useState<AnswerMap>(() => ({ ...initialAnswers }));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const setAnswer = (questionId: number, value: AnswerValue | null) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
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
      <div className="eval-questions">
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
      {formError && <p className="form-error">{formError}</p>}
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
          {submitting ? '保存中…' : 'このチームの評価を保存して次へ'}
        </button>
      </div>
    </form>
  );
}
