use crate::{cli::run_git, GitError, Result};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Debug)]
pub struct PrInfo {
    pub number: i64,
    pub url: String,
    pub status: String,
}

#[derive(Serialize, Debug)]
pub struct RemoteReviewFile {
    pub path: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub patch: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct RemoteReviewComment {
    pub id: String,
    pub path: String,
    pub line: Option<i64>,
    pub side: Option<String>,
    pub body: String,
    pub diff_hunk: Option<String>,
    pub author: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct RemoteReviewBundle {
    pub pr_number: i64,
    pub pr_url: String,
    pub base_branch: String,
    pub head_branch: String,
    pub files: Vec<RemoteReviewFile>,
    pub comments: Vec<RemoteReviewComment>,
}

enum ReviewProvider {
    GitHub,
    GitLab,
}

impl crate::GitService {
    pub fn create_pr(
        &self,
        repo_path: &Path,
        title: &str,
        body: Option<&str>,
        base_branch: &str,
        draft: bool,
    ) -> Result<PrInfo> {
        let provider = detect_review_provider(repo_path)?;
        let current_branch = self.get_current_branch(repo_path)?.trim().to_string();
        ensure_pr_can_be_created(repo_path, &current_branch, base_branch)?;
        push_current_branch(repo_path, &current_branch)?;

        match provider {
            ReviewProvider::GitHub => {
                let mut args = vec![
                    "pr".to_string(),
                    "create".to_string(),
                    "--title".to_string(),
                    title.to_string(),
                    "--base".to_string(),
                    base_branch.to_string(),
                    "--head".to_string(),
                    current_branch,
                    "--body".to_string(),
                    body.unwrap_or("").to_string(),
                ];

                if draft {
                    args.push("--draft".to_string());
                }

                let output = run_cli_command(repo_path, "gh", &args)?;
                let url = extract_review_url(&output).unwrap_or_else(|| output.trim().to_string());
                let number = extract_review_number(&url);

                Ok(PrInfo {
                    number,
                    url,
                    status: "open".to_string(),
                })
            }
            ReviewProvider::GitLab => {
                let mut args = vec![
                    "mr".to_string(),
                    "create".to_string(),
                    "--source-branch".to_string(),
                    current_branch,
                    "--target-branch".to_string(),
                    base_branch.to_string(),
                    "--title".to_string(),
                    title.to_string(),
                    "--description".to_string(),
                    body.unwrap_or("").to_string(),
                    "--yes".to_string(),
                ];

                if draft {
                    args.push("--draft".to_string());
                }

                let output = run_cli_command(repo_path, "glab", &args)?;
                let url = extract_review_url(&output).unwrap_or_else(|| output.trim().to_string());
                let number = extract_review_number(&url);

                Ok(PrInfo {
                    number,
                    url,
                    status: "open".to_string(),
                })
            }
        }
    }

    pub fn get_pr_info(&self, repo_path: &Path, branch: Option<&str>) -> Result<Option<PrInfo>> {
        let provider = match detect_review_provider(repo_path) {
            Ok(provider) => provider,
            Err(_) => return Ok(None),
        };

        match provider {
            ReviewProvider::GitHub => {
                let mut args = vec![
                    "pr".to_string(),
                    "view".to_string(),
                    "--json".to_string(),
                    "number,url,state".to_string(),
                ];

                if let Some(b) = branch {
                    args.push(b.to_string());
                }

                match run_cli_command(repo_path, "gh", &args) {
                    Ok(output) => {
                        let json: Value = serde_json::from_str(&output)?;

                        Ok(Some(PrInfo {
                            number: json["number"].as_i64().unwrap_or(0),
                            url: json["url"].as_str().unwrap_or("").to_string(),
                            status: normalize_review_status(
                                json["state"].as_str().unwrap_or("unknown"),
                            ),
                        }))
                    }
                    Err(_) => Ok(None),
                }
            }
            ReviewProvider::GitLab => {
                let source_branch = branch
                    .map(|value| value.to_string())
                    .unwrap_or(self.get_current_branch(repo_path)?.trim().to_string());
                let args = vec![
                    "mr".to_string(),
                    "list".to_string(),
                    "--source-branch".to_string(),
                    source_branch,
                    "--output".to_string(),
                    "json".to_string(),
                ];

                match run_cli_command(repo_path, "glab", &args) {
                    Ok(output) => {
                        let json: Value = serde_json::from_str(&output)?;
                        let first = json
                            .as_array()
                            .and_then(|items| items.first())
                            .cloned()
                            .unwrap_or(Value::Null);

                        if first.is_null() {
                            return Ok(None);
                        }

                        Ok(Some(PrInfo {
                            number: first["iid"]
                                .as_i64()
                                .or_else(|| first["number"].as_i64())
                                .or_else(|| first["id"].as_i64())
                                .unwrap_or(0),
                            url: first["web_url"]
                                .as_str()
                                .or_else(|| first["url"].as_str())
                                .unwrap_or("")
                                .to_string(),
                            status: normalize_review_status(
                                first["state"].as_str().unwrap_or("unknown"),
                            ),
                        }))
                    }
                    Err(_) => Ok(None),
                }
            }
        }
    }

    pub fn update_pr_description(
        &self,
        repo_path: &Path,
        pr_number: i64,
        body: &str,
    ) -> Result<()> {
        match detect_review_provider(repo_path)? {
            ReviewProvider::GitHub => {
                run_cli_command(
                    repo_path,
                    "gh",
                    &[
                        "pr".to_string(),
                        "edit".to_string(),
                        pr_number.to_string(),
                        "--body".to_string(),
                        body.to_string(),
                    ],
                )?;
                Ok(())
            }
            ReviewProvider::GitLab => {
                run_cli_command(
                    repo_path,
                    "glab",
                    &[
                        "mr".to_string(),
                        "update".to_string(),
                        pr_number.to_string(),
                        "--description".to_string(),
                        body.to_string(),
                        "--yes".to_string(),
                    ],
                )?;
                Ok(())
            }
        }
    }

    pub fn get_remote_review_bundle(
        &self,
        repo_path: &Path,
        branch: Option<&str>,
    ) -> Result<RemoteReviewBundle> {
        match detect_review_provider(repo_path)? {
            ReviewProvider::GitHub => {
                let pr_info = self.get_pr_info(repo_path, branch)?.ok_or_else(|| {
                    GitError::CommandFailed("No open PR found for the current branch.".to_string())
                })?;
                let repo_slug = extract_github_repo_slug(repo_path)?;

                let files_output = run_cli_command(
                    repo_path,
                    "gh",
                    &[
                        "api".to_string(),
                        format!(
                            "repos/{repo_slug}/pulls/{}/files?per_page=100",
                            pr_info.number
                        ),
                    ],
                )?;
                let pr_output = run_cli_command(
                    repo_path,
                    "gh",
                    &[
                        "api".to_string(),
                        format!("repos/{repo_slug}/pulls/{}", pr_info.number),
                    ],
                )?;
                let comments_output = run_cli_command(
                    repo_path,
                    "gh",
                    &[
                        "api".to_string(),
                        format!(
                            "repos/{repo_slug}/pulls/{}/comments?per_page=100",
                            pr_info.number
                        ),
                    ],
                )?;

                let files_json: Value = serde_json::from_str(&files_output)?;
                let pr_json: Value = serde_json::from_str(&pr_output)?;
                let comments_json: Value = serde_json::from_str(&comments_output)?;

                let files = files_json
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|item| RemoteReviewFile {
                        path: item["filename"].as_str().unwrap_or("").to_string(),
                        status: item["status"].as_str().unwrap_or("modified").to_string(),
                        additions: item["additions"].as_i64().unwrap_or(0),
                        deletions: item["deletions"].as_i64().unwrap_or(0),
                        patch: item["patch"].as_str().map(|value| value.to_string()),
                    })
                    .collect();

                let comments = comments_json
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|item| RemoteReviewComment {
                        id: item["id"].as_i64().unwrap_or_default().to_string(),
                        path: item["path"].as_str().unwrap_or("").to_string(),
                        line: item["line"].as_i64(),
                        side: item["side"].as_str().map(|value| value.to_string()),
                        body: item["body"].as_str().unwrap_or("").to_string(),
                        diff_hunk: item["diff_hunk"].as_str().map(|value| value.to_string()),
                        author: item["user"]["login"]
                            .as_str()
                            .map(|value| value.to_string()),
                        created_at: item["created_at"].as_str().map(|value| value.to_string()),
                    })
                    .filter(|comment| !comment.path.is_empty() && !comment.body.trim().is_empty())
                    .collect();

                Ok(RemoteReviewBundle {
                    pr_number: pr_info.number,
                    pr_url: pr_info.url,
                    base_branch: pr_json["base"]["ref"]
                        .as_str()
                        .unwrap_or("main")
                        .to_string(),
                    head_branch: pr_json["head"]["ref"]
                        .as_str()
                        .unwrap_or("HEAD")
                        .to_string(),
                    files,
                    comments,
                })
            }
            ReviewProvider::GitLab => Err(GitError::CommandFailed(
                "Importing remote review comments is currently only implemented for GitHub."
                    .to_string(),
            )),
        }
    }
}

