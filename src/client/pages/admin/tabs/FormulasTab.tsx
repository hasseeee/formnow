import { useEffect, useState } from 'react';
import type { Formula } from '../../../../shared/types';
import { ApiRequestError, saveFormulas, type FormulaInput } from '../../../api';
import { useToast } from '../../../components/Toast';

interface Props {
  eventId: number;
  formulas: Formula[];
  onSaved: () => void;
}

export default function FormulasTab({ eventId, formulas, onSaved }: Props) {
  const [rows, setRows] = useState<FormulaInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    setRows(formulas.map((f) => ({ id: f.id, name: f.name, expression: f.expression })));
  }, [formulas]);

  const update = (index: number, patch: Partial<FormulaInput>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, { name: '', expression: '' }]);
  const removeRow = (index: number) => {
    const target = rows[index];
    if (target?.id !== undefined) {
      const ok = window.confirm('この計算式を削除しますか？');
      if (!ok) return;
    }
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = rows.filter((r) => r.name.trim() !== '' && r.expression.trim() !== '');
      await saveFormulas(eventId, payload);
      toast.show('計算式を保存しました');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editable-list">
      <p className="hint-text">
        変数: &lt;フォームslug&gt;_avg, _sum, _count。例: judge_avg * 0.7 + peer_avg * 0.3
      </p>
      {error && <p className="form-error">{error}</p>}
      {rows.map((row, i) => (
        <div className="editable-row formula-row" key={row.id ?? `new-${i}`}>
          <input
            type="text"
            className="text-input"
            placeholder="名前"
            value={row.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            type="text"
            className="text-input formula-expression"
            placeholder="式"
            value={row.expression}
            onChange={(e) => update(i, { expression: e.target.value })}
          />
          <button type="button" className="btn btn-danger-ghost" onClick={() => removeRow(i)}>
            削除
          </button>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">計算式がまだありません。</p>}
      <div className="editable-list-footer">
        <button type="button" className="btn btn-secondary" onClick={addRow}>
          ＋ 計算式を追加
        </button>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
