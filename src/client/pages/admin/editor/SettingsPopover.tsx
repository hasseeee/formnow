import { useState } from 'react';
import type { Form, FormKind } from '../../../../shared/types';
import { ApiRequestError, updateForm } from '../../../api';
import { useToast } from '../../../components/Toast';

interface Props {
  form: Form;
  onUpdated: (form: Form) => void;
}

const KIND_LABEL: Record<FormKind, string> = {
  judge: '審査員フォーム',
  peer: '相互評価フォーム',
};

const KIND_VALUES = Object.keys(KIND_LABEL) as FormKind[];

export default function SettingsPopover({ form, onUpdated }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [sheetId, setSheetId] = useState(form.sheetId ?? '');

  const handleSheetBlur = async () => {
    const trimmed = sheetId.trim();
    if (trimmed === (form.sheetId ?? '')) return;
    try {
      const updated = await updateForm(form.id, { sheetId: trimmed === '' ? null : trimmed });
      onUpdated(updated);
      toast.show('シートIDを更新しました');
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '更新に失敗しました。', 'error');
      setSheetId(form.sheetId ?? '');
    }
  };

  const handleKindChange = async (kind: FormKind) => {
    if (kind === form.kind) return;
    const ok = window.confirm('フォーム種別を変更すると回答対象が変わります。よろしいですか？');
    if (!ok) return;
    try {
      const updated = await updateForm(form.id, { kind });
      onUpdated(updated);
      toast.show('フォーム種別を変更しました');
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '更新に失敗しました。', 'error');
    }
  };

  return (
    <div className="settings-popover-wrap">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen((v) => !v)}
        aria-label="設定"
        aria-expanded={open}
      >
        ⚙ 設定
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="settings-popover">
            <label>フォーム種別</label>
            <select
              className="select-input"
              value={form.kind}
              onChange={(e) => void handleKindChange(e.target.value as FormKind)}
            >
              {KIND_VALUES.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <label>スプレッドシートID</label>
            <input
              type="text"
              className="text-input"
              value={sheetId}
              placeholder="未設定"
              onChange={(e) => setSheetId(e.target.value)}
              onBlur={handleSheetBlur}
            />
            <p className="small-hint">回答タブの「シートへ一括同期」で使用されます</p>
          </div>
        </>
      )}
    </div>
  );
}
