import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiRequestError, getEventDetail, type EventDetailView } from '../../api';
import FormulaResultsPanel from './FormulaResultsPanel';
import FormsTab from './tabs/FormsTab';
import FormulasTab from './tabs/FormulasTab';
import RespondentsTab from './tabs/RespondentsTab';
import TeamsTab from './tabs/TeamsTab';

type TabKey = 'teams' | 'respondents' | 'forms' | 'formulas';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'teams', label: 'チーム' },
  { key: 'respondents', label: '回答者' },
  { key: 'forms', label: 'フォーム' },
  { key: 'formulas', label: '計算式' },
];

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = Number(id);

  const [data, setData] = useState<EventDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('teams');
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

      <nav className="tab-nav">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-button${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="tab-panel">
        {tab === 'teams' && <TeamsTab eventId={eventId} teams={data.teams} onSaved={handleSaved} />}
        {tab === 'respondents' && (
          <RespondentsTab
            eventId={eventId}
            respondents={data.respondents}
            teams={data.teams}
            onSaved={handleSaved}
          />
        )}
        {tab === 'forms' && <FormsTab eventId={eventId} forms={data.forms} onSaved={reload} />}
        {tab === 'formulas' && (
          <FormulasTab eventId={eventId} formulas={data.formulas} onSaved={handleSaved} />
        )}
      </div>

      <section className="cross-summary">
        <h2>横断集計</h2>
        <FormulaResultsPanel eventId={eventId} refreshKey={refreshKey} />
      </section>
    </div>
  );
}
