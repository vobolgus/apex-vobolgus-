use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::fs;
use std::path::Path;

pub async fn init_db(database_url: &str) -> SqlitePool {
    // Если используется файловая база данных, создаем родительские директории, если их нет
    if database_url.starts_with("sqlite://") && database_url != "sqlite::memory:" {
        let path_str = database_url.trim_start_matches("sqlite://");
        let path = Path::new(path_str);
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).unwrap();
            }
        }
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
        .expect("Failed to connect to SQLite");

    // Запускаем инициализирующие запросы (миграции)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS game_sessions (
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
        );"
    )
    .execute(&pool)
    .await
    .expect("Failed to run migrations");

    pool
}
