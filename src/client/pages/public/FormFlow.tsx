// 回答画面の共通フロー: 名前選択 → チーム順次評価 → 完了画面。
// データ取得/送信処理は呼び出し側が注入する。PublicFormPage(実回答, API送信) と
// PreviewPage(プレビュー, メモリ保存)の両方から利用され、UIロジックの二重実装を避ける。
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildAnswerSummary,
  findNextTeamIndex,
  getSubmitMode,
  type SubmitMode,
} from '../../../shared/evalFlow';
import type { PublicFormView, Team } from '../../../shared/types';
import { ApiRequestError } from '../../api';
import CenteredMessage from '../../components/CenteredMessage';
import Markdown from '../../components/Markdown';
import { useToast } from '../../components/Toast';
import CompletionStep from './CompletionStep';
import NameSelectStep from './NameSelectStep';
import TeamEvaluationStep, { type AnswerMap } from './TeamEvaluationStep';
import TeamStepNav from './TeamStepNav';

export type { AnswerMap };

type Phase = 'loading' | 'error' | 'select-name' | 'evaluating' | 'done';

// 送信ボタンの文言。保存後の遷移先（次のチーム／完了画面）と必ず一致させる
const SUBMIT_LABELS: Record<SubmitMode, string> = {
  next: 'このチームの評価を保存して次へ',
  finish: '保存して完了',
  'edit-next': '修正を保存して次へ',
  'edit-finish': '修正を保存して完了画面へ',
};

export interface FormFlowProps {
  /** 表示するフォーム一式（公開APIまたはプレビューAPIから取得済みのもの） */
  view: PublicFormView;
  /** 回答者選択後、再開位置を決めるために保存済み回答を取得する。teamId→回答のmapを返す */
  loadInitialResponses: (respondentId: number) => Promise<Record<number, AnswerMap>>;
  /** 1チーム分の回答を保存する処理（API送信・メモリ保存など呼び出し側で注入） */
  onSubmit: (respondentId: number, team: Team, answers: AnswerMap) => Promise<void>;
  /** 起動時に復元する回答者ID（localStorage記憶など）。省略時は毎回名前選択から始まる */
  initialRespondentId?: number | null;
  /** 回答者が選択/リセットされた際の通知（localStorageの書き込み等の副作用用）。省略可 */
  onRespondentChange?: (id: number | null) => void;
}

