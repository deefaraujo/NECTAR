# Team templates

A template is a folder in [templates/](../templates/) that describes one team: who is on it, what each role does, which skills they use, how work flows, and which rules everyone follows. A template holds configuration only, never a project.

## Ready-made teams

| Template | Folder | Lead | What it does | Agents |
|---|---|---|---|---|
| Software development | `software` | P.O. | Architecture, front end, UI/UX, back end, data, integrations, pipeline, infrastructure, security, QA, review, and versioning | 16 |
| Product Designer | `product-design` | Orchestrator | Discovery, research, UX, UI, prototyping, testing, and documentation, with a narrative core for story-driven products | 41 |
| Creative & Visual Design Studio | `visual-graphic-design` | Creative director | Branding, art direction, graphic and editorial design, illustration, characters, motion, social, campaigns, and prepress | 27 |
| Professional Operations | `professional-operations` | Chief of Staff | Rebuilds what you did from Git, boards, Jira, Notion, calendar, and e-mail, and produces reviews, reports, and presentations | 18 |
| Game development | `jogos` | P.O. | 2D games in Ren'Py for mobile: research, script, dialogue, code, touch UI, sprites, VFX, and game feel | 14 |
| Vertical Series | `novela-vertical` | Showrunner | Vertical (9:16) series: from the story to the animated storyboard of each scene, with a series bible | 7 |

## What a template contains

- `template.json`: team name, description, agents (id, name, role, responsibilities, department), key roles (lead, QA, curator), routing, and the team contract.
- `regras.md`: rules every agent on the team follows.
- `agentes/`: one persona file per agent.
- `personalidades/`: personality presets for the agents.
- `playbooks/`: step-by-step playbooks per role.
- `CATALOGO.md` (some templates): the catalog of roles and flows.
- `skills/`: skills written for NECTAR. `skills/ORIGEM.md` lists where each one comes from.
- `skills-opcionais.json`: optional add-ons from other repositories. Their content is not redistributed; a local installation can provide them under their own licenses.

Agent personas, rules, and skills are written in Portuguese. Agents still answer in the interface language chosen in the header.

## Making your own team

1. Copy the closest template folder and rename it.
2. Edit `template.json`: give the team a name and adjust the agents.
3. Edit the personas and `regras.md`.
4. Restart NECTAR. The new template appears when you add a project.

Run `node tests/skills-templates.mjs` to check that every skill an agent cites exists and has a recorded origin.
