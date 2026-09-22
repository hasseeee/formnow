import type { CSSProperties } from 'react';
import type { AnswerValue, PublicQuestion } from '../../../shared/types';
import Markdown from '../../components/Markdown';

interface Props {
  question: PublicQuestion;
  value: AnswerValue | null;
  error?: string;
  onChange: (value: AnswerValue | null) => void;
}

export default function QuestionField({ question, value, error, onChange }: Props) {
  return (
    <div className={`question-field${error ? ' has-error' : ''}`}>
      <div className="question-label">
        <Markdown source={question.labelMd} />
        {question.required && <span className="required-badge">必須</span>}
      </div>
      <QuestionInput question={question} value={value} onChange={onChange} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

function QuestionInput({ question, value, onChange }: Omit<Props, 'error'>) {
  switch (question.type) {
    case 'rating': {
      const max = question.maxScore ?? 5;
      const current = typeof value === 'number' ? value : null;

      if (max > 10) {
        const unanswered = current === null;
        // スライダーでは途中の段階の説明は出さず、両端だけを出す
        const minLabel = question.scaleLabels?.[0] ?? '';
        const maxLabel = question.scaleLabels?.[max - 1] ?? '';
        return (
          <div className={`rating-slider${unanswered ? ' unanswered' : ''}`}>
            <div className="rating-slider-track">
              <input
                type="range"
                min={1}
                max={max}
                step={1}
                value={current ?? Math.ceil(max / 2)}
                onChange={(e) => onChange(Number(e.target.value))}
              />
              {(minLabel || maxLabel) && (
                <div className="rating-slider-ends">
                  <span>{minLabel}</span>
                  <span>{maxLabel}</span>
                </div>
              )}
            </div>
            <span className="rating-slider-value">
              {unanswered ? 'タップして評価' : `${current} / ${max}`}
            </span>
          </div>
        );
      }

      const options = Array.from({ length: max }, (_, i) => i + 1);
      // 6段階以上は狭い画面で2段に固定する（列数 = 段階数 ÷ 2 の切り上げ）
      const cols = max >= 6 ? Math.ceil(max / 2) : max;
      return (
        <div
          className="rating-buttons"
          role="group"
          aria-label="評価"
          style={{ '--rating-count': max, '--rating-cols': cols } as CSSProperties}
        >
          {options.map((n) => {
            const label = question.scaleLabels?.[n - 1] ?? '';
            return (
              <button
                key={n}
                type="button"
                aria-pressed={current === n}
                className={`rating-btn${current === n ? ' selected' : ''}`}
                onClick={() => onChange(n)}
              >
                <span className="rating-num">{n}</span>
                {label && <span className="rating-point-label">{label}</span>}
              </button>
            );
          })}
        </div>
      );
    }

    case 'number': {
      const current = typeof value === 'number' ? value : '';
      return (
        <input
          type="number"
          inputMode="decimal"
          className="text-input"
          value={current}
          min={0}
          max={question.maxScore ?? undefined}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    }

    case 'choice': {
      const current = typeof value === 'string' ? value : '';
      return (
        <div className="choice-options">
          {(question.options ?? []).map((opt) => (
            <label key={opt.label} className="choice-option">
              <input
                type="radio"
                name={`question-${question.id}`}
                checked={current === opt.label}
                onChange={() => onChange(opt.label)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      );
    }

    case 'checkbox': {
      const current = Array.isArray(value) ? value : [];
      const toggle = (label: string) => {
        if (current.includes(label)) {
          onChange(current.filter((v) => v !== label));
        } else {
          onChange([...current, label]);
        }
      };
      return (
        <div className="choice-options">
          {(question.options ?? []).map((opt) => (
            <label key={opt.label} className="choice-option">
              <input
                type="checkbox"
                checked={current.includes(opt.label)}
                onChange={() => toggle(opt.label)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      );
    }

    case 'text': {
      const current = typeof value === 'string' ? value : '';
      return (
        <input
          type="text"
          className="text-input"
          value={current}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }

    case 'textarea': {
      const current = typeof value === 'string' ? value : '';
      return (
        <div>
          <textarea
            className="textarea-input"
            rows={4}
            value={current}
            onChange={(e) => onChange(e.target.value)}
          />
          <p className="field-hint">Markdownが使えます</p>
        </div>
      );
    }

    default:
      return null;
  }
}
