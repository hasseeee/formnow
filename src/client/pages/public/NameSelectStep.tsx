import { useState, type FormEvent } from 'react';
import type { PublicFormView } from '../../../shared/types';
import Markdown from '../../components/Markdown';

interface Props {
  view: PublicFormView;
  onSelect: (respondentId: number) => void;
}

export default function NameSelectStep({ view, onSelect }: Props) {
  const [selected, setSelected] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    onSelect(Number(selected));
  };

  return (
    <div className="page-container form-flow">
      <header className="form-header">
        <h1>{view.form.title}</h1>
        <Markdown source={view.form.descriptionMd} />
      </header>
      <form className="card name-select-card" onSubmit={handleSubmit}>
        <label htmlFor="respondent-select">あなたの名前を選択してください</label>
        <select
          id="respondent-select"
          className="select-input"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          required
        >
          <option value="" disabled>
            選択してください
          </option>
          {view.respondents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {view.respondents.length === 0 && (
          <p className="muted">このフォームに回答できる人が登録されていません。</p>
        )}
        <button type="submit" className="btn btn-primary" disabled={!selected}>
          回答をはじめる
        </button>
      </form>
    </div>
  );
}
