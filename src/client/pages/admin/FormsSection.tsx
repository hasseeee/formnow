import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Form, FormKind, FormStatus } from '../../../shared/types';
import {
  ApiRequestError,
  createForm,
  deleteForm,
  getForm,
  saveQuestions,
  type QuestionInput,
} from '../../api';
import KebabMenu from '../../components/KebabMenu';
import { useToast } from '../../components/Toast';

interface Props {
  eventId: number;
  forms: Form[];
  onChanged: () => void;
  /** 閲覧専用のとき true。作成ボタンと「⋯」（複製・削除）を隠す */
  readOnly?: boolean;
}

const STATUS_LABEL: Record<FormStatus, string> = {
  draft: '下書き',
  open: '公開中',
  closed: '締切',
};

export default function FormsSection({ eventId, forms, onChanged, readOnly = false }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState<FormKind | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);

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

  const handleDuplicate = async (form: Form) => {
    setDuplicatingId(form.id);
    try {
      const detail = await getForm(form.id);
      const newForm = await createForm({
        eventId,
        title: `${form.title || '無題のフォーム'} のコピー`,
        descriptionMd: form.descriptionMd,
        kind: form.kind,
      });
      const questionsPayload: QuestionInput[] = detail.questions
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((q, i) => ({
          sortOrder: i,
          type: q.type,
          labelMd: q.labelMd,
          options: q.options,
          maxScore: q.maxScore,
          weight: q.weight,
          required: q.required,
          scaleLabels: q.scaleLabels,
        }));
      if (questionsPayload.length > 0) {
        await saveQuestions(newForm.id, questionsPayload);
      }
      toast.show('フォームを複製しました');
      onChanged();
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '複製に失敗しました。', 'error');
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleDelete = async (form: Form) => {
    const ok = window.confirm(
      `「${form.title || '無題のフォーム'}」を削除しますか？回答データもすべて削除されます。`,
    );
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
    <section className="forms-section">
      {!readOnly && (
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
      )}

      {forms.length === 0 ? (
        <p className="muted">
          {readOnly
            ? 'フォームがまだありません。'
            : 'フォームがまだありません。上のボタンから作成してください。'}
        </p>
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
              <div className="form-card-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => handleCopyUrl(e, f.slug)}
                >
                  URLをコピー
                </button>
                {!readOnly && (
                  <KebabMenu
                    items={[
                      {
                        label: duplicatingId === f.id ? '複製中…' : '複製',
                        onClick: () => handleDuplicate(f),
                      },
                      { label: '削除', onClick: () => handleDelete(f), danger: true },
                    ]}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