export default function FormFlow({
  view,
  loadInitialResponses,
  onSubmit,
  initialRespondentId = null,
  onRespondentChange,
}: FormFlowProps) {
  const toast = useToast();

  const validInitialRespondentId =
    initialRespondentId !== null && view.respondents.some((r) => r.id === initialRespondentId)
      ? initialRespondentId
      : null;

  const [phase, setPhase] = useState<Phase>(
    validInitialRespondentId !== null ? 'loading' : 'select-name',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [respondentId, setRespondentId] = useState<number | null>(validInitialRespondentId);
  const [answersByTeam, setAnswersByTeam] = useState<Record<number, AnswerMap>>({});
  // 保存していない入力途中の内容（チームを移っても画面を開いている間は残す）
  const [drafts, setDrafts] = useState<Record<number, AnswerMap>>({});
  const [completedTeamIds, setCompletedTeamIds] = useState<Set<number>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // 評価対象チーム（peerフォームは自チームを除外）
  const targetTeams: Team[] = useMemo(() => {
    const sorted = [...view.teams].sort((a, b) => a.sortOrder - b.sortOrder);
    if (view.form.kind !== 'peer' || respondentId === null) return sorted;
    const respondent = view.respondents.find((r) => r.id === respondentId);
    if (!respondent) return sorted;
    return sorted.filter((t) => t.id !== respondent.teamId);
  }, [view, respondentId]);

  const questions = useMemo(
    () => [...view.questions].sort((a, b) => a.sortOrder - b.sortOrder),
    [view],
  );

  const respondentName = view.respondents.find((r) => r.id === respondentId)?.name ?? null;

  // チームや完了画面に切り替わったら画面の一番上から表示する
  useEffect(() => {
    if (phase !== 'evaluating' && phase !== 'done') return;
    window.scrollTo(0, 0);
  }, [phase, currentIndex]);

  // 名前決定後: 保存済み回答を取得して再開位置を決める
  useEffect(() => {
    if (respondentId === null) return;
    let cancelled = false;
    setPhase('loading');
    setErrorMessage(null);

    loadInitialResponses(respondentId)
      .then((map) => {
        if (cancelled) return;
        const done = new Set(Object.keys(map).map(Number));
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
  }, [respondentId, loadInitialResponses]);

  const handleNameSelected = (id: number) => {
    onRespondentChange?.(id);
    setRespondentId(id);
    setPhase('loading');
  };

  const handleResetRespondent = () => {
    onRespondentChange?.(null);
    setRespondentId(null);
    setAnswersByTeam({});
    setDrafts({});
    setCompletedTeamIds(new Set());
    setCurrentIndex(0);
    setPhase('select-name');
  };

  const handleSubmitTeam = useCallback(
    async (team: Team, answers: AnswerMap) => {
      if (respondentId === null) return;
      setSubmitting(true);
      try {
        await onSubmit(respondentId, team, answers);
        setAnswersByTeam((prev) => ({ ...prev, [team.id]: answers }));
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[team.id];
          return next;
        });
        const updatedCompleted = new Set(completedTeamIds).add(team.id);
        setCompletedTeamIds(updatedCompleted);
        toast.show('保存しました');

        // 保存したチームより後ろの最初の未回答へ（なければ先頭から）。飛ばしたチームに毎回引き戻さない
        const fromIndex = targetTeams.findIndex((t) => t.id === team.id);
        const nextIndex = findNextTeamIndex(targetTeams, updatedCompleted, fromIndex);
        if (nextIndex === -1) {
          setCurrentIndex(targetTeams.length);
          setPhase('done');
        } else {
          setCurrentIndex(nextIndex);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [respondentId, onSubmit, completedTeamIds, targetTeams, toast],
  );

  const handlePrev = () => {
    setPhase('evaluating');
    setCurrentIndex((idx) => Math.max(0, idx - 1));
  };

  const handleJumpTeam = (index: number) => {
    setCurrentIndex(index);
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

  if (phase === 'select-name') {
    return <NameSelectStep view={view} onSelect={handleNameSelected} />;
  }

  if (phase === 'done') {
    return (
      <CompletionStep
        rows={buildAnswerSummary(targetTeams, questions, answersByTeam)}
        respondentName={respondentName}
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
        <div className="respondent-bar">
          {respondentName !== null && (
            <p className="respondent-name">
              <strong>{respondentName}</strong> さんとして回答中
            </p>
          )}
          <button
            type="button"
            className="btn btn-link switch-name-link"
            onClick={handleResetRespondent}
          >
            別の名前で回答する
          </button>
        </div>
      </header>
      {targetTeams.length > 1 && (
        <TeamStepNav
          teams={targetTeams}
          currentIndex={currentIndex}
          completedTeamIds={completedTeamIds}
          onJump={handleJumpTeam}
          disabled={submitting}
        />
      )}
      <TeamEvaluationStep
        key={team.id}
        team={team}
        questions={questions}
        initialAnswers={drafts[team.id] ?? answersByTeam[team.id] ?? {}}
        progressLabel={`${currentIndex + 1} / ${targetTeams.length} チーム目`}
        submitLabel={SUBMIT_LABELS[getSubmitMode(targetTeams, completedTeamIds, team.id)]}
        onSubmit={(answers) => handleSubmitTeam(team, answers)}
        onPrev={currentIndex > 0 ? handlePrev : undefined}
        onAnswersChange={(answers) => setDrafts((prev) => ({ ...prev, [team.id]: answers }))}
        submitting={submitting}
      />
    </div>
  );
}
