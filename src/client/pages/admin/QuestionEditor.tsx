import { useEffect, useState } from 'react';
import type { QuestionType } from '../../../shared/types';
import type { QuestionInput } from '../../api';

interface Props {
  question: QuestionInput;
  onChange: (patch: Partial<QuestionInput>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const TYPE_LABEL: Record<QuestionType, string> = {
  rating: '評価（星・数値）',
  number: '数値入力',
  choice: '単一選択',
  checkbox: '複数選択',
  text: 'テキスト（1行）',
  textarea: 'テキスト（複数行）',
};

const QUESTION_TYPES = Object.keys(TYPE_LABEL) as QuestionType[];
const HAS_OPTIONS: QuestionType[] = ['choice', 'checkbox'];
const HAS_MAX_SCORE: QuestionType[] = ['rating', 'number'];
const SCORABLE: QuestionType[] = ['rating', 'number', 'choice', 'checkbox'];

export default function QuestionEditor({
  question,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: Props) {
  // weight入力: 空文字での確定でNumber('')=0になってしまうのを防ぐため、
  // 表示用のテキストをローカルで保持し、blur時に確定する（空のままなら直前値を保持）
  const [weightText, setWeightText] = useState<string>(String(question.weight));

  useEffect(() => {
    setWeightText(String(question.weight));
  }, [question.weight]);

  const commitWeight = () => {
    const trimmed = weightText.trim();
    const parsed = Number(trimmed);
    if (trimmed === '' || Number.isNaN(parsed)) {
      // 空/不正な値のままなら直前値を保持する
      setWeightText(String(question.weight));
      return;
    }
    onChange({ weight: parsed });
  };

  const handleTypeChange = (type: QuestionType) => {
    const patch: Partial<QuestionInput> = { type };
    if (HAS_OPTIONS.includes(type)) {
      patch.options = question.options ?? [{ label: '選択肢1' }];
    } else {
      patch.options = null;
    }
    if (HAS_MAX_SCORE.includes(type)) {
      patch.maxScore = question.maxScore ?? 5;
    } else {
      patch.maxScore = null;
    }
    onChange(patch);
  };

  const updateOption = (index: number, patch: Partial<{ label: string; score: number | undefined }>) => {
    const options = [...(question.options ?? [])];
    options[index] = { ...options[index], ...patch };
    onChange({ options });
  };

  const addOption = () => {
    const options = [
      ...(question.options ?? []),
      { label: `選択肢${(question.options?.length ?? 0) + 1}` },
    ];
    onChange({ options });
  };

  const removeOption = (index: number) => {
    const options = (question.options ?? []).filter((_, i) => i !== index);
    onChange({ options });
  };

  const handleRemove = () => {
    if (question.id !== undefined) {
      const ok = window.confirm('この質問を削除すると、この質問への回答もすべて削除されます。よろしいですか？');
      if (!ok) return;
    }
    onRemove();
  };

  return (
    <div className="card question-editor">
      <div className="question-editor-row">
        <select
          className="select-input"
          value={question.type}
          onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <div className="row-actions">
          <button type="button" className="btn btn-ghost" onClick={onMoveUp} disabled={!canMoveUp}>
            ↑
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onMoveDown}
            disabled={!canMoveDown}
          >
            ↓
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={handleRemove}>
            削除
          </button>
        </div>
      </div>

      <label>質問文（Markdown）</label>
      <textarea
        className="textarea-input"
        rows={2}
        value={question.labelMd}
        onChange={(e) => onChange({ labelMd: e.target.value })}
      />

      {HAS_OPTIONS.includes(question.type) && (
        <div className="option-editor">
          <label>選択肢（配点は任意）</label>
          {(question.options ?? []).map((opt, i) => (
            <div key={i} className="option-row">
              <input
                type="text"
                className="text-input"
                value={opt.label}
                placeholder="選択肢のラベル"
                onChange={(e) => updateOption(i, { label: e.target.value })}
              />
              <input
                type="number"
                className="text-input option-score"
                value={opt.score ?? ''}
                placeholder="配点（任意）"
                onChange={(e) =>
                  updateOption(i, {
                    score: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
              <button type="button" className="btn btn-danger-ghost" onClick={() => removeOption(i)}>
                削除
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={addOption}>
            ＋ 選択肢を追加
          </button>
        </div>
      )}

      <div className="question-editor-row question-editor-meta">
        {HAS_MAX_SCORE.includes(question.type) && (
          <label className="inline-field">
            配点上限
            <input
              type="number"
              className="text-input"
              value={question.maxScore ?? ''}
              min={1}
              onChange={(e) =>
                onChange({ maxScore: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </label>
        )}
        {SCORABLE.includes(question.type) && (
          <label className="inline-field">
            重み
            <input
              type="number"
              className="text-input"
              value={weightText}
              step={0.1}
              onChange={(e) => setWeightText(e.target.value)}
              onBlur={commitWeight}
            />
          </label>
        )}
        <label className="inline-field checkbox-field">
          <input
            type="checkbox"
            checked={question.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          必須
        </label>
      </div>
    </div>
  );
}
