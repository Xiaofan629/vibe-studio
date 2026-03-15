use tauri::Manager;
use tauri_mcp_plugin::McpPlugin;
use vibe_studio_agent::process::AgentProcessManager;
use vibe_studio_commands::AppState;
use vibe_studio_db::DbService;
use vibe_studio_review::ReviewService;
use vibe_studio_terminal::manager::TerminalManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(McpPlugin::new().build())
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::block_on(async {
                let db = DbService::new(&app_handle)
                    .await
                    .expect("Failed to initialize database");
                let review = ReviewService::new(db.conn.clone());
                app.manage(AppState {
                    db,
                    agent_manager: AgentProcessManager::new(),
                    review,
                    terminal_manager: TerminalManager::new(),
                });
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Project commands
            vibe_studio_commands::list_projects,
            vibe_studio_commands::add_local_project,
            vibe_studio_commands::get_project,
            vibe_studio_commands::delete_project,
            vibe_studio_commands::list_directory,
            vibe_studio_commands::get_home_dir,
            vibe_studio_commands::get_repo_branches,
            // Session commands
            vibe_studio_commands::list_sessions,
            vibe_studio_commands::list_sessions_by_workspace,
            vibe_studio_commands::get_session,
            vibe_studio_commands::create_session,
            vibe_studio_commands::update_session_status,
            vibe_studio_commands::delete_session,
            vibe_studio_commands::setup_session_worktree,
            vibe_studio_commands::cleanup_session_worktree,
            vibe_studio_commands::load_claude_session_history,
            vibe_studio_commands::load_claude_session,
            vibe_studio_commands::load_claude_session_full,
            // Agent commands
            vibe_studio_commands::discover_agents,
            vibe_studio_commands::start_agent,
            vibe_studio_commands::stop_agent,
            vibe_studio_commands::is_agent_running,
            // Git commands
            vibe_studio_commands::git_branches,
            vibe_studio_commands::git_current_branch,
            vibe_studio_commands::git_checkout,
            vibe_studio_commands::git_clone,
            vibe_studio_commands::git_diff_summary,
            vibe_studio_commands::git_diff_full,
            vibe_studio_commands::git_diff_full_for_revision,
            vibe_studio_commands::git_diff_full_between_revisions,
            vibe_studio_commands::git_diff_raw_patch,
            vibe_studio_commands::git_diff_raw_patch_for_revision,
            vibe_studio_commands::git_diff_raw_patch_between_revisions,
            vibe_studio_commands::git_diff_file_contents,
            vibe_studio_commands::git_list_branch_commits,
            vibe_studio_commands::git_commit,
            vibe_studio_commands::git_commit_selected,
            vibe_studio_commands::git_push,
            vibe_studio_commands::git_create_pr,
            vibe_studio_commands::git_generate_commit_content,
            vibe_studio_commands::git_generate_commit_content_from_patch,
            vibe_studio_commands::git_generate_pr_content,
            vibe_studio_commands::git_get_pr_info,
            vibe_studio_commands::git_get_remote_review_bundle,
            vibe_studio_commands::git_update_pr_description,
            // Editor commands
            vibe_studio_commands::open_in_editor,
            // Review commands
            vibe_studio_commands::list_review_comments,
            vibe_studio_commands::list_unresolved_comments,
            vibe_studio_commands::create_review_comment,
            vibe_studio_commands::update_review_comment,
            vibe_studio_commands::resolve_review_comment,
            vibe_studio_commands::delete_review_comment,
            vibe_studio_commands::build_review_context,
            // Terminal commands
            vibe_studio_commands::create_terminal,
            vibe_studio_commands::write_terminal,
            vibe_studio_commands::resize_terminal,
            vibe_studio_commands::close_terminal,
            vibe_studio_commands::change_terminal_directory,
            // Workspace commands
            vibe_studio_commands::create_workspace,
            vibe_studio_commands::list_workspaces,
            vibe_studio_commands::get_workspace,
            vibe_studio_commands::update_workspace_status,
            vibe_studio_commands::delete_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
