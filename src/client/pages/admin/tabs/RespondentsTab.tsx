import { useEffect, useState } from 'react';
import type { Respondent, Role, Team } from '../../../../shared/types';
import { ApiRequestError, saveRespondents, type RespondentInput } from '../../../api';
import { useToast } from '../../../components/Toast';

interface Props {
  eventId: number;
  respondents: Respondent[];
  teams: Team[];
  onSaved: () => void;
}

export default function RespondentsTab({ eventId, respondents, teams, onSaved }: Props) {
  const [rows, setRows] = useState<RespondentInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    setRows(
      [...respondents]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((r) => ({
          id: r.id,
          name: r.name,
          role: r.role,
          teamId: r.teamId,
          sortOrder: r.sortOrder,
        })),
    );
  }, [respondents]);

  const update = (index: number, patch: Partial<RespondentInput>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows((prev) => [...prev, { name: '', role: 'member', teamId: null, sortOrder: prev.length }]);
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
      await saveRespondents(eventId, payload);
      toast.show('回答者を保存しました');
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
        <div className="editable-row respondent-row" key={row.id ?? `new-${i}`}>
          <input
            type="text"
            className="text-input"
            value={row.name}
            placeholder="名前"
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <select
            className="select-input"
            value={row.role}
            onChange={(e) => update(i, { role: e.target.value as Role })}
          >
            <option value="judge">審査員</option>
            <option value="member">メンバー</option>
          </select>
          <select
            className="select-input"
            value={row.teamId ?? ''}
            onChange={(e) =>
              update(i, { teamId: e.target.value === '' ? null : Number(e.target.value) })
            }
          >
            <option value="">所属チームなし</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
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
      {rows.length === 0 && <p className="muted">回答者がまだ登録されていません。</p>}
      <div className="editable-list-footer">
        <button type="button" className="btn btn-secondary" onClick={addRow}>
          ＋ 回答者を追加
        </button>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
