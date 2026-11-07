# Changelog

All notable changes to NECTAR are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-07

First public version of the tool.

### Added

- Desktop app (Electron) and local web interface for running a team of AI agents per project, through the Claude Code and Codex CLIs.
- Team chat, direct messages, groups, and posts, with agents that open and update cards.
- Task board with Backlog, Ready, In progress, Blocked, Review, Testing (QA), and Done columns, per-column limits, story points, acceptance criteria, and dependencies.
- Autopilot that pulls cards on its own, with team agreements and risky decisions escalated to the user.
- Memory per project: rules, references, measured facts, and per-agent context.
- Calendar shared by all teams in a project, with reminders as notifications.
- Hive view of the whole team and the work in progress.
- Credit and cost control: model per task type, effort ceiling, account usage reading, per-card estimate, and a usage report.
- Local voice calls with the team lead.
- Integrations with Jira, Notion, GitHub, and Outlook through MCP.
- Six ready-made team templates: Software development, Product Designer, Creative & Visual Design Studio, Professional Operations, Game development, and Vertical Series.
- Interface in English, Brazilian Portuguese, Spanish, French, Simplified Chinese, Japanese, Korean, and Russian, with a language picker in the header. Agents write in the chosen language.
- Publication check that blocks private folders, embedded projects, and known secret patterns from being committed.

[Unreleased]: https://github.com/deefaraujo/NECTAR/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/deefaraujo/NECTAR/releases/tag/v1.0.0
