import { useEffect, useState } from 'react';
import type { FormulaResults } from '../../../shared/types';
import { ApiRequestError, getFormulaResults } from '../../api';
import { formatScore } from '../../lib/format';

interface Props {
  eventId: number;
  refreshKey?: number;
}

export default function FormulaResultsPanel({ eventId, refreshKey }: Props) {
  const [data, setData] = useState<FormulaResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setData(null);
    getFormulaResults(eventId)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : '読み込みに失敗しました。'),
      );
  }, [eventId, refreshKey]);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;
  if (data.formulas.length === 0) {
    return <p className="muted">計算式が登録されていません。「計算式」タブから追加できます。</p>;
  }

  return (
    <div className="formula-results">
      {data.formulas.map(({ formula, error: formulaError, ranking }) => (
        <div key={formula.id} className="card formula-result-card">
          <h3>{formula.name}</h3>
          <p className="muted formula-expression-text">{formula.expression}</p>
          {formulaError && <p className="form-error">{formulaError}</p>}
          {!formulaError && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>順位</th>
                    <th>チーム</th>
                    <th>スコア</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r) => (
                    <tr key={r.teamId}>
                      <td>{r.rank ?? '-'}</td>
                      <td>{r.teamName}</td>
                      <td>{formatScore(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
