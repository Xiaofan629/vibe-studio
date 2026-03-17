use crate::{DiffFile, DiffHunk, DiffLine, Result};
use std::path::Path;

impl crate::GitService {
    pub fn get_worktree_diffs(
        &self,
        repo_path: &Path,
        base: Option<&str>,
    ) -> Result<Vec<DiffFile>> {
        if base.is_none() {
            return self.get_full_diff(repo_path, None);
        }

        let base_ref = base.unwrap_or("HEAD");
        let output = crate::cli::run_git(repo_path, &["diff", "--numstat", base_ref])?;

        let files: Vec<DiffFile> = output
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| {
                let parts: Vec<&str> = line.split('\t').collect();
                let additions = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
                let deletions = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
                let path = parts.get(2).unwrap_or(&"").to_string();

                DiffFile {
                    old_path: Some(path.clone()),
                    new_path: Some(path),
                    change_kind: "modified".to_string(),
                    additions,
                    deletions,
                    hunks: vec![],
                    is_binary: false,
                    content_omitted: false,
                }
            })
            .collect();

        Ok(files)
    }

    pub fn get_full_diff(&self, repo_path: &Path, base: Option<&str>) -> Result<Vec<DiffFile>> {
        if base.is_some() {
            let output = crate::cli::run_git_raw(repo_path, &["diff", base.unwrap(), "-U3"])?;
            return Ok(parse_unified_diff(&output));
        }

        let mut all_files = parse_unified_diff(
            &crate::cli::run_git_raw(repo_path, &["diff", "HEAD", "-U3"]).unwrap_or_default(),
        );
        all_files.extend(get_untracked_diffs(repo_path)?);
        Ok(all_files)
    }

    pub fn get_full_diff_between(
        &self,
        repo_path: &Path,
        from_revision: &str,
        to_revision: &str,
    ) -> Result<Vec<DiffFile>> {
        let output =
            crate::cli::run_git_raw(repo_path, &["diff", from_revision, to_revision, "-U3"])?;
        Ok(parse_unified_diff(&output))
    }

    /// Return the raw unified diff text (for @pierre/diffs frontend rendering)
    pub fn get_raw_diff(&self, repo_path: &Path, base: Option<&str>) -> Result<String> {
        if base.is_some() {
            return crate::cli::run_git_raw(repo_path, &["diff", base.unwrap(), "-U3"]);
        }

        let mut raw_diff =
            crate::cli::run_git_raw(repo_path, &["diff", "HEAD", "-U3"]).unwrap_or_default();

        for file_path in list_untracked_files(repo_path)? {
            let patch = build_untracked_file_patch(repo_path, &file_path)?;
            if patch.is_empty() {
                continue;
            }
            if !raw_diff.is_empty() && !raw_diff.ends_with('\n') {
                raw_diff.push('\n');
            }
            raw_diff.push_str(&patch);
            if !raw_diff.ends_with('\n') {
                raw_diff.push('\n');
            }
        }

        Ok(raw_diff)
    }

    pub fn get_raw_diff_between(
        &self,
        repo_path: &Path,
        from_revision: &str,
        to_revision: &str,
    ) -> Result<String> {
        crate::cli::run_git_raw(repo_path, &["diff", from_revision, to_revision, "-U3"])
    }
}

