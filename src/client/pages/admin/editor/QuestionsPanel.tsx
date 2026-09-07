import type { QuestionInput } from '../../../api';
import Markdown from '../../../components/Markdown';
import QuestionEditor from '../QuestionEditor';

export interface LocalQuestion extends QuestionInput {
  /** サーバー未保存の質問も一意に識別するためのクライアント側キー */
  clientKey: string;
}

interface Props {
  title: string;
  descriptionMd: string;
  onTitleChange: (value: string) => void;
  onTitleBlur: () => void;
  onDescChange: (value: string) => void;
  onDescBlur: () => void;
  questions: LocalQuestion[];
  onQuestionChange: (clientKey: string, patch: Partial<QuestionInput>) => void;
  onAddQuestion: () => void;
  onRemoveQuestion: (clientKey: string) => void;
  onDuplicateQuestion: (clientKey: string) => void;
  onMoveQuestion: (clientKey: string, dir: -1 | 1) => void;
}

export default function QuestionsPanel({
  title,
  descriptionMd,
  onTitleChange,
  onTitleBlur,
  onDescChange,
  onDescBlur,
  questions,
  onQuestionChange,
  onAddQuestion,
  onRemoveQuestion,
  onDuplicateQuestion,
  onMoveQuestion,
}: Props) {
  return (
    <div className="questions-panel">
      <div className="card form-title-card">
        <input
          type="text"
          className="form-title-input"
          value={title}
          placeholder="無題のフォーム"
          onChange={(e) => onTitleChange(e.target.value)}
          onBlur={onTitleBlur}
        />
        <textarea
          className="form-desc-input"
          rows={2}
          value={descriptionMd}
          placeholder="フォームの説明を入力"
          onChange={(e) => onDescChange(e.target.value)}
          onBlur={onDescBlur}
        />
        <p className="small-hint">説明文はMarkdownで記述できます</p>
        {descriptionMd.trim() !== '' && (
          <div className="markdown-preview form-desc-preview">
            <Markdown source={descriptionMd} />
          </div>
        )}
      </div>

      <div className="question-cards">
        {questions.map((q, i) => (
          <div key={q.clientKey} className="question-card-wrap">
            <QuestionEditor
              question={q}
              onChange={(patch) => onQuestionChange(q.clientKey, patch)}
              onRemove={() => onRemoveQuestion(q.clientKey)}
              onDuplicate={() => onDuplicateQuestion(q.clientKey)}
              onMoveUp={() => onMoveQuestion(q.clientKey, -1)}
              onMoveDown={() => onMoveQuestion(q.clientKey, 1)}
              canMoveUp={i > 0}
              canMoveDown={i < questions.length - 1}
            />
            {q.labelMd.trim() === '' && <p className="qcard-empty-hint">質問文を入力してください</p>}
          </div>
        ))}
        {questions.length === 0 && <p className="muted">質問がまだありません。</p>}
      </div>

      <button type="button" className="btn btn-secondary add-question-btn" onClick={onAddQuestion}>
        ＋ 質問を追加
      </button>
    </div>
  );
}
