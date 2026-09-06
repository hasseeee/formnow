import { useEffect, useState } from 'react';
import type { Team } from '../../../../shared/types';
import { ApiRequestError, saveTeams, type TeamInput } from '../../../api';
import { useToast } from '../../../components/Toast';

interface Props {
  eventId: number;
  teams: Team[];
  onSaved: () => void;
}

export default function TeamsTab({ eventId, teams, onSaved }: Props) {
  const [rows, setRows] = useState<TeamInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    setRows(
      [...teams]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({ id: t.id, name: t.name, sortOrder: t.sortOrder })),
    );
  }, [teams]);

  const updateName = (index: number, name: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, name } : r)));
  };

  const addRow = () => {
    setRows((prev) => [...prev, { name: '', sortOrder: prev.length }]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const move = (index: number, dir: -1 | 1) => {
    setRows((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = rows
        .filter((r) => r.name.trim() !== '')
        .map((r, i) => ({ ...r, name: r.name.trim(), sortOrder: i }));
      await saveTeams(eventId, payload);
      toast.show('チームを保存しました');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editable-list">
      {error && <p className="form-error">{error}</p>}
      {rows.map((row, i) => (
        <div className="editable-row" key={row.id ?? `new-${i}`}>
          <input
            type="text"
            className="text-input"
            value={row.name}
            placeholder="チーム名"
            onChange={(e) => updateName(i, e.target.value)}
          />
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => move(i, -1)}
              disabled={i === 0}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => move(i, 1)}
              disabled={i === rows.length - 1}
            >
              ↓
            </button>
            <button type="button" className="btn btn-danger-ghost" onClick={() => removeRow(i)}>
              削除
            </button>
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">チームがまだ登録されていません。</p>}
      <div className="editable-list-footer">
        <button type="button" className="btn btn-secondary" onClick={addRow}>
          ＋ チームを追加
        </button>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