fn list_untracked_files(repo_path: &Path) -> Result<Vec<String>> {
    let output = crate::cli::run_git(repo_path, &["ls-files", "--others", "--exclude-standard"])?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn build_untracked_file_patch(repo_path: &Path, file_path: &str) -> Result<String> {
    crate::cli::run_git_raw_allow_exit_codes(
        repo_path,
        &["diff", "--no-index", "--", "/dev/null", file_path],
        &[1],
    )
}

fn get_untracked_diffs(repo_path: &Path) -> Result<Vec<DiffFile>> {
    let mut files = Vec::new();
    for file_path in list_untracked_files(repo_path)? {
        let patch = build_untracked_file_patch(repo_path, &file_path)?;
        files.extend(parse_unified_diff(&patch));
    }
    Ok(files)
}

fn parse_unified_diff(raw: &str) -> Vec<DiffFile> {
    let mut files = Vec::new();
    let mut current_file: Option<DiffFile> = None;
    let mut current_hunk: Option<DiffHunk> = None;
    let mut old_line = 0u32;
    let mut new_line = 0u32;

    for line in raw.lines() {
        if line.starts_with("diff --git") {
            if let Some(mut file) = current_file.take() {
                if let Some(hunk) = current_hunk.take() {
                    file.hunks.push(hunk);
                }
                files.push(file);
            }
            // Extract paths from "diff --git a/path b/path" as initial values
            // These serve as fallback if --- a/ and +++ b/ lines are missing
            // (e.g., new files have "--- /dev/null" which doesn't match "--- a/")
            let (old_p, new_p) = parse_diff_git_header(line);
            current_file = Some(DiffFile {
                old_path: old_p,
                new_path: new_p,
                change_kind: "modified".to_string(),
                additions: 0,
                deletions: 0,
                hunks: vec![],
                is_binary: false,
                content_omitted: false,
            });
        } else if line.starts_with("rename from ") {
            if let Some(ref mut file) = current_file {
                file.old_path = Some(parse_path_after_prefix(line, "rename from "));
                file.change_kind = "renamed".to_string();
            }
        } else if line.starts_with("rename to ") {
            if let Some(ref mut file) = current_file {
                file.new_path = Some(parse_path_after_prefix(line, "rename to "));
                file.change_kind = "renamed".to_string();
            }
        } else if line.starts_with("new file mode ") {
            if let Some(ref mut file) = current_file {
                file.change_kind = "added".to_string();
            }
        } else if line.starts_with("deleted file mode ") {
            if let Some(ref mut file) = current_file {
                file.change_kind = "deleted".to_string();
            }
        } else if line.starts_with("--- ") {
            if let Some(ref mut file) = current_file {
                match parse_patch_path_line(line, "--- ") {
                    Some(Some(path)) => file.old_path = Some(path),
                    Some(None) => {
                        file.old_path = None;
                        file.change_kind = "added".to_string();
                    }
                    None => {}
                }
            }
        } else if line.starts_with("+++ ") {
            if let Some(ref mut file) = current_file {
                match parse_patch_path_line(line, "+++ ") {
                    Some(Some(path)) => file.new_path = Some(path),
                    Some(None) => {
                        file.new_path = None;
                        file.change_kind = "deleted".to_string();
                    }
                    None => {}
                }
            }
        } else if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            if let Some(ref mut file) = current_file {
                file.is_binary = true;
                file.content_omitted = true;
            }
        } else if line.starts_with("@@") {
            if let Some(ref mut file) = current_file {
                if let Some(hunk) = current_hunk.take() {
                    file.hunks.push(hunk);
                }
            }
            let (os, ol, ns, nl) = parse_hunk_header(line);
            old_line = os;
            new_line = ns;
            current_hunk = Some(DiffHunk {
                old_start: os,
                old_lines: ol,
                new_start: ns,
                new_lines: nl,
                header: line.to_string(),
                lines: vec![],
            });
        } else if line.starts_with('\\') {
            continue;
        } else if let Some(ref mut hunk) = current_hunk {
            let (kind, old_ln, new_ln) = if line.starts_with('+') {
                let ln = new_line;
                new_line += 1;
                if let Some(ref mut file) = current_file {
                    file.additions += 1;
                }
                ("addition", None, Some(ln))
            } else if line.starts_with('-') {
                let ln = old_line;
                old_line += 1;
                if let Some(ref mut file) = current_file {
                    file.deletions += 1;
                }
                ("deletion", Some(ln), None)
            } else {
                let oln = old_line;
                let nln = new_line;
                old_line += 1;
                new_line += 1;
                ("context", Some(oln), Some(nln))
            };

            hunk.lines.push(DiffLine {
                content: if line.is_empty() {
                    String::new()
                } else {
                    line[1..].to_string()
                },
                kind: kind.to_string(),
                old_line_number: old_ln,
                new_line_number: new_ln,
            });
        }
    }

    if let Some(mut file) = current_file {
        if let Some(hunk) = current_hunk {
            file.hunks.push(hunk);
        }
        files.push(file);
    }

    files
}

fn parse_hunk_header(header: &str) -> (u32, u32, u32, u32) {
    let parts: Vec<&str> = header.split_whitespace().collect();
    let old = parts.get(1).unwrap_or(&"-0,0");
    let new = parts.get(2).unwrap_or(&"+0,0");

    let (os, ol) = parse_range(&old[1..]);
    let (ns, nl) = parse_range(&new[1..]);
    (os, ol, ns, nl)
}

fn parse_range(s: &str) -> (u32, u32) {
    if let Some((start, count)) = s.split_once(',') {
        (start.parse().unwrap_or(0), count.parse().unwrap_or(0))
    } else {
        (s.parse().unwrap_or(0), 1)
    }
}

/// Parse "diff --git a/path b/path" to extract (old_path, new_path).
/// Returns (Some(path), Some(path)) for the common case.
fn parse_diff_git_header(line: &str) -> (Option<String>, Option<String>) {
    // Format: "diff --git a/<old_path> b/<new_path>"
    let stripped = line.strip_prefix("diff --git ").unwrap_or("");
    let tokens = split_git_header_tokens(stripped);
    match (tokens.first(), tokens.get(1)) {
        (Some(old), Some(new)) => (
            Some(strip_diff_prefix(old, 'a')),
            Some(strip_diff_prefix(new, 'b')),
        ),
        _ => (None, None),
    }
}

