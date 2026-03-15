use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(M20260101000001Init),
            Box::new(M20260313000002Workspace),
            Box::new(M20260313000003WorkspaceAddSessionFields),
            Box::new(M20260315000004WorkspaceRepoBaseBranch),
        ]
    }
}

pub struct M20260101000001Init;

impl MigrationName for M20260101000001Init {
    fn name(&self) -> &str {
        "m20260101_000001_init"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260101000001Init {
    async fn up(&self, manager: &SchemaManager) -> std::result::Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Project::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Project::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Project::Name).string().not_null())
                    .col(
                        ColumnDef::new(Project::Path)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(Project::RemoteUrl).string())
                    .col(ColumnDef::new(Project::RemoteType).string())
                    .col(
                        ColumnDef::new(Project::DefaultBranch)
                            .string()
                            .not_null()
                            .default("main"),
                    )
                    .col(ColumnDef::new(Project::DefaultAgent).string())
                    .col(ColumnDef::new(Project::LastOpenedAt).string().not_null())
                    .col(ColumnDef::new(Project::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Project::UpdatedAt).string().not_null())
                    .col(ColumnDef::new(Project::DeletedAt).string())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Session::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Session::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Session::ProjectId).string().not_null())
                    .col(ColumnDef::new(Session::Branch).string().not_null())
                    .col(ColumnDef::new(Session::WorktreePath).string())
                    .col(ColumnDef::new(Session::AgentType).string().not_null())
                    .col(ColumnDef::new(Session::Title).string())
                    .col(
                        ColumnDef::new(Session::Status)
                            .string()
                            .not_null()
                            .default("idle"),
                    )
                    .col(ColumnDef::new(Session::BaseCommit).string())
                    .col(ColumnDef::new(Session::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Session::UpdatedAt).string().not_null())
                    .col(ColumnDef::new(Session::DeletedAt).string())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(AgentProcess::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentProcess::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AgentProcess::SessionId).string().not_null())
                    .col(ColumnDef::new(AgentProcess::ParentId).string())
                    .col(ColumnDef::new(AgentProcess::AgentType).string().not_null())
                    .col(ColumnDef::new(AgentProcess::ProcessPid).integer())
                    .col(
                        ColumnDef::new(AgentProcess::Status)
                            .string()
                            .not_null()
                            .default("running"),
                    )
                    .col(ColumnDef::new(AgentProcess::ExitCode).integer())
                    .col(ColumnDef::new(AgentProcess::Prompt).text())
                    .col(
                        ColumnDef::new(AgentProcess::Depth)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(AgentProcess::StartedAt).string().not_null())
                    .col(ColumnDef::new(AgentProcess::CompletedAt).string())
                    .col(ColumnDef::new(AgentProcess::CreatedAt).string().not_null())
                    .col(ColumnDef::new(AgentProcess::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(ReviewComment::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ReviewComment::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ReviewComment::SessionId).string().not_null())
                    .col(ColumnDef::new(ReviewComment::FilePath).string().not_null())
                    .col(
                        ColumnDef::new(ReviewComment::LineNumber)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ReviewComment::Side)
                            .string()
                            .not_null()
                            .default("new"),
                    )
                    .col(ColumnDef::new(ReviewComment::Content).text().not_null())
                    .col(ColumnDef::new(ReviewComment::CodeLine).text())
                    .col(
                        ColumnDef::new(ReviewComment::IsResolved)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(ReviewComment::SentToAgent)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(ReviewComment::CreatedAt).string().not_null())
                    .col(ColumnDef::new(ReviewComment::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(CommitHistory::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(CommitHistory::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(CommitHistory::SessionId).string().not_null())
                    .col(ColumnDef::new(CommitHistory::CommitSha).string().not_null())
                    .col(
                        ColumnDef::new(CommitHistory::CommitMessage)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(CommitHistory::Branch).string().not_null())
                    .col(
                        ColumnDef::new(CommitHistory::FilesChanged)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(CommitHistory::Additions)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(CommitHistory::Deletions)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(CommitHistory::PrUrl).string())
                    .col(ColumnDef::new(CommitHistory::PrNumber).integer())
                    .col(ColumnDef::new(CommitHistory::CreatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> std::result::Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(CommitHistory::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(ReviewComment::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AgentProcess::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Session::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Project::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
pub enum Project {
    Table,
    Id,
    Name,
    Path,
    RemoteUrl,
    RemoteType,
    DefaultBranch,
    DefaultAgent,
    LastOpenedAt,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(Iden)]
pub enum Session {
    Table,
    Id,
    ProjectId,
    Branch,
    WorktreePath,
    AgentType,
    Title,
    Status,
    BaseCommit,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(Iden)]
pub enum AgentProcess {
    Table,
    Id,
    SessionId,
    ParentId,
    AgentType,
    ProcessPid,
    Status,
    ExitCode,
    Prompt,
    Depth,
    StartedAt,
    CompletedAt,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
pub enum ReviewComment {
    Table,
    Id,
    SessionId,
    FilePath,
    LineNumber,
    Side,
    Content,
    CodeLine,
    IsResolved,
    SentToAgent,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
pub enum CommitHistory {
    Table,
    Id,
    SessionId,
    CommitSha,
    CommitMessage,
    Branch,
    FilesChanged,
    Additions,
    Deletions,
    PrUrl,
    PrNumber,
    CreatedAt,
}

// ---- Workspace migration ----

pub struct M20260313000002Workspace;

impl MigrationName for M20260313000002Workspace {
    fn name(&self) -> &str {
        "m20260313_000002_workspace"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260313000002Workspace {
    async fn up(&self, manager: &SchemaManager) -> std::result::Result<(), DbErr> {
        // Create workspace table
        manager
            .create_table(
                Table::create()
                    .table(Workspace::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Workspace::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Workspace::Title).string())
                    .col(
                        ColumnDef::new(Workspace::Status)
                            .string()
                            .not_null()
                            .default("idle"),
                    )
                    .col(ColumnDef::new(Workspace::AgentType).string().not_null())
                    .col(ColumnDef::new(Workspace::InitialPrompt).text())
                    .col(ColumnDef::new(Workspace::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Workspace::UpdatedAt).string().not_null())
                    .col(ColumnDef::new(Workspace::DeletedAt).string())
                    .to_owned(),
            )
            .await?;

        // Create workspace_repo table
        manager
            .create_table(
                Table::create()
                    .table(WorkspaceRepo::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(WorkspaceRepo::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(WorkspaceRepo::WorkspaceId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(WorkspaceRepo::ProjectId).string().not_null())
                    .col(ColumnDef::new(WorkspaceRepo::Path).string().not_null())
                    .col(ColumnDef::new(WorkspaceRepo::Branch).string().not_null())
                    .col(ColumnDef::new(WorkspaceRepo::WorktreePath).string())
                    .col(ColumnDef::new(WorkspaceRepo::BaseCommit).string())
                    .col(ColumnDef::new(WorkspaceRepo::CreatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        // Add workspace_id column to session table
        manager
            .alter_table(
                sea_orm_migration::prelude::Table::alter()
                    .table(Session::Table)
                    .add_column(ColumnDef::new(SessionWorkspaceId::WorkspaceId).string())
                    .to_owned(),
            )
            .await?;

        // Indexes
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_workspace_repo_workspace_id")
                    .table(WorkspaceRepo::Table)
                    .col(WorkspaceRepo::WorkspaceId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> std::result::Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(WorkspaceRepo::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Workspace::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
pub enum Workspace {
    Table,
    Id,
    Title,
    Status,
    AgentType,
    InitialPrompt,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(Iden)]
pub enum WorkspaceRepo {
    Table,
    Id,
    WorkspaceId,
    ProjectId,
    Path,
    Branch,
    BaseBranch,
    WorktreePath,
    BaseCommit,
    CreatedAt,
}

#[derive(Iden)]
pub enum SessionWorkspaceId {
    WorkspaceId,
}

// ---- Add session fields to workspace ----

pub struct M20260313000003WorkspaceAddSessionFields;

impl MigrationName for M20260313000003WorkspaceAddSessionFields {
    fn name(&self) -> &str {
        "m20260313_000003_workspace_add_session_fields"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260313000003WorkspaceAddSessionFields {
    async fn up(&self, manager: &SchemaManager) -> std::result::Result<(), DbErr> {
        manager
            .alter_table(
                sea_orm_migration::prelude::Table::alter()
                    .table(Workspace::Table)
                    .add_column(
                        ColumnDef::new(WorkspaceSessionFields::ProjectId)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                sea_orm_migration::prelude::Table::alter()
                    .table(Workspace::Table)
                    .add_column(
                        ColumnDef::new(WorkspaceSessionFields::Branch)
                            .string()
                            .not_null()
                            .default("main"),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                sea_orm_migration::prelude::Table::alter()
                    .table(Workspace::Table)
                    .add_column(ColumnDef::new(WorkspaceSessionFields::WorktreePath).string())
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                sea_orm_migration::prelude::Table::alter()
                    .table(Workspace::Table)
                    .add_column(ColumnDef::new(WorkspaceSessionFields::BaseCommit).string())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> std::result::Result<(), DbErr> {
        manager
            .alter_table(
                sea_orm_migration::prelude::Table::alter()
                    .table(Workspace::Table)
                    .drop_column(WorkspaceSessionFields::BaseCommit)
                    .drop_column(WorkspaceSessionFields::WorktreePath)
                    .drop_column(WorkspaceSessionFields::Branch)
                    .drop_column(WorkspaceSessionFields::ProjectId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
pub enum WorkspaceSessionFields {
    ProjectId,
    Branch,
    WorktreePath,
    BaseCommit,
}

pub struct M20260315000004WorkspaceRepoBaseBranch;

impl MigrationName for M20260315000004WorkspaceRepoBaseBranch {
    fn name(&self) -> &str {
        "m20260315_000004_workspace_repo_base_branch"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260315000004WorkspaceRepoBaseBranch {
    async fn up(&self, manager: &SchemaManager) -> std::result::Result<(), DbErr> {
        manager
            .alter_table(
                sea_orm_migration::prelude::Table::alter()
                    .table(WorkspaceRepo::Table)
                    .add_column(ColumnDef::new(WorkspaceRepo::BaseBranch).string())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> std::result::Result<(), DbErr> {
        manager
            .alter_table(
                sea_orm_migration::prelude::Table::alter()
                    .table(WorkspaceRepo::Table)
                    .drop_column(WorkspaceRepo::BaseBranch)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}
