use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashCommand {
    pub id: String,
    pub name: String,
    pub full_command: String,
    pub scope: String,
    pub namespace: Option<String>,
    pub file_path: String,
    pub content: String,
    pub description: Option<String>,
    pub allowed_tools: Vec<String>,
    pub has_bash_commands: bool,
    pub has_file_references: bool,
    pub accepts_arguments: bool,
}

#[derive(Debug, Deserialize)]
struct CommandFrontmatter {
    #[serde(rename = "allowed-tools")]
    allowed_tools: Option<Vec<String>>,
    description: Option<String>,
}

fn parse_markdown_with_frontmatter(
    content: &str,
) -> std::result::Result<(Option<CommandFrontmatter>, String), String> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() || lines[0] != "---" {
        return Ok((None, content.to_string()));
    }

    let mut frontmatter_end = None;
    for (index, line) in lines.iter().enumerate().skip(1) {
        if *line == "---" {
            frontmatter_end = Some(index);
            break;
        }
    }

    if let Some(end) = frontmatter_end {
        let frontmatter_content = lines[1..end].join("\n");
        let body_content = lines[(end + 1)..].join("\n");

        match serde_yaml::from_str::<CommandFrontmatter>(&frontmatter_content) {
            Ok(frontmatter) => Ok((Some(frontmatter), body_content)),
            Err(_) => Ok((None, content.to_string())),
        }
    } else {
        Ok((None, content.to_string()))
    }
}

fn extract_command_info(
    file_path: &Path,
    base_path: &Path,
) -> std::result::Result<(String, Option<String>), String> {
    let relative_path = file_path
        .strip_prefix(base_path)
        .map_err(|e| e.to_string())?;
    let path_without_ext = relative_path
        .with_extension("")
        .to_string_lossy()
        .to_string();
    let components: Vec<&str> = path_without_ext.split('/').collect();

    if components.is_empty() {
        return Err("Invalid command path".to_string());
    }

    if components.len() == 1 {
        Ok((components[0].to_string(), None))
    } else {
        Ok((
            components.last().unwrap_or(&"").to_string(),
            Some(components[..components.len() - 1].join(":")),
        ))
    }
}

fn load_command_from_file(
    file_path: &Path,
    base_path: &Path,
    scope: &str,
) -> std::result::Result<SlashCommand, String> {
    let content = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let (frontmatter, body) = parse_markdown_with_frontmatter(&content)?;
    let (name, namespace) = extract_command_info(file_path, base_path)?;
    let full_command = match &namespace {
        Some(ns) => format!("/{ns}:{name}"),
        None => format!("/{name}"),
    };

    let (description, allowed_tools) = if let Some(frontmatter) = frontmatter {
        (
            frontmatter.description,
            frontmatter.allowed_tools.unwrap_or_default(),
        )
    } else {
        (None, Vec::new())
    };

    Ok(SlashCommand {
        id: format!(
            "{}-{}",
            scope,
            file_path.to_string_lossy().replace('/', "-")
        ),
        name,
        full_command,
        scope: scope.to_string(),
        namespace,
        file_path: file_path.to_string_lossy().to_string(),
        content: body.clone(),
        description,
        allowed_tools,
        has_bash_commands: body.contains("!`"),
        has_file_references: body.contains('@'),
        accepts_arguments: body.contains("$ARGUMENTS"),
    })
}

fn find_markdown_files(dir: &Path, files: &mut Vec<PathBuf>) -> std::result::Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') {
                continue;
            }
        }

        if path.is_dir() {
            find_markdown_files(&path, files)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
            files.push(path);
        }
    }

    Ok(())
}

