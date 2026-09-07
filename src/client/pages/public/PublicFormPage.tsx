import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PublicFormView, SubmitResponseRequest, Team } from '../../../shared/types';
import { ApiRequestError, getMyResponses, getPublicForm, submitResponse } from '../../api';
import CenteredMessage from '../../components/CenteredMessage';
import {
  clearStoredRespondentId,
  getStoredRespondentId,
  setStoredRespondentId,
} from '../../lib/storage';
import FormFlow, { type AnswerMap } from './FormFlow';

type Phase = 'loading' | 'error' | 'ready';

export default function PublicFormPage() {
  const { slug = '' } = useParams<{ slug: string }>();

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [view, setView] = useState<PublicFormView | null>(null);

  // フォーム定義の読み込み
  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setErrorMessage(null);

    getPublicForm(slug)
      .then((data) => {
        if (cancelled) return;

        if (data.form.status !== 'open') {
          setErrorMessage(
            data.form.status === 'draft'
              ? 'このフォームはまだ公開されていません。'
              : 'このフォームは締め切られました。',
          );
          setPhase('error');
          return;
        }

        setView(data);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(
          err instanceof ApiRequestError ? err.message : 'フォームの読み込みに失敗しました。',
        );
        setPhase('error');
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const loadInitialResponses = useCallback(
    async (respondentId: number): Promise<Record<number, AnswerMap>> => {
      const data = await getMyResponses(slug, respondentId);
      const map: Record<number, AnswerMap> = {};
      for (const r of data.responses) {
        const am: AnswerMap = {};
        for (const a of r.answers) am[a.questionId] = a.value;
        map[r.teamId] = am;
      }
      return map;
    },
    [slug],
  );

  const handleSubmit = useCallback(
    async (respondentId: number, team: Team, answers: AnswerMap): Promise<void> => {
      const payload: SubmitResponseRequest = {
        respondentId,
        teamId: team.id,
        answers: Object.entries(answers)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([questionId, value]) => ({
            questionId: Number(questionId),
            value: value!,
          })),
      };
      await submitResponse(slug, payload);
    },
    [slug],
  );

  const handleRespondentChange = useCallback(
    (id: number | null) => {
      if (id === null) {
        clearStoredRespondentId(slug);
      } else {
        setStoredRespondentId(slug, id);
      }
    },
    [slug],
  );

  if (phase === 'loading') {
    return <CenteredMessage>読み込み中…</CenteredMessage>;
  }

  if (phase === 'error') {
    return <CenteredMessage tone="error">{errorMessage}</CenteredMessage>;
  }

  if (!view) {
    return <CenteredMessage tone="error">フォームを読み込めませんでした。</CenteredMessage>;
  }

  return (
    <FormFlow
      view={view}
      loadInitialResponses={loadInitialResponses}
      onSubmit={handleSubmit}
      initialRespondentId={getStoredRespondentId(slug)}
      onRespondentChange={handleRespondentChange}
    />
  );
}