fn ensure_pr_can_be_created(
    repo_path: &Path,
    current_branch: &str,
    base_branch: &str,
) -> Result<()> {
    if current_branch == base_branch {
        return Err(GitError::CommandFailed(format!(
            "Current branch and base branch are both '{}'. Please choose a different target branch.",
            base_branch
        )));
    }

    if !remote_branch_exists(repo_path, base_branch)? {
        return Err(GitError::CommandFailed(format!(
            "Remote base branch 'origin/{}' was not found. Please choose an existing remote branch.",
            base_branch
        )));
    }

    let ahead_count = count_commits_ahead(repo_path, base_branch)?;
    if ahead_count > 0 {
        return Ok(());
    }

    if has_uncommitted_changes(repo_path)? {
        return Err(GitError::CommandFailed(format!(
            "Current branch '{}' has uncommitted changes but no commits ahead of '{}'. Please commit your changes first, then create the PR/MR.",
            current_branch, base_branch
        )));
    }

    Err(GitError::CommandFailed(format!(
        "Current branch '{}' has no commits ahead of '{}'. Create at least one commit before creating a PR/MR.",
        current_branch, base_branch
    )))
}

fn detect_review_provider(repo_path: &Path) -> Result<ReviewProvider> {
    let remote_url = run_git(repo_path, &["remote", "get-url", "origin"])?;
    let normalized = remote_url.to_lowercase();

    if normalized.contains("github") {
        Ok(ReviewProvider::GitHub)
    } else if normalized.contains("gitlab") {
        Ok(ReviewProvider::GitLab)
    } else {
        Err(GitError::CommandFailed(format!(
            "Unsupported remote provider for PR/MR creation: {}",
            remote_url
        )))
    }
}

