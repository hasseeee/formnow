import { useEffect, useState } from 'react';
import { stripMarkdown } from '../../../../shared/plainText';
import type { FormSummary, Question } from '../../../../shared/types';
import {
  ApiRequestError,
  downloadFormCsv,
  getFormResponses,
  getFormSummary,
  syncSheets,
  type FormResponsesView,
} from '../../../api';
import Markdown from '../../../components/Markdown';
import { useToast } from '../../../components/Toast';
import { formatScore } from '../../../lib/format';

const SCORABLE_TYPES = new Set(['rating', 'number', 'choice', 'checkbox']);

interface Props {
  formId: number;
  questions: Question[];
}

export default function ResponsesPanel({ formId, questions }: Props) {
  const toast = useToast();
  const [summary, setSummary] = useState<FormSummary | null>(null);
  const [responses, setResponses] = useState<FormResponsesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setSummary(null);
    setResponses(null);
    Promise.all([getFormSummary(formId), getFormResponses(formId)])
      .then(([s, r]) => {
        setSummary(s);
        setResponses(r);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : '読み込みに失敗しました。'),
      );
  }, [formId]);

  const questionLabel = (questionId: number): string => {
    const q = questions.find((x) => x.id === questionId);
    if (!q) return `Q${questionId}`;
    const plain = stripMarkdown(q.labelMd);
    return plain.length > 16 ? `${plain.slice(0, 16)}…` : plain || `Q${questionId}`;
  };

  const handleExport = async () => {
    try {
      await downloadFormCsv(formId, `form-${formId}-responses.csv`);
    } catch (err) {
      toast.show(
        err instanceof ApiRequestError ? err.message : 'CSVのダウンロードに失敗しました。',
        'error',
      );
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncSheets(formId);
      setSyncMessage(
        result.rows !== undefined
          ? `${result.rows}件を同期しました`
          : 'シートへの同期が完了しました。',
      );
    } catch (err) {
      setSyncMessage(err instanceof ApiRequestError ? err.message : '同期に失敗しました。');
    } finally {
      setSyncing(false);
    }
  };

  if (error) return <p className="form-error">{error}</p>;
  if (!summary || !responses) return <p className="muted">読み込み中…</p>;

  const questionIds = [...questions]
    .filter((q) => SCORABLE_TYPES.has(q.type))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((q) => q.id);

  return (
    <div className="responses-panel">
      <div className="results-actions">
        <button type="button" className="btn btn-secondary" onClick={handleExport}>
          CSVダウンロード
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleSync} disabled={syncing}>
          {syncing ? '同期中…' : 'シートへ一括同期'}
        </button>
      </div>
      {syncMessage && <p className="muted">{syncMessage}</p>}

      <section>
        <h2>チーム別ランキング</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>順位</th>
                <th>チーム</th>
                <th>回答数</th>
                <th>平均</th>
                <th>合計</th>
                {questionIds.map((qid) => (
                  <th key={qid}>{questionLabel(qid)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.teams.map((t) => (
                <tr key={t.teamId}>
                  <td>{t.rank ?? '-'}</td>
                  <td>{t.teamName}</td>
                  <td>{t.count}</td>
                  <td>{formatScore(t.avg)}</td>
                  <td>{formatScore(t.sum)}</td>
                  {questionIds.map((qid) => (
                    <td key={qid}>{formatScore(t.questionAvgs[qid] ?? null)}</td>
                  ))}
                </tr>
              ))}
              {summary.teams.length === 0 && (
                <tr>
                  <td colSpan={5 + questionIds.length}>まだ回答がありません。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted">満点目安: {formatScore(summary.maxPossibleScore)}</p>
      </section>

      <section>
        <h2>個別回答</h2>
        {responses.responses.length === 0 && <p className="muted">まだ回答がありません。</p>}
        <ul className="response-list">
          {responses.responses.map((r) => (
            <li key={r.id} className="card response-item">
              <div className="response-meta">
                <strong>{r.teamName}</strong>
                <span className="muted">{r.respondentName}</span>
                <span className="muted">{new Date(r.submittedAt).toLocaleString('ja-JP')}</span>
              </div>
              <ul className="response-answers">
                {r.answers.map((a) => (
                  <li key={a.questionId}>
                    <span className="muted">{questionLabel(a.questionId)}: </span>
                    {typeof a.value === 'string' ? (
                      <Markdown source={a.value} />
                    ) : (
                      <span>{formatAnswerValue(a.value)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function formatAnswerValue(value: number | string[]): string {
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
