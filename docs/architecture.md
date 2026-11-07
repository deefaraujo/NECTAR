# Architecture

NECTAR uses Node.js for the local server and Electron for the desktop window. The interface is HTML, CSS and JavaScript in `public/`. The desktop entry point is `electron/main.mjs`; the server is `server.mjs`.

`lib/` holds storage and agent coordination. `templates/` describes generic teams: a template is not a client project and must not contain its files.

Models run through integrations with the local CLIs. Authentication, permissions, costs and capabilities depend on the accounts installed. Integrations with external services are independent of the tool's versioning.

The server listens on loopback. Electron exposes specific methods through `preload.cjs`, with context isolation and no direct access from the frontend to Node.

The visual agent interprets transient frames and requests validated actions. Its action contract is kept separate from the server modules so that importing it in Electron does not initialize storage before the data folder is defined.

Preparing this repository did not rewrite the orchestrator. It separates code, documentation, optional add-ons and local files, preserving the existing architecture.
