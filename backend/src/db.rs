use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::fs;
use std::path::Path;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

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

    let max_connections = if database_url == "sqlite::memory:" { 1 } else { 5 };

    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await
        .expect("Failed to connect to SQLite");

    MIGRATOR
        .run(&pool)
        .await
        .expect("Failed to run migrations");

    pool
}
