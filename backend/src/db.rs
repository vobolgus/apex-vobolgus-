use anyhow::Context;
use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};
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

    let max_connections = if database_url == "sqlite::memory:" {
        1
    } else {
        5
    };

    let connect_options: sqlx::sqlite::SqliteConnectOptions = database_url
        .parse()
        .with_context(|| format!("invalid SQLite database URL: {database_url}"))?;
    let connect_options = connect_options.create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .connect_with(connect_options)
        .await
        .with_context(|| format!("failed to connect to SQLite at {database_url}"))?;

    MIGRATOR
        .run(&pool)
        .await
        .context("failed to run sqlx migrations")?;

    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    const EXPECTED_TABLES: &[&str] = &["game_sessions"];
    const EXPECTED_COLUMNS: &[&str] = &[
        "id",
        "mode",
        "difficulty",
        "current_round",
        "total_rounds",
        "score",
        "streak",
        "is_finished",
        "current_question_answer",
        "current_question_data",
        "created_at",
    ];

    #[tokio::test]
    async fn init_db_creates_expected_schema() {
        let pool = init_db("sqlite::memory:")
            .await
            .expect("init_db should succeed for an in-memory database");

        let tables: Vec<String> = sqlx::query_scalar::<_, String>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlx_%' AND name NOT LIKE '_sqlx_%' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .expect("query sqlite_master");

        for expected_table in EXPECTED_TABLES {
            assert!(
                tables.contains(&expected_table.to_string()),
                "expected table '{}' not found in schema; got {:?}",
                expected_table,
                tables,
            );
        }

        let game_session_columns: Vec<String> = sqlx::query("PRAGMA table_info(game_sessions)")
            .fetch_all(&pool)
            .await
            .expect("read game_sessions columns")
            .into_iter()
            .map(|row| row.get("name"))
            .collect();

        for expected_column in EXPECTED_COLUMNS {
            assert!(
                game_session_columns.contains(&expected_column.to_string()),
                "expected column '{}' not found in game_sessions; got {:?}",
                expected_column,
                game_session_columns,
            );
        }
    }
}
