import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Form, FormKind, FormStatus } from '../../../shared/types';
import { ApiRequestError, createForm, deleteForm } from '../../api';
import { useToast } from '../../components/Toast';

interface Props {
  eventId: number;
  forms: Form[];
  onChanged: () => void;
}

const STATUS_LABEL: Record<FormStatus, string> = {
  draft: '下書き',
  open: '公開中',
  closed: '締切',
};

export default function FormsSection({ eventId, forms, onChanged }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState<FormKind | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openMenuId === null) return;
    const handleClick = (e: globalThis.MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openMenuId]);

  const handleCreate = async (kind: FormKind) => {
    setCreating(kind);
    try {
      const form = await createForm({ eventId, title: '無題のフォーム', descriptionMd: '', kind });
      navigate(`/admin/forms/${form.id}`);
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '作成に失敗しました。', 'error');
      setCreating(null);
    }
  };

  const handleCopyUrl = async (e: MouseEvent, slug: string) => {
    e.stopPropagation();
    const url = `${window.location.origin}/f/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show('URLをコピーしました');
    } catch {
      toast.show('コピーに失敗しました。手動でコピーしてください。', 'error');
    }
  };

  const handleDelete = async (e: MouseEvent, form: Form) => {
    e.stopPropagation();
    setOpenMenuId(null);
    const ok = window.confirm(`「${form.title || '無題のフォーム'}」を削除しますか？回答データもすべて削除されます。`);
    if (!ok) return;
    try {
      await deleteForm(form.id);
      toast.show('フォームを削除しました');
      onChanged();
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '削除に失敗しました。', 'error');
    }
  };

  return (
    <section className="forms-section" ref={containerRef}>
      <div className="create-buttons">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => handleCreate('judge')}
          disabled={creating !== null}
        >
          {creating === 'judge' ? '作成中…' : '＋ 審査員フォーム'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => handleCreate('peer')}
          disabled={creating !== null}
        >
          {creating === 'peer' ? '作成中…' : '＋ 相互評価フォーム'}
        </button>
      </div>

      {forms.length === 0 ? (
        <p className="muted">フォームがまだありません。上のボタンから作成してください。</p>
      ) : (
        <div className="form-cards">
          {forms.map((f) => (
            <div
              key={f.id}
              className="card form-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/admin/forms/${f.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/admin/forms/${f.id}`);
                }
              }}
            >
              <div className="form-card-main">
                <span className={`status-badge status-${f.status}`}>{STATUS_LABEL[f.status]}</span>
                <span className="form-card-title">{f.title || '無題のフォーム'}</span>
              </div>
              <p className="muted form-card-url">/f/{f.slug}</p>
              <div className="form-card-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => handleCopyUrl(e, f.slug)}
                >
                  URLをコピー
                </button>
                <div className="kebab-menu">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm kebab-trigger"
                    aria-label="その他の操作"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId((cur) => (cur === f.id ? null : f.id));
                    }}
                  >
                    ⋯
                  </button>
                  {openMenuId === f.id && (
                    <div className="kebab-dropdown" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="kebab-item kebab-item-danger"
                        onClick={(e) => handleDelete(e, f)}
                      >
                        削除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
