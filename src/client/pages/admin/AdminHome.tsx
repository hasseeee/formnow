import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Event } from '../../../shared/types';
import { ApiRequestError, createEvent, listEvents } from '../../api';

export default function AdminHome() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () => {
    setError(null);
    listEvents()
      .then(setEvents)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : '読み込みに失敗しました。'),
      );
  };

  useEffect(load, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      await createEvent(trimmed);
      setName('');
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '作成に失敗しました。');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="admin-page">
      <h1>イベント一覧</h1>
      {error && <p className="form-error">{error}</p>}
      <form className="card inline-form" onSubmit={handleCreate}>
        <input
          type="text"
          className="text-input"
          placeholder="新しいイベント名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}>
          {creating ? '作成中…' : 'イベントを作成'}
        </button>
      </form>

      {events === null && !error && <p className="muted">読み込み中…</p>}
      {events && events.length === 0 && <p className="muted">イベントがまだありません。</p>}
      {events && events.length > 0 && (
        <ul className="event-list">
          {events.map((ev) => (
            <li key={ev.id} className="card event-list-item">
              <Link to={`/admin/events/${ev.id}`}>{ev.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
