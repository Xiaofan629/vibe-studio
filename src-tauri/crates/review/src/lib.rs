pub mod comment;
pub mod context;

use thiserror::Error;

#[derive(Error, Debug)]
pub enum ReviewError {
    #[error("Database error: {0}")]
    Db(#[from] sea_orm::DbErr),
    #[error("Comment not found: {0}")]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, ReviewError>;

pub struct ReviewService {
    pub conn: sea_orm::DatabaseConnection,
}

impl ReviewService {
    pub fn new(conn: sea_orm::DatabaseConnection) -> Self {
        Self { conn }
    }
}
