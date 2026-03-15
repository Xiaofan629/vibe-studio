use serde::Deserialize;
use tauri::State;
use vibe_studio_review::comment::ReviewCommentInfo;

#[derive(Deserialize)]
pub struct CreateCommentArgs {
    pub session_id: String,
    pub file_path: String,
    pub line_number: i32,
    pub side: String,
    pub content: String,
    pub code_line: Option<String>,
    pub sent_to_agent: Option<bool>,
}

#[derive(Deserialize)]
pub struct UpdateCommentArgs {
    pub comment_id: String,
    pub content: String,
    pub sent_to_agent: bool,
}

#[tauri::command]
pub async fn list_review_comments(
    state: State<'_, crate::AppState>,
    session_id: String,
) -> std::result::Result<Vec<ReviewCommentInfo>, String> {
    state
        .review
        .get_comments(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_unresolved_comments(
    state: State<'_, crate::AppState>,
    session_id: String,
) -> std::result::Result<Vec<ReviewCommentInfo>, String> {
    state
        .review
        .get_unresolved_comments(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_review_comment(
    state: State<'_, crate::AppState>,
    args: CreateCommentArgs,
) -> std::result::Result<ReviewCommentInfo, String> {
    state
        .review
        .create_comment(
            &args.session_id,
            &args.file_path,
            args.line_number,
            &args.side,
            &args.content,
            args.code_line.as_deref(),
            args.sent_to_agent.unwrap_or(true),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_review_comment(
    state: State<'_, crate::AppState>,
    args: UpdateCommentArgs,
) -> std::result::Result<ReviewCommentInfo, String> {
    state
        .review
        .update_comment(&args.comment_id, &args.content, args.sent_to_agent)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resolve_review_comment(
    state: State<'_, crate::AppState>,
    comment_id: String,
    resolved: bool,
) -> std::result::Result<ReviewCommentInfo, String> {
    state
        .review
        .resolve_comment(&comment_id, resolved)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_review_comment(
    state: State<'_, crate::AppState>,
    comment_id: String,
) -> std::result::Result<(), String> {
    state
        .review
        .delete_comment(&comment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn build_review_context(
    state: State<'_, crate::AppState>,
    session_id: String,
) -> std::result::Result<String, String> {
    state
        .review
        .build_review_context(&session_id)
        .await
        .map_err(|e| e.to_string())
}
