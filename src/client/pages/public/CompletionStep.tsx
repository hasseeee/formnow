import type { Team } from '../../../shared/types';

interface Props {
  teams: Team[];
  onEditTeam: (index: number) => void;
  onResetRespondent: () => void;
}

export default function CompletionStep({ teams, onEditTeam, onResetRespondent }: Props) {
  return (
    <div className="page-container form-flow">
      <div className="card completion-card">
        <p className="completion-emoji" aria-hidden="true">
          🎉
        </p>
        <h2>全チームの評価が完了しました</h2>
        <p className="muted">回答を修正したい場合は、下のチームを選んでください。</p>
        <ul className="completion-team-list">
          {teams.map((t, i) => (
            <li key={t.id}>
              <button type="button" className="btn btn-link" onClick={() => onEditTeam(i)}>
                {t.name} の回答を修正する
              </button>
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
