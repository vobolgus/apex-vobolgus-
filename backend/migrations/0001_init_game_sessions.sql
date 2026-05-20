CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    current_round INTEGER NOT NULL DEFAULT 1,
    total_rounds INTEGER NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    is_finished BOOLEAN NOT NULL DEFAULT 0,
    current_question_answer TEXT,
    current_question_data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