fn split_git_header_tokens(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escaping = false;

    for ch in input.chars() {
        if escaping {
            current.push(ch);
            escaping = false;
            continue;
        }

        match ch {
            '\\' if in_quotes => escaping = true,
            '"' => in_quotes = !in_quotes,
            ' ' if !in_quotes => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn strip_diff_prefix(path: &str, prefix: char) -> String {
    let expected = format!("{}/", prefix);
    let normalized = unquote_git_path(path);
    normalized
        .strip_prefix(&expected)
        .unwrap_or(&normalized)
        .to_string()
}

fn parse_patch_path_line(line: &str, prefix: &str) -> Option<Option<String>> {
    let path = line.strip_prefix(prefix)?.trim();
    if path == "/dev/null" {
        return Some(None);
    }

    let normalized = unquote_git_path(path);
    let normalized = normalized
        .strip_prefix("a/")
        .or_else(|| normalized.strip_prefix("b/"))
        .unwrap_or(&normalized)
        .to_string();
    Some(Some(normalized))
}

fn parse_path_after_prefix(line: &str, prefix: &str) -> String {
    let path = line.strip_prefix(prefix).unwrap_or("").trim();
    unquote_git_path(path)
}

fn unquote_git_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
        trimmed[1..trimmed.len() - 1]
            .replace(r#"\\"#, r#"\"#)
            .replace(r#"\""#, r#""#)
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::parse_unified_diff;
    use crate::GitService;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_repo() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock drift")
            .as_nanos();
        std::env::temp_dir().join(format!("vibe-studio-git-test-{nanos}"))
    }

    #[test]
    fn parses_quoted_paths_with_spaces() {
        let raw = concat!(
            "diff --git \"a/src/hello world.ts\" \"b/src/hello world.ts\"\n",
            "index 1234567..89abcde 100644\n",
            "--- \"a/src/hello world.ts\"\n",
            "+++ \"b/src/hello world.ts\"\n",
            "@@ -1 +1,2 @@\n",
            " console.log('old')\n",
            "+console.log('new')\n",
        );

        let files = parse_unified_diff(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].old_path.as_deref(), Some("src/hello world.ts"));
        assert_eq!(files[0].new_path.as_deref(), Some("src/hello world.ts"));
    }

    #[test]
    fn parses_renamed_files() {
        let raw = concat!(
            "diff --git a/src/old.ts b/src/new.ts\n",
            "similarity index 100%\n",
            "rename from src/old.ts\n",
            "rename to src/new.ts\n",
        );

        let files = parse_unified_diff(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].change_kind, "renamed");
        assert_eq!(files[0].old_path.as_deref(), Some("src/old.ts"));
        assert_eq!(files[0].new_path.as_deref(), Some("src/new.ts"));
    }

    #[test]
    fn includes_untracked_files_in_working_tree_diff() {
        let repo_dir = unique_temp_repo();
        fs::create_dir_all(&repo_dir).expect("create temp repo");

        crate::cli::run_git(&repo_dir, &["init"]).expect("git init");
        crate::cli::run_git(&repo_dir, &["config", "user.name", "Vibe Studio Test"])
            .expect("set user.name");
        crate::cli::run_git(&repo_dir, &["config", "user.email", "test@example.com"])
            .expect("set user.email");

        fs::write(repo_dir.join("README.md"), "hello\n").expect("write tracked file");
        crate::cli::run_git(&repo_dir, &["add", "README.md"]).expect("git add tracked file");
        crate::cli::run_git(&repo_dir, &["commit", "-m", "init"]).expect("git commit");

        fs::create_dir_all(repo_dir.join("pkg/basic/util")).expect("create nested dir");
        fs::write(
            repo_dir.join("pkg/basic/util/log.go"),
            "package util\n\nfunc Hello() string {\n\treturn \"hi\"\n}\n",
        )
        .expect("write untracked file");

        let git = GitService::new();
        let files = git
            .get_full_diff(&repo_dir, None)
            .expect("get full diff with untracked file");

        let file = files
            .iter()
            .find(|file| file.new_path.as_deref() == Some("pkg/basic/util/log.go"))
            .expect("untracked file should be present in full diff");

        assert_eq!(file.change_kind, "added");
        assert!(
            !file.content_omitted,
            "untracked file should not be omitted"
        );
        assert!(
            !file.hunks.is_empty(),
            "untracked file should include hunks"
        );
        assert!(
            file.additions > 0,
            "untracked file should include additions"
        );

        let summary = git
            .get_worktree_diffs(&repo_dir, None)
            .expect("get worktree diff summary");
        assert!(summary.iter().any(|file| {
            file.new_path.as_deref() == Some("pkg/basic/util/log.go")
                && file.additions > 0
                && !file.hunks.is_empty()
        }));

        let raw = git
            .get_raw_diff(&repo_dir, None)
            .expect("get raw diff with untracked file");
        assert!(raw.contains("pkg/basic/util/log.go"));
        assert!(raw.contains("@@ -0,0 +1"));

        fs::remove_dir_all(repo_dir).expect("remove temp repo");
    }
}
