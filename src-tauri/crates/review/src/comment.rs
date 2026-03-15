use crate::{Result, ReviewError, ReviewService};
use sea_orm::prelude::Expr;
use sea_orm::*;
use serde::{Deserialize, Serialize};
use vibe_studio_db::entities::review_comment;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewCommentInfo {
    pub id: String,
    pub session_id: String,
    pub file_path: String,
    pub line_number: i32,
    pub side: String,
    pub content: String,
    pub code_line: Option<String>,
    pub is_resolved: bool,
    pub sent_to_agent: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl From<review_comment::Model> for ReviewCommentInfo {
    fn from(m: review_comment::Model) -> Self {
        Self {
            id: m.id,
            session_id: m.session_id,
            file_path: m.file_path,
            line_number: m.line_number,
            side: m.side,
            content: m.content,
            code_line: m.code_line,
            is_resolved: m.is_resolved,
            sent_to_agent: m.sent_to_agent,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

impl ReviewService {
    /// Get all comments for a session
    pub async fn get_comments(&self, session_id: &str) -> Result<Vec<ReviewCommentInfo>> {
        let comments = review_comment::Entity::find()
            .filter(review_comment::Column::SessionId.eq(session_id))
            .order_by_asc(review_comment::Column::CreatedAt)
            .all(&self.conn)
            .await?;
        Ok(comments.into_iter().map(ReviewCommentInfo::from).collect())
    }

    /// Get unresolved comments for a session
    pub async fn get_unresolved_comments(
        &self,
        session_id: &str,
    ) -> Result<Vec<ReviewCommentInfo>> {
        let comments = review_comment::Entity::find()
            .filter(review_comment::Column::SessionId.eq(session_id))
            .filter(review_comment::Column::IsResolved.eq(false))
            .order_by_asc(review_comment::Column::CreatedAt)
            .all(&self.conn)
            .await?;
        Ok(comments.into_iter().map(ReviewCommentInfo::from).collect())
    }

    /// Create a new review comment
    pub async fn create_comment(
        &self,
        session_id: &str,
        file_path: &str,
        line_number: i32,
        side: &str,
        content: &str,
        code_line: Option<&str>,
        sent_to_agent: bool,
    ) -> Result<ReviewCommentInfo> {
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();

        let model = review_comment::ActiveModel {
            id: Set(id.clone()),
            session_id: Set(session_id.to_string()),
            file_path: Set(file_path.to_string()),
            line_number: Set(line_number),
            side: Set(side.to_string()),
            content: Set(content.to_string()),
            code_line: Set(code_line.map(String::from)),
            is_resolved: Set(false),
            sent_to_agent: Set(sent_to_agent),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        };

        review_comment::Entity::insert(model)
            .exec(&self.conn)
            .await?;

        let comment = review_comment::Entity::find_by_id(&id)
            .one(&self.conn)
            .await?
            .ok_or_else(|| ReviewError::NotFound(id))?;

        Ok(ReviewCommentInfo::from(comment))
    }

    pub async fn update_comment(
        &self,
        comment_id: &str,
        content: &str,
        sent_to_agent: bool,
    ) -> Result<ReviewCommentInfo> {
        let now = chrono::Utc::now().to_rfc3339();

        review_comment::Entity::update_many()
            .col_expr(review_comment::Column::Content, Expr::value(content))
            .col_expr(
                review_comment::Column::SentToAgent,
                Expr::value(sent_to_agent),
            )
            .col_expr(review_comment::Column::UpdatedAt, Expr::value(&now))
            .filter(review_comment::Column::Id.eq(comment_id))
            .exec(&self.conn)
            .await?;

        let comment = review_comment::Entity::find_by_id(comment_id)
            .one(&self.conn)
            .await?
            .ok_or_else(|| ReviewError::NotFound(comment_id.to_string()))?;

        Ok(ReviewCommentInfo::from(comment))
    }

    /// Resolve or unresolve a comment
    pub async fn resolve_comment(
        &self,
        comment_id: &str,
        resolved: bool,
    ) -> Result<ReviewCommentInfo> {
        let now = chrono::Utc::now().to_rfc3339();

        review_comment::Entity::update_many()
            .col_expr(review_comment::Column::IsResolved, Expr::value(resolved))
            .col_expr(review_comment::Column::UpdatedAt, Expr::value(&now))
            .filter(review_comment::Column::Id.eq(comment_id))
            .exec(&self.conn)
            .await?;

        let comment = review_comment::Entity::find_by_id(comment_id)
            .one(&self.conn)
            .await?
            .ok_or_else(|| ReviewError::NotFound(comment_id.to_string()))?;

        Ok(ReviewCommentInfo::from(comment))
    }

    /// Delete a comment
    pub async fn delete_comment(&self, comment_id: &str) -> Result<()> {
        review_comment::Entity::delete_by_id(comment_id)
            .exec(&self.conn)
            .await?;
        Ok(())
    }

    /// Mark comments as sent to agent
    pub async fn mark_sent_to_agent(&self, comment_ids: &[String]) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        review_comment::Entity::update_many()
            .col_expr(review_comment::Column::SentToAgent, Expr::value(true))
            .col_expr(review_comment::Column::UpdatedAt, Expr::value(&now))
            .filter(review_comment::Column::Id.is_in(comment_ids.to_vec()))
            .exec(&self.conn)
            .await?;
        Ok(())
    }
}
