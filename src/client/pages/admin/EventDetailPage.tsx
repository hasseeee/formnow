import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiRequestError, getEventDetail, type EventDetailView } from '../../api';
import CollapsibleSection from '../../components/CollapsibleSection';
import FormsSection from './FormsSection';
import FormulaResultsPanel from './FormulaResultsPanel';
import FormulasTab from './tabs/FormulasTab';
import RespondentsTab from './tabs/RespondentsTab';
import TeamsTab from './tabs/TeamsTab';
import { useAdminRole } from './adminRole';

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = Number(id);
  const readOnly = useAdminRole() === 'viewer';

  const [data, setData] = useState<EventDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(() => {
    setError(null);
    getEventDetail(eventId)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : '読み込みに失敗しました。'),
      );
  }, [eventId]);

  const handleSaved = useCallback(() => {
    setRefreshKey((k) => k + 1);
    reload();
  }, [reload]);

  useEffect(reload, [reload]);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  return (
    <div className="admin-page">
      <h1>{data.event.name}</h1>

      <FormsSection eventId={eventId} forms={data.forms} onChanged={reload} readOnly={readOnly} />

      {/* 閲覧専用のときは編集用の入力欄しかないので、セクションごと出さない */}
      {!readOnly && (
        <CollapsibleSection title="チームと回答者" defaultOpen={data.teams.length === 0}>
          <div className="subsection">
            <h3>チーム</h3>
            <TeamsTab eventId={eventId} teams={data.teams} onSaved={handleSaved} />
          </div>
          <div className="subsection">
            <h3>回答者</h3>
            <RespondentsTab
              eventId={eventId}
              respondents={data.respondents}
              teams={data.teams}
              onSaved={handleSaved}
            />
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title={readOnly ? '横断集計' : '横断集計と計算式'}>
        {!readOnly && (
          <div className="subsection">
            <h3>計算式</h3>
            <FormulasTab eventId={eventId} formulas={data.formulas} onSaved={handleSaved} />
          </div>
        )}
        {readOnly ? (
          <FormulaResultsPanel eventId={eventId} refreshKey={refreshKey} />
        ) : (
          <div className="subsection">
            <h3>横断集計</h3>
            <FormulaResultsPanel eventId={eventId} refreshKey={refreshKey} />
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
