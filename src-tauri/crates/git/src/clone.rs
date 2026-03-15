use crate::Result;
use std::path::Path;

impl crate::GitService {
    pub fn clone_repository(&self, url: &str, target: &Path, _token: Option<&str>) -> Result<()> {
        let output = std::process::Command::new("git")
            .args(["clone", url, &target.to_string_lossy()])
            .output()?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(crate::GitError::CommandFailed(stderr))
        }
    }
}
