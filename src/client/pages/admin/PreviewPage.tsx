// 回答画面プレビュー（管理者向け）。実際の回答フロー(FormFlow)をそのまま表示するが、
// 送信内容はDBに保存せず、コンポーネント内state(メモリ)にのみ保持する。
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { FormStatus, PublicFormView, Team } from '../../../shared/types';
import { ApiRequestError, getFormPreview } from '../../api';
import CenteredMessage from '../../components/CenteredMessage';
import FormFlow, { type AnswerMap } from '../public/FormFlow';

type Phase = 'loading' | 'error' | 'ready';

const STATUS_LABEL: Record<FormStatus, string> = {
  draft: '下書き',
  open: '公開中',
  closed: '締切',
};

/** プレビューでは保存しない。呼び出し前は常に空(まっさらな状態から始まる) */
async function loadInitialResponses(): Promise<Record<number, AnswerMap>> {
  return {};
}

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const formId = Number(id);

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [view, setView] = useState<PublicFormView | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setErrorMessage(null);

    getFormPreview(formId)
      .then((data) => {
        if (cancelled) return;
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
  }, [formId]);

  // プレビューでは送信をDBに書き込まず、メモリ上のstateのみ更新する(FormFlow側で反映済み)。
  // トースト表示や「次のチームへ進む」といった挙動はFormFlowと共通。
  const handleSubmit = useCallback(async (_respondentId: number, _team: Team, _answers: AnswerMap) => {
    // no-op: プレビューは保存しない
  }, []);

  const banner = (
    <div className="preview-banner">
      <span className="preview-banner-text">
        プレビューモード — 回答は保存されません
        {view && view.form.status !== 'open' && (
          <span className="preview-banner-status">（{STATUS_LABEL[view.form.status]}）</span>
        )}
      </span>
      <Link to={`/admin/forms/${formId}`} className="preview-banner-link">
        エディタに戻る
      </Link>
    </div>
  );

  return (
    <div className="preview-page">
      {banner}
      <div className="preview-page-body">
        {phase === 'loading' && <CenteredMessage>読み込み中…</CenteredMessage>}
        {phase === 'error' && <CenteredMessage tone="error">{errorMessage}</CenteredMessage>}
        {phase === 'ready' && view && (
          <FormFlow view={view} loadInitialResponses={loadInitialResponses} onSubmit={handleSubmit} />
        )}
      </div>
    </div>
  );
}
