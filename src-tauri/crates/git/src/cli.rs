use crate::Result;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

pub fn run_git(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()?;

    if output.status.success() {
        // Command succeeded, return stdout (ignore stderr warnings)
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        // Command failed, return stderr as error
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(crate::GitError::CommandFailed(stderr))
    }
}

pub fn run_git_raw(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(crate::GitError::CommandFailed(stderr))
    }
}

pub fn run_git_with_input(repo_path: &Path, args: &[&str], input: &str) -> Result<String> {
    let mut child = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(input.as_bytes())?;
    }

    let output = child.wait_with_output()?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(crate::GitError::CommandFailed(stderr))
    }
}

pub fn run_git_allow_exit_codes(
    repo_path: &Path,
    args: &[&str],
    allowed_exit_codes: &[i32],
) -> Result<String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()?;

    let code = output.status.code().unwrap_or_default();
    if output.status.success() || allowed_exit_codes.contains(&code) {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(crate::GitError::CommandFailed(stderr))
    }
}

pub fn run_git_raw_allow_exit_codes(
    repo_path: &Path,
    args: &[&str],
    allowed_exit_codes: &[i32],
) -> Result<String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()?;

    let code = output.status.code().unwrap_or_default();
    if output.status.success() || allowed_exit_codes.contains(&code) {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(crate::GitError::CommandFailed(stderr))
    }
}
