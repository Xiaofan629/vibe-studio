use crate::{Result, ReviewService};

impl ReviewService {
    /// Format unresolved comments as Agent prompt context
    pub async fn build_review_context(&self, session_id: &str) -> Result<String> {
        let comments = self
            .get_unresolved_comments(session_id)
            .await?
            .into_iter()
            .filter(|comment| comment.sent_to_agent)
            .collect::<Vec<_>>();
        if comments.is_empty() {
            return Ok(String::new());
        }

        let mut context = String::from("\n\n## Code Review Comments (please address these):\n\n");
        for c in &comments {
            context.push_str(&format!(
                "- **{}:{}** ({}): {}\n",
                c.file_path, c.line_number, c.side, c.content
            ));
        }
        Ok(context)
    }
}
