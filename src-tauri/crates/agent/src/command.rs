use std::env;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tokio::process::Command as TokioCommand;

static LOGIN_SHELL_PATH: OnceLock<Option<String>> = OnceLock::new();
static AUGMENTED_PATH: OnceLock<Option<OsString>> = OnceLock::new();

pub fn new_std_command(program: &str) -> std::process::Command {
    let executable = resolve_command_path(program).unwrap_or_else(|| PathBuf::from(program));
    let mut command = std::process::Command::new(executable);
    apply_augmented_path_std_command(&mut command);
    command
}

pub fn new_tokio_command(program: &str) -> TokioCommand {
    let executable = resolve_command_path(program).unwrap_or_else(|| PathBuf::from(program));
    let mut command = TokioCommand::new(executable);
    apply_augmented_path_tokio_command(&mut command);
    command
}

pub fn resolve_command_path(program: &str) -> Option<PathBuf> {
    let program_path = Path::new(program);
    if program_path.components().count() > 1 {
        return program_path.exists().then(|| program_path.to_path_buf());
    }

    #[cfg(unix)]
    if let Some(path) = resolve_command_path_from_login_shell(program) {
        return Some(path);
    }

    which::which(program).ok()
}

pub fn augmented_path() -> Option<OsString> {
    AUGMENTED_PATH.get_or_init(build_augmented_path).clone()
}

pub fn apply_augmented_path_std_command(command: &mut std::process::Command) {
    if let Some(path) = augmented_path() {
        command.env("PATH", path);
    }
}

pub fn apply_augmented_path_tokio_command(command: &mut TokioCommand) {
    if let Some(path) = augmented_path() {
        command.env("PATH", path);
    }
}

fn build_augmented_path() -> Option<OsString> {
    let mut entries = Vec::new();

    if let Some(path) = env::var_os("PATH") {
        push_split_paths(&mut entries, &path);
    }

    if let Some(path) = login_shell_path() {
        push_split_paths(&mut entries, path);
    }

    push_common_cli_dirs(&mut entries);

    if entries.is_empty() {
        None
    } else {
        env::join_paths(entries).ok()
    }
}

fn login_shell_path() -> Option<&'static str> {
    LOGIN_SHELL_PATH
        .get_or_init(detect_login_shell_path)
        .as_deref()
}

fn push_split_paths(entries: &mut Vec<PathBuf>, path: impl AsRef<OsStr>) {
    for entry in env::split_paths(path.as_ref()) {
        push_unique(entries, entry);
    }
}

fn push_common_cli_dirs(entries: &mut Vec<PathBuf>) {
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
        push_unique(entries, PathBuf::from(dir));
    }

    if let Some(home) = dirs::home_dir() {
        for dir in [
            home.join(".cargo/bin"),
            home.join(".local/bin"),
            home.join(".volta/bin"),
            home.join("Library/pnpm"),
            home.join(".pnpm"),
        ] {
            push_unique(entries, dir);
        }
    }
}

fn push_unique(entries: &mut Vec<PathBuf>, path: PathBuf) {
    if path.as_os_str().is_empty() {
        return;
    }

    if !entries.iter().any(|existing| existing == &path) {
        entries.push(path);
    }
}

#[cfg(unix)]
fn detect_login_shell_path() -> Option<String> {
    let shell = env::var("SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string());

    let output = std::process::Command::new(shell)
        .args([
            "-ilc",
            "printf '__VIBE_PATH_START__%s__VIBE_PATH_END__' \"$PATH\"",
        ])
        .env("TERM", "dumb")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let start = stdout.find("__VIBE_PATH_START__")?;
    let end = stdout[start..].find("__VIBE_PATH_END__")? + start;
    let path = &stdout[start + "__VIBE_PATH_START__".len()..end];
    let trimmed = path.trim();

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(not(unix))]
fn detect_login_shell_path() -> Option<String> {
    None
}

#[cfg(unix)]
fn resolve_command_path_from_login_shell(program: &str) -> Option<PathBuf> {
    let shell = env::var("SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string());

    let output = std::process::Command::new(shell)
        .args(["-ilc", "command -v \"$1\"", "--", program])
        .env("TERM", "dumb")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let resolved = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && line.starts_with('/'))?;

    Some(PathBuf::from(resolved))
}
