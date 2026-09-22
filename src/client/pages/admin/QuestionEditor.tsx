import { useEffect, useState } from 'react';
import type { QuestionType } from '../../../shared/types';
import type { QuestionInput } from '../../api';
import KebabMenu from '../../components/KebabMenu';
import {
  resizeScaleLabels,
  SCALE_LABEL_MAX_LENGTH,
  SCALE_LABELS_MAX_STEPS,
} from '../../../shared/scaleLabels';

interface Props {
  question: QuestionInput;
  onChange: (patch: Partial<QuestionInput>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
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

/** 評価のひな形。配点上限と各段階の説明をまとめて入れるだけのボタン */
const SCALE_TEMPLATES: { name: string; maxScore: number; scaleLabels: string[] }[] = [
  {
    name: '5段階・全部に説明',
    maxScore: 5,
    scaleLabels: ['もう少し', 'やや物足りない', 'ふつう', 'よい', 'とてもよい'],
  },
  { name: '5段階・両端だけ', maxScore: 5, scaleLabels: ['もう少し', '', '', '', 'とてもよい'] },
  {
    name: '10段階・両端だけ',
    maxScore: 10,
    scaleLabels: ['もう少し', '', '', '', '', '', '', '', '', 'とてもよい'],
  },
];

function countFilled(labels: string[] | null): number {
  return (labels ?? []).filter((l) => l.trim() !== '').length;
}

function toMaxScoreText(maxScore: number | null): string {
  return maxScore === null ? '' : String(maxScore);
}

export default function QuestionEditor({
  question,
  onChange,
  onRemove,
  onDuplicate,
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

  // 配点上限も入力欄を離れたとき（またはEnter）に確定する。
  // 打鍵ごとに確定すると「10」と打ち直す途中の「1」で段階の説明が縮み、元に戻らないため
  const [maxScoreText, setMaxScoreText] = useState<string>(toMaxScoreText(question.maxScore));

  useEffect(() => {
    setMaxScoreText(toMaxScoreText(question.maxScore));
  }, [question.maxScore]);

  const commitMaxScore = () => {
    const trimmed = maxScoreText.trim();
    const parsed = Number(trimmed);
    if (trimmed !== '' && Number.isNaN(parsed)) {
      setMaxScoreText(toMaxScoreText(question.maxScore));
      return;
    }
    const newMax = trimmed === '' ? null : parsed;
    if (newMax === question.maxScore) {
      setMaxScoreText(toMaxScoreText(question.maxScore));
      return;
    }
    if (question.type !== 'rating') {
      onChange({ maxScore: newMax });
      return;
    }
    const next = resizeScaleLabels(question.scaleLabels, newMax);
    if (countFilled(next) < countFilled(question.scaleLabels)) {
      const ok = window.confirm('段階の数を変えると、両端以外の説明は消えます。よろしいですか？');
      if (!ok) {
        setMaxScoreText(toMaxScoreText(question.maxScore));
        return;
      }
    }
    onChange({ maxScore: newMax, scaleLabels: next });
  };

  const applyScaleTemplate = (t: (typeof SCALE_TEMPLATES)[number]) => {
    const current = question.scaleLabels;
    const differs = JSON.stringify(current) !== JSON.stringify(t.scaleLabels);
    if (countFilled(current) > 0 && differs) {
      const ok = window.confirm('いまの説明をひな形で置き換えます。よろしいですか？');
      if (!ok) return;
    }
    onChange({ maxScore: t.maxScore, scaleLabels: [...t.scaleLabels] });
  };

  const updateScaleLabel = (index: number, max: number, text: string) => {
    const labels =
      question.scaleLabels?.length === max
        ? [...question.scaleLabels]
        : Array<string>(max).fill('');
    labels[index] = text;
    // すべて空に戻した配列もそのまま送ってよい（サーバーが null にする）
    onChange({ scaleLabels: labels });
  };

  const handleTypeChange = (type: QuestionType) => {
    // 段階の説明は型を切り替えると消す（rating へ切り替えたときも後から入れる）
    const patch: Partial<QuestionInput> = { type, scaleLabels: null };
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

  const updateOption = (
    index: number,
    patch: Partial<{ label: string; score: number | undefined }>,
  ) => {
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
      const ok = window.confirm(
        'この質問を削除すると、この質問への回答もすべて削除されます。よろしいですか？',
      );
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
          <KebabMenu
            items={[
              { label: '複製', onClick: onDuplicate },
              { label: '削除', onClick: handleRemove, danger: true },
            ]}
          />
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
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={() => removeOption(i)}
              >
                削除
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={addOption}>
            ＋ 選択肢を追加
          </button>
        </div>
      )}

      {question.type === 'rating' && (
        <ScaleLabelsEditor
          question={question}
          onApplyTemplate={applyScaleTemplate}
          onChangeLabel={updateScaleLabel}
        />
      )}

      <div className="question-editor-row question-editor-meta">
        {HAS_MAX_SCORE.includes(question.type) && (
          <label className="inline-field">
            配点上限
            <input
              type="number"
              className="text-input"
              value={maxScoreText}
              min={1}
              onChange={(e) => setMaxScoreText(e.target.value)}
              onBlur={commitMaxScore}
              onKeyDown={(e) => {
                // Enter でも確定する（blur 経由で commitMaxScore が1回だけ呼ばれる）
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
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

/** 評価の各段階の説明の入力欄。1〜10段階は全段階、11段階以上は両端だけ */
function ScaleLabelsEditor({
  question,
  onApplyTemplate,
  onChangeLabel,
}: {
  question: QuestionInput;
  onApplyTemplate: (t: (typeof SCALE_TEMPLATES)[number]) => void;
  onChangeLabel: (index: number, max: number, text: string) => void;
}) {
  const max = question.maxScore;
  const validMax =
    max !== null && Number.isInteger(max) && max >= 1 && max <= SCALE_LABELS_MAX_STEPS;
  const indices = !validMax
    ? []
    : max <= 10
      ? Array.from({ length: max }, (_, i) => i)
      : [0, max - 1];

  return (
    <div className="option-editor rating-labels-editor">
      <label>各段階の説明（任意）</label>
      <div className="rating-template-row">
        <span>ひな形:</span>
        {SCALE_TEMPLATES.map((t) => (
          <button
            key={t.name}
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onApplyTemplate(t)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {validMax ? (
        <>
          {indices.map((i) => (
            <div key={i} className="option-row">
              <span className="rating-step-num">{i + 1}</span>
              <input
                type="text"
                className="text-input"
                value={question.scaleLabels?.[i] ?? ''}
                maxLength={SCALE_LABEL_MAX_LENGTH}
                placeholder={i === 0 ? '例: もう少し' : i === max - 1 ? '例: とてもよい' : ''}
                onChange={(e) => onChangeLabel(i, max, e.target.value)}
              />
            </div>
          ))}
          <p className="field-hint">短く書くと、スマホでも読みやすくなります（10文字くらいまで）</p>
        </>
      ) : (
        <p className="field-hint">配点上限を 1〜100 の整数にすると、各段階に説明を付けられます</p>
      )}
    </div>
  );
}
