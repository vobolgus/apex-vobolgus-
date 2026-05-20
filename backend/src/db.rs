use anyhow::Context;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::fs;
use std::path::Path;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn init_db(database_url: &str) -> anyhow::Result<SqlitePool> {
    // Если используется файловая база данных, создаем родительские директории, если их нет
    if database_url.starts_with("sqlite://") && database_url != "sqlite::memory:" {
        let path_str = database_url.trim_start_matches("sqlite://");
        let path = Path::new(path_str);
        if let Some(parent) = path.parent()
            && !parent.exists()
        {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create directory {}", parent.display()))?;
        }
    }

    let max_connections = if database_url == "sqlite::memory:" { 1 } else { 5 };

    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await
        .with_context(|| format!("failed to connect to SQLite at {database_url}"))?;

    MIGRATOR
        .run(&pool)
        .await
        .context("failed to run sqlx migrations")?;

    Ok(pool)
}
