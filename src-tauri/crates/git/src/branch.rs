use crate::{GitBranch, Result};
use std::path::Path;

impl crate::GitService {
    pub fn get_all_branches(&self, repo_path: &Path) -> Result<Vec<GitBranch>> {
        let output = crate::cli::run_git(
            repo_path,
            &[
                "branch",
                "-a",
                "--format=%(HEAD)|%(refname:short)|%(objectname:short)|%(subject)",
            ],
        )?;

        let branches = output
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| {
                let parts: Vec<&str> = line.splitn(4, '|').collect();
                let is_current = parts.first().map_or(false, |s| s.trim() == "*");
                let name = parts.get(1).unwrap_or(&"").to_string();
                let is_remote = name.starts_with("origin/");
                let sha = parts.get(2).map(|s| s.to_string());
                let msg = parts.get(3).map(|s| s.to_string());

                GitBranch {
                    name,
                    is_remote,
                    is_current,
                    last_commit_sha: sha,
                    last_commit_message: msg,
                }
            })
            .collect();

        Ok(branches)
    }

    pub fn get_current_branch(&self, repo_path: &Path) -> Result<String> {
        crate::cli::run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])
    }

    pub fn create_branch(&self, repo_path: &Path, name: &str, base: &str) -> Result<()> {
        crate::cli::run_git(repo_path, &["checkout", "-b", name, base])?;
        Ok(())
    }

    pub fn checkout_branch(&self, repo_path: &Path, branch: &str) -> Result<()> {
        crate::cli::run_git(repo_path, &["checkout", branch])?;
        Ok(())
    }
}
