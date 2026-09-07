import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Form, FormKind, FormStatus } from '../../../../shared/types';
import { ApiRequestError, createForm, deleteForm, updateForm } from '../../../api';
import { useToast } from '../../../components/Toast';

interface Props {
  eventId: number;
  forms: Form[];
  onSaved: () => void;
}

const STATUS_LABEL: Record<FormStatus, string> = {
  draft: '下書き',
  open: '公開中',
  closed: '締切',
};

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export default function FormsTab({ eventId, forms, onSaved }: Props) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<FormKind>('judge');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const trimmedSlug = slug.trim();
    if (trimmedSlug && !SLUG_PATTERN.test(trimmedSlug)) {
      setError('スラッグは半角英小文字・数字・ハイフンのみ使用できます。');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createForm({
        eventId,
        slug: trimmedSlug || undefined,
        title: title.trim(),
        descriptionMd: '',
        kind,
      });
      setSlug('');
      setTitle('');
      toast.show('フォームを作成しました');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '作成に失敗しました。');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyUrl = async (formSlug: string) => {
    const url = `${window.location.origin}/f/${formSlug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show('URLをコピーしました');
    } catch {
      toast.show('コピーに失敗しました。手動でコピーしてください。', 'error');
    }
  };

  const handleToggleStatus = async (form: Form) => {
    const nextStatus: FormStatus = form.status === 'open' ? 'closed' : 'open';
    try {
      await updateForm(form.id, { status: nextStatus });
      toast.show(nextStatus === 'open' ? '公開しました' : '締め切りました');
      onSaved();
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '更新に失敗しました。', 'error');
    }
  };

  const handleDelete = async (form: Form) => {
    const ok = window.confirm(
      `「${form.title}」を削除しますか？回答データもすべて削除されます。`,
    );
    if (!ok) return;
    try {
      await deleteForm(form.id);
      toast.show('フォームを削除しました');
      onSaved();
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '削除に失敗しました。', 'error');
    }
  };

  const handleSetSheetId = async (form: Form) => {
    const value = window.prompt('スプレッドシートIDを入力してください', form.sheetId ?? '');
    if (value === null) return;
    try {
      await updateForm(form.id, { sheetId: value.trim() === '' ? null : value.trim() });
      toast.show('シートIDを更新しました');
      onSaved();
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '更新に失敗しました。', 'error');
    }
  };

  return (
    <div className="forms-tab">
      {error && <p className="form-error">{error}</p>}
      <form className="card inline-form form-create" onSubmit={handleCreate}>
        <input
          type="text"
          className="text-input"
          placeholder="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          type="text"
          className="text-input"
          placeholder="URL名（空欄で自動生成）"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <select
          className="select-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as FormKind)}
        >
          <option value="judge">審査員フォーム</option>
          <option value="peer">相互評価フォーム</option>
        </select>
        <button type="submit" className="btn btn-primary" disabled={creating}>
          {creating ? '作成中…' : 'フォームを作成'}
        </button>
      </form>

      <ul className="form-list">
        {forms.map((f) => (
          <li key={f.id} className="card form-list-item">
            <div className="form-list-main">
              <span className={`status-badge status-${f.status}`}>{STATUS_LABEL[f.status]}</span>
              <span className="form-list-title">{f.title}</span>
              <span className="muted">/f/{f.slug}</span>
            </div>
            <div className="form-list-actions">
              <button type="button" className="btn btn-ghost" onClick={() => handleCopyUrl(f.slug)}>
                URLをコピー
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => handleToggleStatus(f)}>
                {f.status === 'open' ? '締め切る' : '公開する'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => handleSetSheetId(f)}>
                シートID設定
              </button>
              <Link to={`/admin/forms/${f.id}`} className="btn btn-secondary">
                編集
              </Link>
              <Link to={`/admin/forms/${f.id}/results`} className="btn btn-secondary">
                結果
              </Link>
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={() => handleDelete(f)}
              >
                削除
              </button>
            </div>
          </li>
        ))}
        {forms.length === 0 && <p className="muted">フォームがまだありません。</p>}
      </ul>
    </div>
  );
}
