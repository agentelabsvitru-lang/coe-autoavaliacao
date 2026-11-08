-- App de Autoavaliacao CoE Zeev - tabelas do banco D1
-- Executar uma vez no console do D1 (Parte 3, passo 7 do guia).

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'analista',      -- analista | admin
  status TEXT NOT NULL DEFAULT 'convite',     -- convite | ativo | inativo
  pw_hash TEXT,
  pw_salt TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  effective_date TEXT,
  summary TEXT,
  status TEXT NOT NULL,                       -- vigente | arquivada | rascunho
  rules TEXT NOT NULL,                        -- JSON: [{code, text, sev, chapter, aval}]
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  process_name TEXT NOT NULL,
  app_code TEXT,
  flow_version TEXT,
  area TEXT,
  round INTEGER NOT NULL,
  manual_version TEXT,
  with_ai INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  created_at TEXT NOT NULL,
  b_open INTEGER NOT NULL DEFAULT 0,
  r_open INTEGER NOT NULL DEFAULT 0,
  confirm INTEGER NOT NULL DEFAULT 0,
  ready INTEGER NOT NULL DEFAULT 0,
  items TEXT NOT NULL,                        -- JSON dos itens avaliados
  risks TEXT,                                 -- JSON: pontos para validar com a area
  summary TEXT                                -- JSON: o que foi lido dos arquivos
);
CREATE INDEX IF NOT EXISTS idx_eval_user ON evaluations (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_eval_proc ON evaluations (process_name, app_code);

CREATE TABLE IF NOT EXISTS usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,                          -- AAAA-MM-DD no horario de Brasilia
  count INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER,
  change TEXT NOT NULL
);
