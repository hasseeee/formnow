import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Form, FormStatus, QuestionType } from '../../../shared/types';
import {
  ApiRequestError,
  getForm,
  saveQuestions,
  updateForm,
  type FormDetailView,
  type QuestionInput,
} from '../../api';
import SaveStatusIndicator, { type SaveStatus } from '../../components/SaveStatusIndicator';
import { useToast } from '../../components/Toast';
import QuestionsPanel, { type LocalQuestion } from './editor/QuestionsPanel';
import ResponsesPanel from './editor/ResponsesPanel';
import SettingsPopover from './editor/SettingsPopover';
import { useAdminRole } from './adminRole';

const STATUS_OPTIONS: { value: FormStatus; label: string }[] = [
  { value: 'draft', label: '下書き' },
  { value: 'open', label: '公開中' },
  { value: 'closed', label: '締切' },
];

let clientKeySeq = 0;
function nextClientKey(): string {
  clientKeySeq += 1;
  return `q-${Date.now()}-${clientKeySeq}`;
}

function toLocalQuestion(q: QuestionInput): LocalQuestion {
  return { ...q, clientKey: nextClientKey() };
}

export default function FormEditPage() {
  const { id } = useParams<{ id: string }>();
  const formId = Number(id);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  // 閲覧専用のときは質問タブを出さず、URL に関係なく常に回答タブを表示する
  const readOnly = useAdminRole() === 'viewer';
  const activeTab = readOnly || searchParams.get('tab') === 'responses' ? 'responses' : 'questions';

  const [data, setData] = useState<FormDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [descriptionMd, setDescriptionMd] = useState('');
  const savedTitleRef = useRef('');
  const savedDescRef = useRef('');

  const [questions, setQuestions] = useState<LocalQuestion[]>([]);
  const questionsRef = useRef<LocalQuestion[]>([]);
  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const savingQuestionsRef = useRef(false);
  const pendingResaveRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const retryRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setError(null);
    getForm(formId)
      .then((d) => {
        setData(d);
        setTitle(d.form.title);
        setDescriptionMd(d.form.descriptionMd);
        savedTitleRef.current = d.form.title;
        savedDescRef.current = d.form.descriptionMd;
        setQuestions(
          [...d.questions]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((q) =>
              toLocalQuestion({
                id: q.id,
                sortOrder: q.sortOrder,
                type: q.type,
                labelMd: q.labelMd,
                options: q.options,
                maxScore: q.maxScore,
                weight: q.weight,
                required: q.required,
                scaleLabels: q.scaleLabels,
              }),
            ),
        );
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : '読み込みに失敗しました。'),
      );
  }, [formId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  // ---------- タイトル/説明文の自動保存（blur時） ----------

  const handleTitleBlur = useCallback(async () => {
    if (title === savedTitleRef.current) return;
    const value = title;
    setSaveStatus('saving');
    try {
      await updateForm(formId, { title: value });
      savedTitleRef.current = value;
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
      retryRef.current = () => void handleTitleBlur();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, title]);

  const handleDescBlur = useCallback(async () => {
    if (descriptionMd === savedDescRef.current) return;
    const value = descriptionMd;
    setSaveStatus('saving');
    try {
      await updateForm(formId, { descriptionMd: value });
      savedDescRef.current = value;
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
      retryRef.current = () => void handleDescBlur();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, descriptionMd]);

  // ---------- 質問の自動保存（800msデバウンス + in-flightガード） ----------

  const saveQuestionsNow = useCallback(async () => {
    if (savingQuestionsRef.current) {
      pendingResaveRef.current = true;
      return;
    }
    const snapshot = questionsRef.current;
    const toSave = snapshot.filter((q) => q.labelMd.trim() !== '');
    if (toSave.length === 0) {
      setSaveStatus('saved');
      return;
    }
    savingQuestionsRef.current = true;
    setSaveStatus('saving');
    const keysInOrder = toSave.map((q) => q.clientKey);
    const payload: QuestionInput[] = toSave.map((q, i) => ({
      id: q.id,
      sortOrder: i,
      type: q.type,
      labelMd: q.labelMd,
      options: q.options,
      maxScore: q.maxScore,
      weight: q.weight,
      required: q.required,
      scaleLabels: q.scaleLabels,
    }));
    try {
      const saved = await saveQuestions(formId, payload);
      // 保存後に付与されたidを、id以外はローカルを正としてマージする
      setQuestions((prev) => {
        const idByKey = new Map<string, number>();
        saved.forEach((sq, i) => {
          const key = keysInOrder[i];
          if (key !== undefined) idByKey.set(key, sq.id);
        });
        return prev.map((q) =>
          q.id === undefined && idByKey.has(q.clientKey)
            ? { ...q, id: idByKey.get(q.clientKey) }
            : q,
        );
      });
      setSaveStatus('saved');
      retryRef.current = null;
    } catch {
      setSaveStatus('error');
      retryRef.current = () => void saveQuestionsNow();
    } finally {
      savingQuestionsRef.current = false;
      if (pendingResaveRef.current) {
        pendingResaveRef.current = false;
        void saveQuestionsNow();
      }
    }
  }, [formId]);

  const scheduleQuestionsSave = useCallback(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void saveQuestionsNow();
    }, 800);
  }, [saveQuestionsNow]);

  const handleQuestionChange = useCallback(
    (clientKey: string, patch: Partial<QuestionInput>) => {
      setQuestions((prev) => prev.map((q) => (q.clientKey === clientKey ? { ...q, ...patch } : q)));
      scheduleQuestionsSave();
    },
    [scheduleQuestionsSave],
  );

  const handleAddQuestion = useCallback(() => {
    setQuestions((prev) => [
      ...prev,
      toLocalQuestion({
        sortOrder: prev.length,
        type: 'rating' as QuestionType,
        labelMd: '',
        options: null,
        maxScore: 5,
        weight: 1,
        required: true,
        scaleLabels: null,
      }),
    ]);
    // 質問文が空のうちは保存対象外なので、ここではスケジュールしない
  }, []);

  const handleRemoveQuestion = useCallback(
    (clientKey: string) => {
      setQuestions((prev) => prev.filter((q) => q.clientKey !== clientKey));
      scheduleQuestionsSave();
    },
    [scheduleQuestionsSave],
  );

  const handleDuplicateQuestion = useCallback(
    (clientKey: string) => {
      setQuestions((prev) => {
        const index = prev.findIndex((q) => q.clientKey === clientKey);
        if (index === -1) return prev;
        const original = prev[index];
        const copy: LocalQuestion = {
          ...original,
          id: undefined,
          clientKey: nextClientKey(),
        };
        const next = [...prev];
        next.splice(index + 1, 0, copy);
        return next;
      });
      scheduleQuestionsSave();
    },
    [scheduleQuestionsSave],
  );

  const handleMoveQuestion = useCallback(
    (clientKey: string, dir: -1 | 1) => {
      setQuestions((prev) => {
        const index = prev.findIndex((q) => q.clientKey === clientKey);
        if (index === -1) return prev;
        const target = index + dir;
        if (target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
      scheduleQuestionsSave();
    },
    [scheduleQuestionsSave],
  );

  const handleRetry = useCallback(() => {
    retryRef.current?.();
  }, []);

  // ---------- ステータス / 種別 / シート ----------

  const handleStatusChange = async (status: FormStatus) => {
    if (!data || status === data.form.status) return;
    try {
      const updated = await updateForm(formId, { status });
      setData((prev) => (prev ? { ...prev, form: updated } : prev));
      toast.show(
        status === 'open'
          ? '公開しました'
          : status === 'closed'
            ? '締め切りました'
            : '下書きに戻しました',
      );
    } catch (err) {
      toast.show(err instanceof ApiRequestError ? err.message : '更新に失敗しました。', 'error');
    }
  };

  const handleFormUpdated = (updated: Form) => {
    setData((prev) => (prev ? { ...prev, form: updated } : prev));
  };

  const handleShare = async () => {
    if (!data) return;
    const url = `${window.location.origin}/f/${data.form.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show('URLをコピーしました');
    } catch {
      toast.show('コピーに失敗しました。手動でコピーしてください。', 'error');
    }
  };

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  return (
    <div className="admin-page form-editor-page">
      <div className="editor-header">
        <Link to={`/admin/events/${data.form.eventId}`} className="editor-back-link">
          ← イベントに戻る
        </Link>
        <div className="editor-header-actions">
          {readOnly ? (
            <span className={`status-badge status-${data.form.status}`}>
              {STATUS_OPTIONS.find((opt) => opt.value === data.form.status)?.label}
            </span>
          ) : (
            <>
              <SaveStatusIndicator status={saveStatus} onRetry={handleRetry} />
              <div className="status-segment" role="group" aria-label="公開状態">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`status-segment-btn${data.form.status === opt.value ? ' active' : ''}`}
                    onClick={() => handleStatusChange(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <SettingsPopover form={data.form} onUpdated={handleFormUpdated} />
            </>
          )}
          <a
            href={`/admin/forms/${data.form.id}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
          >
            プレビュー
          </a>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleShare}>
            共有
          </button>
        </div>
      </div>
      {!readOnly && data.form.status !== 'open' && (
        <p className="small-hint editor-share-hint">公開すると回答できます</p>
      )}

      {readOnly ? (
        // 質問タブを出さない代わりに、フォームのタイトルをここに出す
        <h1>{data.form.title}</h1>
      ) : (
        <nav className="tab-nav editor-tab-nav">
          <button
            type="button"
            className={`tab-button${activeTab === 'questions' ? ' active' : ''}`}
            onClick={() => setSearchParams({}, { replace: true })}
          >
            質問
          </button>
          <button
            type="button"
            className={`tab-button${activeTab === 'responses' ? ' active' : ''}`}
            onClick={() => setSearchParams({ tab: 'responses' }, { replace: true })}
          >
            回答
          </button>
        </nav>
      )}

      <div className="tab-panel">
        {activeTab === 'questions' ? (
          <QuestionsPanel
            title={title}
            descriptionMd={descriptionMd}
            onTitleChange={setTitle}
            onTitleBlur={handleTitleBlur}
            onDescChange={setDescriptionMd}
            onDescBlur={handleDescBlur}
            questions={questions}
            onQuestionChange={handleQuestionChange}
            onAddQuestion={handleAddQuestion}
            onRemoveQuestion={handleRemoveQuestion}
            onDuplicateQuestion={handleDuplicateQuestion}
            onMoveQuestion={handleMoveQuestion}
          />
        ) : (
          <ResponsesPanel formId={formId} questions={data.questions} readOnly={readOnly} />
        )}
      </div>
    </div>
  );
}
