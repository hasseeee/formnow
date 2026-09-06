import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PublicFormView, SubmitResponseRequest, Team } from '../../../shared/types';
import { ApiRequestError, getMyResponses, getPublicForm, submitResponse } from '../../api';
import CenteredMessage from '../../components/CenteredMessage';
import Markdown from '../../components/Markdown';
import { useToast } from '../../components/Toast';
import {
  clearStoredRespondentId,
  getStoredRespondentId,
  setStoredRespondentId,
} from '../../lib/storage';
import CompletionStep from './CompletionStep';
import NameSelectStep from './NameSelectStep';
import TeamEvaluationStep, { type AnswerMap } from './TeamEvaluationStep';

type Phase = 'loading' | 'error' | 'select-name' | 'evaluating' | 'done';

export default function PublicFormPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const toast = useToast();

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [view, setView] = useState<PublicFormView | null>(null);
  const [respondentId, setRespondentId] = useState<number | null>(null);
  const [answersByTeam, setAnswersByTeam] = useState<Record<number, AnswerMap>>({});
  const [completedTeamIds, setCompletedTeamIds] = useState<Set<number>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // フォーム定義の読み込み
  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setErrorMessage(null);

    getPublicForm(slug)
      .then((data) => {
        if (cancelled) return;
        setView(data);

        if (data.form.status !== 'open') {
          setErrorMessage(
            data.form.status === 'draft'
              ? 'このフォームはまだ公開されていません。'
              : 'このフォームは締め切られました。',
          );
          setPhase('error');
          return;
        }

        const stored = getStoredRespondentId(slug);
        if (stored !== null && data.respondents.some((r) => r.id === stored)) {
          setRespondentId(stored);
        } else {
          setPhase('select-name');
        }
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

  // 評価対象チーム（peerフォームは自チームを除外）
  const targetTeams: Team[] = useMemo(() => {
    if (!view) return [];
    const sorted = [...view.teams].sort((a, b) => a.sortOrder - b.sortOrder);
    if (view.form.kind !== 'peer' || respondentId === null) return sorted;
    const respondent = view.respondents.find((r) => r.id === respondentId);
    if (!respondent) return sorted;
    return sorted.filter((t) => t.id !== respondent.teamId);
  }, [view, respondentId]);

  const questions = useMemo(() => {
    if (!view) return [];
    return [...view.questions].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [view]);

  // 名前決定後: 自分の保存済み回答を取得して再開位置を決める
  useEffect(() => {
    if (respondentId === null || !view) return;
    let cancelled = false;

    getMyResponses(slug, respondentId)
      .then((data) => {
        if (cancelled) return;
        const map: Record<number, AnswerMap> = {};
        const done = new Set<number>();
        for (const r of data.responses) {
          const am: AnswerMap = {};
          for (const a of r.answers) am[a.questionId] = a.value;
          map[r.teamId] = am;
          done.add(r.teamId);
        }
        setAnswersByTeam(map);
        setCompletedTeamIds(done);

        if (targetTeams.length === 0) {
          setErrorMessage('評価対象のチームがありません。');
          setPhase('error');
          return;
        }

        const firstUnanswered = targetTeams.findIndex((t) => !done.has(t.id));
        if (firstUnanswered === -1) {
          setCurrentIndex(targetTeams.length);
          setPhase('done');
        } else {
          setCurrentIndex(firstUnanswered);
          setPhase('evaluating');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(
          err instanceof ApiRequestError ? err.message : '回答状況の取得に失敗しました。',
        );
        setPhase('error');
      });

    return () => {
      cancelled = true;
    };
    // targetTeamsはview/respondentIdから導出される派生値のため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respondentId, view, slug]);

  const handleNameSelected = (id: number) => {
    setStoredRespondentId(slug, id);
    setRespondentId(id);
    setPhase('loading');
  };

  const handleResetRespondent = () => {
    clearStoredRespondentId(slug);
    setRespondentId(null);
    setAnswersByTeam({});
    setCompletedTeamIds(new Set());
    setCurrentIndex(0);
    setPhase('select-name');
  };

  const handleSubmitTeam = useCallback(
    async (team: Team, answers: AnswerMap) => {
      if (respondentId === null) return;
      setSubmitting(true);
      try {
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
        setAnswersByTeam((prev) => ({ ...prev, [team.id]: answers }));
        setCompletedTeamIds((prev) => new Set(prev).add(team.id));
        toast.show('保存しました');

        const nextIndex = currentIndex + 1;
        if (nextIndex >= targetTeams.length) {
          setCurrentIndex(targetTeams.length);
          setPhase('done');
        } else {
          setCurrentIndex(nextIndex);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [respondentId, slug, currentIndex, targetTeams.length, toast],
  );

  const handlePrev = () => {
    setPhase('evaluating');
    setCurrentIndex((idx) => Math.max(0, idx - 1));
  };

  const handleEditTeam = (index: number) => {
    setCurrentIndex(index);
    setPhase('evaluating');
  };

  if (phase === 'loading') {
    return <CenteredMessage>読み込み中…</CenteredMessage>;
  }

  if (phase === 'error') {
    return <CenteredMessage tone="error">{errorMessage}</CenteredMessage>;
  }

  if (!view) {
    return <CenteredMessage tone="error">フォームを読み込めませんでした。</CenteredMessage>;
  }

  if (phase === 'select-name') {
    return <NameSelectStep view={view} onSelect={handleNameSelected} />;
  }

  if (phase === 'done') {
    return (
      <CompletionStep
        teams={targetTeams}
        onEditTeam={handleEditTeam}
        onResetRespondent={handleResetRespondent}
      />
    );
  }

  const team = targetTeams[currentIndex];
  if (!team) {
    return <CenteredMessage tone="error">評価対象のチームが見つかりません。</CenteredMessage>;
  }

  return (
    <div className="page-container form-flow">
      <header className="form-header">
        <h1>{view.form.title}</h1>
        <Markdown source={view.form.descriptionMd} />
        <button type="button" className="btn btn-link switch-name-link" onClick={handleResetRespondent}>
          別の名前で回答する
        </button>
      </header>
      <TeamEvaluationStep
        key={team.id}
        team={team}
        questions={questions}
        initialAnswers={answersByTeam[team.id] ?? {}}
        progressLabel={`${currentIndex + 1} / ${targetTeams.length} チーム目`}
        onSubmit={(answers) => handleSubmitTeam(team, answers)}
        onPrev={currentIndex > 0 ? handlePrev : undefined}
        submitting={submitting}
      />
    </div>
  );
}
