-- FormNow initial schema
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_teams_event ON teams(event_id);

CREATE TABLE respondents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('judge','member')),
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_respondents_event ON respondents(event_id);

CREATE TABLE forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('judge','peer')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  sheet_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_forms_event ON forms(event_id);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN ('rating','number','choice','checkbox','text','textarea')),
  label_md TEXT NOT NULL,
  options_json TEXT,
  max_score REAL,
  weight REAL NOT NULL DEFAULT 1,
  required INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_questions_form ON questions(form_id);

CREATE TABLE responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  respondent_id INTEGER NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (form_id, respondent_id, team_id)
);
CREATE INDEX idx_responses_form ON responses(form_id);

CREATE TABLE answers (
  response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  value_json TEXT NOT NULL,
  PRIMARY KEY (response_id, question_id)
);

CREATE TABLE formulas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  expression TEXT NOT NULL
);
CREATE INDEX idx_formulas_event ON formulas(event_id);
