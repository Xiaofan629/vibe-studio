pub mod entities;
pub mod migration;

use sea_orm::{Database, DatabaseConnection};
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("Database error: {0}")]
    SeaOrm(#[from] sea_orm::DbErr),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, DbError>;

pub struct DbService {
    pub conn: DatabaseConnection,
}

impl DbService {
    pub async fn new(app: &tauri::AppHandle) -> Result<Self> {
        let app_dir = app
            .path()
            .app_data_dir()
            .expect("Failed to get app data dir");
        std::fs::create_dir_all(&app_dir)?;

        let db_path = app_dir.join("vibe-studio.db");
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

        let conn = Database::connect(&db_url).await?;

        // Run migrations
        use sea_orm_migration::MigratorTrait;
        migration::Migrator::up(&conn, None).await?;

        Ok(Self { conn })
    }
}

use tauri::Manager;