fn push_current_branch(repo_path: &Path, branch: &str) -> Result<()> {
    run_git(repo_path, &["push", "-u", "origin", branch])?;
    Ok(())
}

fn remote_branch_exists(repo_path: &Path, branch: &str) -> Result<bool> {
    let remote_ref = format!("refs/remotes/origin/{}", branch);
    match run_git(
        repo_path,
        &["rev-parse", "--verify", "--quiet", &remote_ref],
    ) {
        Ok(_) => Ok(true),
        Err(GitError::CommandFailed(_)) => Ok(false),
        Err(err) => Err(err),
    }
}

fn has_uncommitted_changes(repo_path: &Path) -> Result<bool> {
    let status = run_git(repo_path, &["status", "--porcelain"])?;
    Ok(!status.trim().is_empty())
}

fn count_commits_ahead(repo_path: &Path, base_branch: &str) -> Result<u32> {
    let remote_base = format!("origin/{}", base_branch);
    let output = run_git(
        repo_path,
        &["rev-list", "--count", &format!("{remote_base}..HEAD")],
    )?;
    output
        .trim()
        .parse::<u32>()
        .map_err(|err| GitError::CommandFailed(format!("Failed to parse ahead count: {}", err)))
}

fn run_cli_command(repo_path: &Path, program: &str, args: &[String]) -> Result<String> {
    let output = Command::new(program)
        .current_dir(repo_path)
        .args(args)
        .output()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stdout.is_empty() {
            Ok(stderr)
        } else {
            Ok(stdout)
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if stderr.is_empty() { stdout } else { stderr };
        Err(GitError::CommandFailed(message))
    }
}

fn extract_review_url(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(|part| {
            part.trim()
                .trim_matches(|c| c == '"' || c == '\'')
                .to_string()
        })
}

fn extract_review_number(url: &str) -> i64 {
    url.split('/')
        .last()
        .and_then(|segment| segment.parse::<i64>().ok())
        .unwrap_or(0)
}

fn normalize_review_status(status: &str) -> String {
    match status.to_lowercase().as_str() {
        "opened" => "open".to_string(),
        "open" => "open".to_string(),
        "merged" => "merged".to_string(),
        "closed" => "closed".to_string(),
        other => other.to_string(),
    }
}

fn extract_github_repo_slug(repo_path: &Path) -> Result<String> {
    let remote_url = run_git(repo_path, &["remote", "get-url", "origin"])?;
    let trimmed = remote_url.trim();

    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        return Ok(rest.trim_end_matches(".git").to_string());
    }

    if let Some(idx) = trimmed.find("github.com/") {
        return Ok(trimmed[idx + "github.com/".len()..]
            .trim_end_matches(".git")
            .trim_matches('/')
            .to_string());
    }

    Err(GitError::CommandFailed(format!(
        "Failed to parse GitHub repository from remote URL: {}",
        remote_url
    )))
}
