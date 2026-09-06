import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiRequestError, getForm, saveQuestions, updateForm, type FormDetailView, type QuestionInput } from '../../api';
import Markdown from '../../components/Markdown';
import { useToast } from '../../components/Toast';
import QuestionEditor from './QuestionEditor';

export default function FormEditPage() {
  const { id } = useParams<{ id: string }>();
  const formId = Number(id);
  const toast = useToast();

  const [data, setData] = useState<FormDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [descriptionMd, setDescriptionMd] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  const [questions, setQuestions] = useState<QuestionInput[]>([]);
  const [savingQuestions, setSavingQuestions] = useState(false);

  const load = () => {
    setError(null);
    getForm(formId)
      .then((d) => {
        setData(d);
        setTitle(d.form.title);
        setDescriptionMd(d.form.descriptionMd);
        setQuestions(
          [...d.questions]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((q) => ({
              id: q.id,
              sortOrder: q.sortOrder,
              type: q.type,
              labelMd: q.labelMd,
              options: q.options,
              maxScore: q.maxScore,
              weight: q.weight,
              required: q.required,
            })),
        );
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : '読み込みに失敗しました。'),
      );
  };

  useEffect(load, [formId]);

  const handleSaveMeta = async () => {
    setSavingMeta(true);
    try {
      await updateForm(formId, { title, descriptionMd });
      toast.show('フォーム情報を保存しました');
      load();
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '保存に失敗しました。', 'error');
    } finally {
      setSavingMeta(false);
    }
  };

  const addQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      {
        sortOrder: prev.length,
        type: 'rating',
        labelMd: '',
        options: null,
        maxScore: 5,
        weight: 1,
        required: true,
      },
    ]);
  };

  const updateQuestion = (index: number, patch: Partial<QuestionInput>) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const moveQuestion = (index: number, dir: -1 | 1) => {
    setQuestions((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSaveQuestions = async () => {
    const emptyIndex = questions.findIndex((q) => q.labelMd.trim() === '');
    if (emptyIndex !== -1) {
      toast.show(`質問文が未入力の質問があります（${emptyIndex + 1}番目）`, 'error');
      return;
    }
    setSavingQuestions(true);
    try {
      const payload = questions.map((q, i) => ({ ...q, sortOrder: i }));
      await saveQuestions(formId, payload);
      toast.show('質問を保存しました');
      load();
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '保存に失敗しました。', 'error');
    } finally {
      setSavingQuestions(false);
    }
  };

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  return (
    <div className="admin-page">
      <p>
        <Link to={`/admin/events/${data.form.eventId}`}>← イベントに戻る</Link>
      </p>
      <h1>フォーム編集</h1>

      <section className="card form-meta-editor">
        <label>タイトル</label>
        <input
          type="text"
          className="text-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label>説明文（Markdown）</label>
        <div className="markdown-editor">
          <textarea
            className="textarea-input"
            rows={6}
            value={descriptionMd}
            onChange={(e) => setDescriptionMd(e.target.value)}
          />
          <div className="markdown-preview">
            <p className="muted">プレビュー</p>
            <Markdown source={descriptionMd} />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSaveMeta}
          disabled={savingMeta}
        >
          {savingMeta ? '保存中…' : 'フォーム情報を保存'}
        </button>
      </section>

      <section className="question-builder">
        <h2>質問</h2>
        {questions.map((q, i) => (
          <QuestionEditor
            key={q.id ?? `new-${i}`}
            question={q}
            onChange={(patch) => updateQuestion(i, patch)}
            onRemove={() => removeQuestion(i)}
            onMoveUp={() => moveQuestion(i, -1)}
            onMoveDown={() => moveQuestion(i, 1)}
            canMoveUp={i > 0}
            canMoveDown={i < questions.length - 1}
          />
        ))}
        {questions.length === 0 && <p className="muted">質問がまだありません。</p>}
        <div className="editable-list-footer">
          <button type="button" className="btn btn-secondary" onClick={addQuestion}>
            ＋ 質問を追加
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveQuestions}
            disabled={savingQuestions}
          >
            {savingQuestions ? '保存中…' : '質問を保存'}
          </button>
        </div>
        <p className="small-hint">一覧から削除した項目は保存時にデータベースからも削除されます</p>
      </section>
    </div>
  );
}
