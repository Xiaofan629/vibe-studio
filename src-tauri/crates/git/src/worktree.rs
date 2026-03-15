use crate::Result;
use std::path::Path;

impl crate::GitService {
    pub fn add_worktree(&self, repo_path: &Path, worktree_path: &Path, branch: &str) -> Result<()> {
        crate::cli::run_git(
            repo_path,
            &["worktree", "add", &worktree_path.to_string_lossy(), branch],
        )?;
        Ok(())
    }

    pub fn remove_worktree(&self, repo_path: &Path, worktree_path: &Path) -> Result<()> {
        crate::cli::run_git(
            repo_path,
            &[
                "worktree",
                "remove",
                &worktree_path.to_string_lossy(),
                "--force",
            ],
        )?;
        Ok(())
    }

    pub fn list_worktrees(&self, repo_path: &Path) -> Result<Vec<String>> {
        let output = crate::cli::run_git(repo_path, &["worktree", "list", "--porcelain"])?;
        let worktrees = output
            .lines()
            .filter(|line| line.starts_with("worktree "))
            .map(|line| line[9..].to_string())
            .collect();
        Ok(worktrees)
    }
}