fn create_default_commands() -> Vec<SlashCommand> {
    vec![
        SlashCommand {
            id: "default-add-dir".to_string(),
            name: "add-dir".to_string(),
            full_command: "/add-dir".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Add additional working directories".to_string(),
            description: Some("Add additional working directories".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: false,
        },
        SlashCommand {
            id: "default-plan".to_string(),
            name: "plan".to_string(),
            full_command: "/plan".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Switch Claude Code into plan-first mode for the next task.".to_string(),
            description: Some("Plan first before taking action".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: false,
        },
        SlashCommand {
            id: "default-init".to_string(),
            name: "init".to_string(),
            full_command: "/init".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Initialize project with CLAUDE.md guide".to_string(),
            description: Some("Initialize project with CLAUDE.md guide".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: false,
        },
        SlashCommand {
            id: "default-review".to_string(),
            name: "review".to_string(),
            full_command: "/review".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Request code review".to_string(),
            description: Some("Request code review".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: false,
        },
        SlashCommand {
            id: "default-clear".to_string(),
            name: "clear".to_string(),
            full_command: "/clear".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Clear the current conversation output.".to_string(),
            description: Some("Clear the current conversation".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: false,
        },
        SlashCommand {
            id: "default-compact".to_string(),
            name: "compact".to_string(),
            full_command: "/compact".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Compact the conversation context and continue.".to_string(),
            description: Some("Compact conversation context".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: false,
        },
        SlashCommand {
            id: "default-memory".to_string(),
            name: "memory".to_string(),
            full_command: "/memory".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Inspect or update Claude memory.".to_string(),
            description: Some("Inspect or update memory".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: true,
        },
        SlashCommand {
            id: "default-status".to_string(),
            name: "status".to_string(),
            full_command: "/status".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Show the current session status, model, and context usage.".to_string(),
            description: Some("Show current session status".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: false,
        },
        SlashCommand {
            id: "default-cost".to_string(),
            name: "cost".to_string(),
            full_command: "/cost".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Show token and spend breakdown for the session.".to_string(),
            description: Some("Show session cost details".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: false,
        },
        SlashCommand {
            id: "default-doctor".to_string(),
            name: "doctor".to_string(),
            full_command: "/doctor".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Run Claude Code health checks.".to_string(),
            description: Some("Run Claude Code health checks".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: false,
        },
    ]
}

#[tauri::command]
pub async fn slash_commands_list(
    project_path: Option<String>,
    agent_type: Option<String>,
) -> std::result::Result<Vec<SlashCommand>, String> {
    let agent = agent_type.as_deref().unwrap_or("claude_code");
    let config_dir = match agent {
        "codex" => ".codex",
        "gemini" => ".gemini",
        _ => ".claude",
    };

    let mut commands = create_default_commands_for_agent(agent);

    if let Some(project_path) = project_path {
        let project_commands_dir = PathBuf::from(project_path)
            .join(config_dir)
            .join("commands");
        let mut files = Vec::new();
        find_markdown_files(&project_commands_dir, &mut files)?;
        for file in files {
            if let Ok(command) = load_command_from_file(&file, &project_commands_dir, "project") {
                commands.push(command);
            }
        }
    }

    if let Some(home_dir) = dirs::home_dir() {
        let user_commands_dir = home_dir.join(config_dir).join("commands");
        let mut files = Vec::new();
        find_markdown_files(&user_commands_dir, &mut files)?;
        for file in files {
            if let Ok(command) = load_command_from_file(&file, &user_commands_dir, "user") {
                commands.push(command);
            }
        }
    }

    commands.sort_by(|a, b| a.full_command.cmp(&b.full_command));
    Ok(commands)
}

fn create_default_commands_for_agent(agent: &str) -> Vec<SlashCommand> {
    match agent {
        "codex" => vec![
            SlashCommand {
                id: "codex-add-dir".to_string(),
                name: "add-dir".to_string(),
                full_command: "/add-dir".to_string(),
                scope: "default".to_string(),
                namespace: None,
                file_path: String::new(),
                content: "Add additional working directories".to_string(),
                description: Some("Add additional working directories".to_string()),
                allowed_tools: vec![],
                has_bash_commands: false,
                has_file_references: false,
                accepts_arguments: false,
            },
            SlashCommand {
                id: "codex-model".to_string(),
                name: "model".to_string(),
                full_command: "/model".to_string(),
                scope: "default".to_string(),
                namespace: None,
                file_path: String::new(),
                content: "Switch the current Codex session model.".to_string(),
                description: Some("Switch Codex model".to_string()),
                allowed_tools: vec![],
                has_bash_commands: false,
                has_file_references: false,
                accepts_arguments: true,
            },
            SlashCommand {
                id: "codex-approval".to_string(),
                name: "approval".to_string(),
                full_command: "/approval".to_string(),
                scope: "default".to_string(),
                namespace: None,
                file_path: String::new(),
                content: "Update Codex approval policy for the current session.".to_string(),
                description: Some("Change approval policy".to_string()),
                allowed_tools: vec![],
                has_bash_commands: false,
                has_file_references: false,
                accepts_arguments: true,
            },
            SlashCommand {
                id: "codex-sandbox".to_string(),
                name: "sandbox".to_string(),
                full_command: "/sandbox".to_string(),
                scope: "default".to_string(),
                namespace: None,
                file_path: String::new(),
                content: "Adjust Codex sandbox mode for the current session.".to_string(),
                description: Some("Change sandbox mode".to_string()),
                allowed_tools: vec![],
                has_bash_commands: false,
                has_file_references: false,
                accepts_arguments: true,
            },
            SlashCommand {
                id: "codex-search".to_string(),
                name: "search".to_string(),
                full_command: "/search".to_string(),
                scope: "default".to_string(),
                namespace: None,
                file_path: String::new(),
                content: "Toggle Codex live web search availability.".to_string(),
                description: Some("Toggle live web search".to_string()),
                allowed_tools: vec![],
                has_bash_commands: false,
                has_file_references: false,
                accepts_arguments: false,
            },
            SlashCommand {
                id: "codex-clear".to_string(),
                name: "clear".to_string(),
                full_command: "/clear".to_string(),
                scope: "default".to_string(),
                namespace: None,
                file_path: String::new(),
                content: "Clear the current conversation output.".to_string(),
                description: Some("Clear the current conversation".to_string()),
                allowed_tools: vec![],
                has_bash_commands: false,
                has_file_references: false,
                accepts_arguments: false,
            },
            SlashCommand {
                id: "codex-compact".to_string(),
                name: "compact".to_string(),
                full_command: "/compact".to_string(),
                scope: "default".to_string(),
                namespace: None,
                file_path: String::new(),
                content: "Compact the conversation context and continue.".to_string(),
                description: Some("Compact conversation context".to_string()),
                allowed_tools: vec![],
                has_bash_commands: false,
                has_file_references: false,
                accepts_arguments: false,
            },
            SlashCommand {
                id: "codex-status".to_string(),
                name: "status".to_string(),
                full_command: "/status".to_string(),
                scope: "default".to_string(),
                namespace: None,
                file_path: String::new(),
                content: "Show the current Codex session status, model, and context usage."
                    .to_string(),
                description: Some("Show current session status".to_string()),
                allowed_tools: vec![],
                has_bash_commands: false,
                has_file_references: false,
                accepts_arguments: false,
            },
        ],
        "gemini" => vec![SlashCommand {
            id: "gemini-clear".to_string(),
            name: "clear".to_string(),
            full_command: "/clear".to_string(),
            scope: "default".to_string(),
            namespace: None,
            file_path: String::new(),
            content: "Clear the current conversation output.".to_string(),
            description: Some("Clear the current conversation".to_string()),
            allowed_tools: vec![],
            has_bash_commands: false,
            has_file_references: false,
            accepts_arguments: false,
        }],
        _ => create_default_commands(),
    }
}
