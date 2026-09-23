import type { AnswerSummaryItem, TeamAnswerSummary } from '../../../shared/evalFlow';
import { formatScore } from '../../lib/format';

interface Props {
  /** 評価対象チームの順に 1 チーム 1 件の採点サマリー */
  rows: TeamAnswerSummary[];
  /** 回答者名。引けないときは null（名前の行を出さない） */
  respondentName: string | null;
  onEditTeam: (index: number) => void;
  onResetRespondent: () => void;
}

/** 「値/上限」。未回答は「—」、上限なしの number は「/上限」を付けない */
function formatItemValue(item: AnswerSummaryItem): string {
  if (item.value === null) return '—';
  const value = formatScore(item.value);
  return item.max !== null ? `${value}/${item.max}` : value;
}

export default function CompletionStep({
  rows,
  respondentName,
  onEditTeam,
  onResetRespondent,
}: Props) {
  return (
    <div className="page-container form-flow">
      <div className="card completion-card">
        <p className="completion-emoji" aria-hidden="true">
          🎉
        </p>
        <h2>全チームの評価が完了しました</h2>
        {respondentName !== null && (
          <p className="completion-respondent">
            <strong>{respondentName}</strong> さんの回答
          </p>
        )}
        <p className="muted">
          付けた点数を見直せます。直したいチームは「修正する」を押してください。
        </p>
        <ul className="completion-summary-list">
          {rows.map((row, i) => (
            <li key={row.teamId} className="completion-summary-row">
              <div className="completion-summary-head">
                <span className="completion-summary-team">{row.teamName}</span>
                <button
                  type="button"
                  className="btn btn-link"
                  aria-label={`${row.teamName}の回答を修正する`}
                  onClick={() => onEditTeam(i)}
                >
                  修正する
                </button>
              </div>
              {row.items.length > 0 && (
                <ul className="completion-summary-scores">
                  {row.items.map((item) => (
                    <li key={item.questionId} title={item.fullLabel}>
                      <span className="completion-summary-label">{item.label}</span>{' '}
                      <span className="completion-summary-value">{formatItemValue(item)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost" onClick={onResetRespondent}>
          別の名前で回答する
        </button>
      </div>
    </div>
  );
}
