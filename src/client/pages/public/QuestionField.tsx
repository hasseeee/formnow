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
        return (
          <div className={`rating-slider${unanswered ? ' unanswered' : ''}`}>
            <input
              type="range"
              min={1}
              max={max}
              step={1}
              value={current ?? Math.ceil(max / 2)}
              onChange={(e) => onChange(Number(e.target.value))}
            />
            <span className="rating-slider-value">
              {unanswered ? 'タップして評価' : `${current} / ${max}`}
            </span>
          </div>
        );
      }

      const options = Array.from({ length: max }, (_, i) => i + 1);
      return (
        <div className="rating-buttons" role="group">
          {options.map((n) => (
            <button
              key={n}
              type="button"
              className={`rating-btn${current === n ? ' selected' : ''}`}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          ))}
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
