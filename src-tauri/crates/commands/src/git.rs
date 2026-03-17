use serde::Serialize;
use vibe_studio_agent::{
    adapters::create_adapter, parsers::parse_output, AgentLogEntryType, AgentType,
};
use vibe_studio_git::GitService;

#[derive(Serialize)]
pub struct DiffFileContentsResponse {
    pub old_contents: String,
    pub new_contents: String,
}

fn read_git_file(repo_path: &std::path::Path, revision: &str, file_path: &str) -> Option<String> {
    vibe_studio_git::cli::run_git(repo_path, &["show", &format!("{}:{}", revision, file_path)]).ok()
}

#[derive(Serialize)]
pub struct GitBranchResponse {
    pub name: String,
    pub is_remote: bool,
    pub is_current: bool,
    pub last_commit_sha: Option<String>,
    pub last_commit_message: Option<String>,
}

#[derive(Serialize)]
pub struct DiffFileResponse {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub change_kind: String,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<vibe_studio_git::DiffHunk>,
    pub is_binary: bool,
    pub content_omitted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitHistoryResponse {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
    pub committed_at: String,
    pub index: usize,
}

#[tauri::command]
pub async fn git_branches(
    repo_path: String,
) -> std::result::Result<Vec<GitBranchResponse>, String> {
    let git = GitService::new();
    let branches = git
        .get_all_branches(std::path::Path::new(&repo_path))
        .map_err(|e| e.to_string())?;

    Ok(branches
        .into_iter()
        .map(|b| GitBranchResponse {
            name: b.name,
            is_remote: b.is_remote,
            is_current: b.is_current,
            last_commit_sha: b.last_commit_sha,
            last_commit_message: b.last_commit_message,
        })
        .collect())
}

#[tauri::command]
pub async fn git_current_branch(repo_path: String) -> std::result::Result<String, String> {
    let git = GitService::new();
    git.get_current_branch(std::path::Path::new(&repo_path))
        .map(|s| s.trim().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_checkout(repo_path: String, branch: String) -> std::result::Result<(), String> {
    let git = GitService::new();
    git.checkout_branch(std::path::Path::new(&repo_path), &branch)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_clone(
    url: String,
    target: String,
    token: Option<String>,
) -> std::result::Result<(), String> {
    let git = GitService::new();
    git.clone_repository(&url, std::path::Path::new(&target), token.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_diff_summary(
    repo_path: String,
    base_branch: Option<String>,
) -> std::result::Result<Vec<DiffFileResponse>, String> {
    let git = GitService::new();
    let files = git
        .get_worktree_diffs(std::path::Path::new(&repo_path), base_branch.as_deref())
        .map_err(|e| e.to_string())?;

    Ok(files
        .into_iter()
        .map(|f| DiffFileResponse {
            old_path: f.old_path,
            new_path: f.new_path,
            change_kind: f.change_kind,
            additions: f.additions,
            deletions: f.deletions,
            hunks: f.hunks,
            is_binary: f.is_binary,
            content_omitted: f.content_omitted,
        })
        .collect())
}

#[tauri::command]
pub async fn git_diff_full(
    repo_path: String,
    base_branch: Option<String>,
) -> std::result::Result<Vec<DiffFileResponse>, String> {
    let git = GitService::new();
    let files = git
        .get_full_diff(std::path::Path::new(&repo_path), base_branch.as_deref())
        .map_err(|e| e.to_string())?;

    Ok(files
        .into_iter()
        .map(|f| DiffFileResponse {
            old_path: f.old_path,
            new_path: f.new_path,
            change_kind: f.change_kind,
            additions: f.additions,
            deletions: f.deletions,
            hunks: f.hunks,
            is_binary: f.is_binary,
            content_omitted: f.content_omitted,
        })
        .collect())
}

#[tauri::command]
pub async fn git_diff_full_for_revision(
    repo_path: String,
    revision_range: String,
) -> std::result::Result<Vec<DiffFileResponse>, String> {
    let git = GitService::new();
    let files = git
        .get_full_diff(std::path::Path::new(&repo_path), Some(&revision_range))
        .map_err(|e| e.to_string())?;

    Ok(files
        .into_iter()
        .map(|f| DiffFileResponse {
            old_path: f.old_path,
            new_path: f.new_path,
            change_kind: f.change_kind,
            additions: f.additions,
            deletions: f.deletions,
            hunks: f.hunks,
            is_binary: f.is_binary,
            content_omitted: f.content_omitted,
        })
        .collect())
}

#[tauri::command]
pub async fn git_diff_full_between_revisions(
    repo_path: String,
    from_revision: String,
    to_revision: String,
) -> std::result::Result<Vec<DiffFileResponse>, String> {
    let git = GitService::new();
    let parsed = git
        .get_full_diff_between(
            std::path::Path::new(&repo_path),
            &from_revision,
            &to_revision,
        )
        .map_err(|e| e.to_string())?;

    Ok(parsed
        .into_iter()
        .map(|f| DiffFileResponse {
            old_path: f.old_path,
            new_path: f.new_path,
            change_kind: f.change_kind,
            additions: f.additions,
            deletions: f.deletions,
            hunks: f.hunks,
            is_binary: f.is_binary,
            content_omitted: f.content_omitted,
        })
        .collect())
}

#[derive(Serialize)]
pub struct CommitResult {
    pub sha: String,
    pub branch: String,
    pub message: String,
}

#[tauri::command]
pub async fn git_commit(
    repo_path: String,
    message: String,
) -> std::result::Result<CommitResult, String> {
    let path = std::path::Path::new(&repo_path);

    vibe_studio_git::cli::run_git(path, &["add", "-A"]).map_err(|e| e.to_string())?;

    vibe_studio_git::cli::run_git(path, &["commit", "-m", &message]).map_err(|e| e.to_string())?;

    let sha = vibe_studio_git::cli::run_git(path, &["rev-parse", "--short", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let branch = GitService::new()
        .get_current_branch(path)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    Ok(CommitResult {
        sha,
        branch,
        message,
    })
}

#[tauri::command]
pub async fn git_commit_selected(
    repo_path: String,
    message: String,
    patch: String,
) -> std::result::Result<CommitResult, String> {
    let path = std::path::Path::new(&repo_path);

    if patch.trim().is_empty() {
        return Err("No selected changes to commit".to_string());
    }

    let staged_status = std::process::Command::new("git")
        .current_dir(path)
        .args(["diff", "--cached", "--quiet"])
        .status()
        .map_err(|e| e.to_string())?;

    if !staged_status.success() {
        return Err(
            "There are already staged changes. Please commit or unstage them first.".to_string(),
        );
    }

    // 使用 --3way 来启用三路合并，即使有轻微不匹配也能成功
    // 使用 --whitespace=fix 自动修复换行符问题
    let apply_result = vibe_studio_git::cli::run_git_with_input(
        path,
        &[
            "apply",
            "--cached",
            "--3way",
            "--whitespace=fix",
            "-",
        ],
        &patch,
    );

    // 如果 3way 失败，尝试使用更宽松的参数
    if let Err(e) = apply_result {
        vibe_studio_git::cli::run_git_with_input(
            path,
            &[
                "apply",
                "--cached",
                "--recount",
                "--inaccurate-eof",
                "--whitespace=nowarn",
                "-",
            ],
            &patch,
        )
        .map_err(|e2| format!("{} (fallback also failed: {})", e, e2))?;
    }

    let commit_result = vibe_studio_git::cli::run_git(path, &["commit", "-m", &message]);

    if let Err(err) = commit_result {
        let _ = vibe_studio_git::cli::run_git(path, &["reset", "--mixed", "HEAD"]);
        return Err(err.to_string());
    }

    let sha = vibe_studio_git::cli::run_git(path, &["rev-parse", "--short", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let branch = GitService::new()
        .get_current_branch(path)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    Ok(CommitResult {
        sha,
        branch,
        message,
    })
}

#[tauri::command]
pub async fn git_push(repo_path: String) -> std::result::Result<(), String> {
    let path = std::path::Path::new(&repo_path);
    vibe_studio_git::cli::run_git(path, &["push"]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn git_diff_raw_patch(
    repo_path: String,
    base_branch: Option<String>,
) -> std::result::Result<String, String> {
    let git = GitService::new();
    git.get_raw_diff(std::path::Path::new(&repo_path), base_branch.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_diff_raw_patch_for_revision(
    repo_path: String,
    revision_range: String,
) -> std::result::Result<String, String> {
    let git = GitService::new();
    git.get_raw_diff(std::path::Path::new(&repo_path), Some(&revision_range))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_diff_raw_patch_between_revisions(
    repo_path: String,
    from_revision: String,
    to_revision: String,
) -> std::result::Result<String, String> {
    let git = GitService::new();
    git.get_raw_diff_between(
        std::path::Path::new(&repo_path),
        &from_revision,
        &to_revision,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_list_branch_commits(
    repo_path: String,
    base_branch: Option<String>,
) -> std::result::Result<Vec<CommitHistoryResponse>, String> {
    let path = std::path::Path::new(&repo_path);
    let log_target = match base_branch
        .as_deref()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
    {
        Some(branch) => format!("{branch}..HEAD"),
        None => "HEAD".to_string(),
    };

    let output = vibe_studio_git::cli::run_git(
        path,
        &[
            "log",
            "--first-parent",
            "--reverse",
            "--format=%H%x1f%h%x1f%s%x1f%cI",
            &log_target,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(output
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let mut parts = line.split('\u{1f}');
            let sha = parts.next()?.trim();
            let short_sha = parts.next()?.trim();
            let summary = parts.next()?.trim();
            let committed_at = parts.next()?.trim();

            if sha.is_empty() {
                return None;
            }

            Some(CommitHistoryResponse {
                sha: sha.to_string(),
                short_sha: short_sha.to_string(),
                summary: summary.to_string(),
                committed_at: committed_at.to_string(),
                index: index + 1,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn git_diff_file_contents(
    repo_path: String,
    old_path: Option<String>,
    new_path: Option<String>,
    base_branch: Option<String>,
    old_revision: Option<String>,
    new_revision: Option<String>,
) -> std::result::Result<DiffFileContentsResponse, String> {
    let repo_path = std::path::Path::new(&repo_path);
    let old_ref = old_revision
        .or(base_branch)
        .unwrap_or_else(|| "HEAD".to_string());

    let old_contents = old_path
        .as_deref()
        .and_then(|path| read_git_file(repo_path, &old_ref, path))
        .unwrap_or_default();

    let new_contents = match new_revision {
        Some(revision) => new_path
            .as_deref()
            .and_then(|path| read_git_file(repo_path, &revision, path))
            .unwrap_or_default(),
        None => new_path
            .as_deref()
            .and_then(|path| std::fs::read_to_string(repo_path.join(path)).ok())
            .unwrap_or_default(),
    };

    Ok(DiffFileContentsResponse {
        old_contents,
        new_contents,
    })
}

#[derive(Serialize)]
pub struct PrInfoResponse {
    pub number: i64,
    pub url: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct GeneratedPrContentResponse {
    pub title: String,
    pub body: String,
}

#[derive(Serialize)]
pub struct GeneratedCommitContentResponse {
    pub title: String,
    pub body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteReviewFileResponse {
    pub path: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub patch: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteReviewCommentResponse {
    pub id: String,
    pub path: String,
    pub line: Option<i64>,
    pub side: Option<String>,
    pub body: String,
    pub diff_hunk: Option<String>,
    pub author: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteReviewBundleResponse {
    pub pr_number: i64,
    pub pr_url: String,
    pub base_branch: String,
    pub head_branch: String,
    pub files: Vec<RemoteReviewFileResponse>,
    pub comments: Vec<RemoteReviewCommentResponse>,
}

#[tauri::command]
pub async fn git_create_pr(
    repo_path: String,
    title: String,
    body: Option<String>,
    base_branch: String,
    draft: bool,
) -> std::result::Result<PrInfoResponse, String> {
    let git = GitService::new();
    let pr_info = git
        .create_pr(
            std::path::Path::new(&repo_path),
            &title,
            body.as_deref(),
            &base_branch,
            draft,
        )
        .map_err(|e| e.to_string())?;

    Ok(PrInfoResponse {
        number: pr_info.number,
        url: pr_info.url,
        status: pr_info.status,
    })
}

#[tauri::command]
pub async fn git_generate_commit_content(
    repo_path: String,
    agent_type: String,
    workspace_title: Option<String>,
    workspace_prompt: Option<String>,
    current_title: Option<String>,
    current_body: Option<String>,
) -> std::result::Result<GeneratedCommitContentResponse, String> {
    let path = std::path::Path::new(&repo_path);
    let git = GitService::new();
    let agent_type = parse_agent_type(&agent_type)?;
    let current_branch = git
        .get_current_branch(path)
        .map(|s| s.trim().to_string())
        .map_err(|e| e.to_string())?;
    let diff_files = git
        .get_worktree_diffs(path, None)
        .map_err(|e| e.to_string())?;
    let raw_patch = git.get_raw_diff(path, None).map_err(|e| e.to_string())?;

    let prompt = build_commit_generation_prompt(
        &current_branch,
        workspace_title.as_deref(),
        workspace_prompt.as_deref(),
        current_title.as_deref(),
        current_body.as_deref(),
        &diff_files,
        &raw_patch,
    );

    let output = run_agent_prompt(agent_type, path, &prompt).await?;
    let generated = extract_title_body_json(&output, "commit")?;

    Ok(GeneratedCommitContentResponse {
        title: generated.title,
        body: generated.body,
    })
}

#[tauri::command]
pub async fn git_generate_commit_content_from_patch(
    repo_path: String,
    agent_type: String,
    workspace_title: Option<String>,
    workspace_prompt: Option<String>,
    current_title: Option<String>,
    current_body: Option<String>,
    patch: String,
) -> std::result::Result<GeneratedCommitContentResponse, String> {
    let path = std::path::Path::new(&repo_path);

    // Verify that the repository path exists
    if !path.exists() {
        return Err(format!("Repository path does not exist: {}", repo_path));
    }

    // Verify that it's a valid git repository
    let git_dir = path.join(".git");
    if !git_dir.exists() {
        return Err(format!(
            "Not a valid git repository (no .git directory): {}",
            repo_path
        ));
    }

    let git = GitService::new();
    let agent_type = parse_agent_type(&agent_type)?;
    let current_branch = git
        .get_current_branch(path)
        .map(|s| s.trim().to_string())
        .map_err(|e| e.to_string())?;

    if patch.trim().is_empty() {
        return Err("No selected changes to summarize".to_string());
    }

    let prompt = build_commit_generation_prompt_from_patch(
        &current_branch,
        workspace_title.as_deref(),
        workspace_prompt.as_deref(),
        current_title.as_deref(),
        current_body.as_deref(),
        &patch,
    );

    let output = run_agent_prompt(agent_type, path, &prompt).await?;
    let generated = extract_title_body_json(&output, "commit")?;

    Ok(GeneratedCommitContentResponse {
        title: generated.title,
        body: generated.body,
    })
}

#[tauri::command]
pub async fn git_generate_pr_content(
    repo_path: String,
    agent_type: String,
    base_branch: String,
    workspace_title: Option<String>,
    workspace_prompt: Option<String>,
    current_title: Option<String>,
    current_body: Option<String>,
) -> std::result::Result<GeneratedPrContentResponse, String> {
    let path = std::path::Path::new(&repo_path);
    let git = GitService::new();
    let agent_type = parse_agent_type(&agent_type)?;
    let current_branch = git
        .get_current_branch(path)
        .map(|s| s.trim().to_string())
        .map_err(|e| e.to_string())?;
    let diff_files = git
        .get_worktree_diffs(path, Some(&base_branch))
        .map_err(|e| e.to_string())?;
    let raw_patch = git
        .get_raw_diff(path, Some(&base_branch))
        .map_err(|e| e.to_string())?;

    let prompt = build_pr_generation_prompt(
        &current_branch,
        &base_branch,
        workspace_title.as_deref(),
        workspace_prompt.as_deref(),
        current_title.as_deref(),
        current_body.as_deref(),
        &diff_files,
        &raw_patch,
    );

    let output = run_agent_prompt(agent_type, path, &prompt).await?;
    let generated = extract_title_body_json(&output, "PR")?;

    Ok(GeneratedPrContentResponse {
        title: generated.title,
        body: generated.body,
    })
}

#[tauri::command]
pub async fn git_get_pr_info(
    repo_path: String,
    branch: Option<String>,
) -> std::result::Result<Option<PrInfoResponse>, String> {
    let git = GitService::new();
    let pr_info = git
        .get_pr_info(std::path::Path::new(&repo_path), branch.as_deref())
        .map_err(|e| e.to_string())?;

    Ok(pr_info.map(|info| PrInfoResponse {
        number: info.number,
        url: info.url,
        status: info.status,
    }))
}

#[tauri::command]
pub async fn git_update_pr_description(
    repo_path: String,
    pr_number: i64,
    body: String,
) -> std::result::Result<(), String> {
    let git = GitService::new();
    git.update_pr_description(std::path::Path::new(&repo_path), pr_number, &body)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_get_remote_review_bundle(
    repo_path: String,
    branch: Option<String>,
) -> std::result::Result<RemoteReviewBundleResponse, String> {
    let git = GitService::new();
    let bundle = git
        .get_remote_review_bundle(std::path::Path::new(&repo_path), branch.as_deref())
        .map_err(|e| e.to_string())?;

    Ok(RemoteReviewBundleResponse {
        pr_number: bundle.pr_number,
        pr_url: bundle.pr_url,
        base_branch: bundle.base_branch,
        head_branch: bundle.head_branch,
        files: bundle
            .files
            .into_iter()
            .map(|file| RemoteReviewFileResponse {
                path: file.path,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
                patch: file.patch,
            })
            .collect(),
        comments: bundle
            .comments
            .into_iter()
            .map(|comment| RemoteReviewCommentResponse {
                id: comment.id,
                path: comment.path,
                line: comment.line,
                side: comment.side,
                body: comment.body,
                diff_hunk: comment.diff_hunk,
                author: comment.author,
                created_at: comment.created_at,
            })
            .collect(),
    })
}

fn parse_agent_type(agent_type: &str) -> std::result::Result<AgentType, String> {
    match agent_type {
        "claude_code" | "claudecode" => Ok(AgentType::ClaudeCode),
        "gemini" => Ok(AgentType::Gemini),
        "codex" => Ok(AgentType::Codex),
        _ => Err(format!("Unknown agent type: {}", agent_type)),
    }
}

async fn run_agent_prompt(
    agent_type: AgentType,
    working_dir: &std::path::Path,
    prompt: &str,
) -> std::result::Result<String, String> {
    let adapter = create_adapter(agent_type);
    let mut command = adapter.build_command(working_dir, prompt, false, None);
    for (key, value) in adapter.env_vars() {
        command.env(key, value);
    }

    let output = command.output().await.map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            stdout.trim().to_string()
        } else {
            stderr
        });
    }

    let mut text_blocks = Vec::new();
    let mut error_blocks = Vec::new();

    for line in stdout.lines() {
        for entry in parse_output(agent_type, line) {
            match entry.entry_type {
                AgentLogEntryType::Text => {
                    if !entry.content.trim().is_empty() {
                        text_blocks.push(entry.content);
                    }
                }
                AgentLogEntryType::Error => {
                    if !entry.content.trim().is_empty() {
                        error_blocks.push(entry.content);
                    }
                }
                _ => {}
            }
        }
    }

    if !error_blocks.is_empty() && text_blocks.is_empty() {
        return Err(error_blocks.join("\n"));
    }

    let combined = text_blocks.join("\n").trim().to_string();
    if combined.is_empty() {
        Ok(stdout.trim().to_string())
    } else {
        Ok(combined)
    }
}

fn build_pr_generation_prompt(
    current_branch: &str,
    base_branch: &str,
    workspace_title: Option<&str>,
    workspace_prompt: Option<&str>,
    current_title: Option<&str>,
    current_body: Option<&str>,
    diff_files: &[vibe_studio_git::DiffFile],
    raw_patch: &str,
) -> String {
    let diff_summary = if diff_files.is_empty() {
        "No changed files detected.".to_string()
    } else {
        diff_files
            .iter()
            .take(30)
            .map(|file| {
                let path = file
                    .new_path
                    .as_deref()
                    .or(file.old_path.as_deref())
                    .unwrap_or("unknown");
                format!("- {} (+{} -{})", path, file.additions, file.deletions)
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let truncated_patch = truncate_chars(raw_patch, 12000);

    format!(
        "You are generating a pull request or merge request title and description.\n\
Return only valid JSON with this exact shape:\n\
{{\"title\":\"...\",\"body\":\"...\"}}\n\
Do not wrap the JSON in markdown fences.\n\n\
Rules:\n\
- The title should be concise and clear.\n\
- The body should be markdown and explain the user-visible intent plus the main changes.\n\
- Prefer the workspace title as the semantic goal when it is available.\n\
- Mention testing only when it is evident from the diff or existing draft.\n\
- Do not invent implementation details that are not supported by the diff.\n\n\
Current branch: {current_branch}\n\
Base branch: {base_branch}\n\
Workspace title: {workspace_title}\n\
Workspace prompt: {workspace_prompt}\n\
Existing title draft: {current_title}\n\
Existing body draft: {current_body}\n\n\
Changed files summary:\n{diff_summary}\n\n\
Raw diff (truncated):\n{truncated_patch}\n",
        workspace_title = workspace_title.unwrap_or(""),
        workspace_prompt = workspace_prompt.unwrap_or(""),
        current_title = current_title.unwrap_or(""),
        current_body = current_body.unwrap_or(""),
    )
}

fn build_commit_generation_prompt(
    current_branch: &str,
    workspace_title: Option<&str>,
    workspace_prompt: Option<&str>,
    current_title: Option<&str>,
    current_body: Option<&str>,
    diff_files: &[vibe_studio_git::DiffFile],
    raw_patch: &str,
) -> String {
    let diff_summary = if diff_files.is_empty() {
        "No changed files detected.".to_string()
    } else {
        diff_files
            .iter()
            .take(30)
            .map(|file| {
                let path = file
                    .new_path
                    .as_deref()
                    .or(file.old_path.as_deref())
                    .unwrap_or("unknown");
                format!("- {} (+{} -{})", path, file.additions, file.deletions)
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let truncated_patch = truncate_chars(raw_patch, 12000);

    format!(
        "You are generating a git commit title and body.\n\
Return only valid JSON with this exact shape:\n\
{{\"title\":\"...\",\"body\":\"...\"}}\n\
Do not wrap the JSON in markdown fences.\n\n\
Rules:\n\
- Prefer a concise conventional-commit-style title when the change type is clear, such as feat:, fix:, refactor:, docs:, test:, chore:.\n\
- The title must be a single line.\n\
- The body should be plain text or markdown bullet points summarizing the important changes.\n\
- Prefer the workspace title as the semantic goal when it is available.\n\
- Do not invent details that are not supported by the diff.\n\n\
Current branch: {current_branch}\n\
Workspace title: {workspace_title}\n\
Workspace prompt: {workspace_prompt}\n\
Existing title draft: {current_title}\n\
Existing body draft: {current_body}\n\n\
Changed files summary:\n{diff_summary}\n\n\
Raw diff (truncated):\n{truncated_patch}\n",
        workspace_title = workspace_title.unwrap_or(""),
        workspace_prompt = workspace_prompt.unwrap_or(""),
        current_title = current_title.unwrap_or(""),
        current_body = current_body.unwrap_or(""),
    )
}

fn build_commit_generation_prompt_from_patch(
    current_branch: &str,
    workspace_title: Option<&str>,
    workspace_prompt: Option<&str>,
    current_title: Option<&str>,
    current_body: Option<&str>,
    raw_patch: &str,
) -> String {
    let truncated_patch = truncate_chars(raw_patch, 12000);

    format!(
        "You are generating a git commit title and body for a selected subset of changes.\n\
Return only valid JSON with this exact shape:\n\
{{\"title\":\"...\",\"body\":\"...\"}}\n\
Do not wrap the JSON in markdown fences.\n\n\
Rules:\n\
- Prefer a concise conventional-commit-style title when the change type is clear, such as feat:, fix:, refactor:, docs:, test:, chore:.\n\
- The title must be a single line.\n\
- The body should summarize only the selected changes in the patch.\n\
- Prefer the workspace title as the semantic goal when it is available.\n\
- Do not invent details that are not supported by the patch.\n\n\
Current branch: {current_branch}\n\
Workspace title: {workspace_title}\n\
Workspace prompt: {workspace_prompt}\n\
Existing title draft: {current_title}\n\
Existing body draft: {current_body}\n\n\
Selected patch (truncated):\n{truncated_patch}\n",
        workspace_title = workspace_title.unwrap_or(""),
        workspace_prompt = workspace_prompt.unwrap_or(""),
        current_title = current_title.unwrap_or(""),
        current_body = current_body.unwrap_or(""),
    )
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return text.to_string();
    }

    let truncated: String = text.chars().take(max_chars).collect();
    format!("{truncated}\n\n[diff truncated, {char_count} chars total]")
}

struct GeneratedTitleBody {
    title: String,
    body: String,
}

fn extract_title_body_json(
    output: &str,
    label: &str,
) -> std::result::Result<GeneratedTitleBody, String> {
    let candidate = extract_json_candidate(output).ok_or_else(|| {
        format!(
            "AI did not return valid {} JSON. Output was:\n{}",
            label, output
        )
    })?;

    let json: serde_json::Value = serde_json::from_str(&candidate).map_err(|e| {
        format!(
            "Failed to parse AI {} JSON: {}\nOutput was:\n{}",
            label, e, output
        )
    })?;

    let title = json["title"].as_str().unwrap_or("").trim().to_string();
    let body = json["body"].as_str().unwrap_or("").trim().to_string();

    if title.is_empty() {
        return Err(format!(
            "AI returned empty {} title. Output was:\n{}",
            label, output
        ));
    }

    Ok(GeneratedTitleBody { title, body })
}

fn extract_json_candidate(text: &str) -> Option<String> {
    let trimmed = text.trim();

    if let Some(stripped) = trimmed
        .strip_prefix("```json")
        .and_then(|value| value.strip_suffix("```"))
    {
        return Some(clean_json_string(stripped.trim()));
    }

    if let Some(stripped) = trimmed
        .strip_prefix("```")
        .and_then(|value| value.strip_suffix("```"))
    {
        return Some(clean_json_string(stripped.trim()));
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end < start {
        return None;
    }

    Some(clean_json_string(&trimmed[start..=end]))
}

// Remove raw control characters that some agents emit inside JSON-like output.
// Escaped sequences such as "\\n" remain intact because they are ordinary chars.
fn clean_json_string(json: &str) -> String {
    json.chars()
        .filter(|c| (*c as u32) > 0x1F)
        .collect()
}
