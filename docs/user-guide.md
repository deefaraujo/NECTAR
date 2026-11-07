# User guide

NECTAR runs a team of AI agents on a folder of your choice. You talk to the team in a chat; the team lead turns requests into cards on a board; specialists do the work; review and QA check it before it is done.

## Before you start

- Windows, Node.js 22, and Git.
- [Claude Code](https://docs.claude.com/en/docs/claude-code), the [Codex CLI](https://github.com/openai/codex), or both, installed and logged in. NECTAR uses those accounts and their limits; it does not store API keys.
- A project folder with a backup. Agents can edit files and run commands with the permissions you give the app.

## Projects and teams

Click **+** in the left rail to add a project. Pick the folder and a [team template](templates.md). A project can hold several teams, each with its own board and agents; the first one works in the project folder itself.

Switch projects from the rail. Switch teams from the list at the top of the sidebar.

## Chat

- **Team channel**: everyone on the team reads it. Write requests here.
- **Direct messages**: click an agent to talk to them alone.
- **Groups**: open a group with a few agents for a focused discussion.
- **Posts**: longer write-ups and final reports.

Mention an agent with `@` to call them. Choose the engine (Claude or Codex) and the mode (plan or work) below the message box. Attach files with the paper clip.

## Board

The board has seven columns: Backlog, Ready, In progress, Blocked, Review, Testing (QA), and Done. Each column can have a work-in-progress limit.

A card has a title, a description, acceptance criteria, an owner, story points (1, 2, 3, or 5), priority, risk, an effort ceiling, and dependencies. Cards without verifiable acceptance criteria do not leave the backlog. Nobody reviews their own work: review and QA run in a separate worktree.

Open a card to see its technical flow, checks, review, QA, rework count, and history.

## Autopilot

Turn on **Autopilot** in the right panel to let the team pull cards by itself. The lead decides routine questions on your behalf and reports what it decided. Destructive, irreversible, paid, or production actions always come back to you.

Write team agreements in your own words (for example, "never push without passing tests"). Every agent receives them.

## Memory

Each project keeps rules, references, measured facts, and per-agent context. They enter the agent prompt when they are relevant. Open the **Memory** view to read, search, or curate notes.

## Calendar

One calendar per project, shared by all its teams. You and the agents can schedule events; reminders become notifications.

## Hive

The **Hive** view shows the whole team, who is working, who is queued or blocked, and the cards in each stage.

## Credits and cost

The right panel shows account usage for the 5-hour and 7-day windows. Set an effort limit per project or per card. When usage is high, NECTAR lowers the model level automatically, and at the limit it pauses the agents until the window renews. The usage report breaks cost down by card and agent.

## Voice calls

Start a call with the team lead from the phone icon. Speech is transcribed and synthesized on your machine. Voice needs Python and its own dependencies; see [development](development.md).

## Integrations

Open **Settings** to connect Jira, Notion, GitHub, or Outlook through MCP. A connection only shows as active after a real query succeeds.

## Language

Use the picker in the header to change the interface language. The choice is saved on this computer and also sets the language the agents write in.
