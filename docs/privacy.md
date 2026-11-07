# Privacy and project separation

The repository must hold only the tool's code and resources. Work and commercial projects, prompts, conversations, reports, resumes and credentials stay out of it.

On the desktop, usage data lives in the application's data folder. To preserve old installations, the name may still be `Game Studio AI`, inside `%APPDATA%`. Project paths are configured separately. In web development mode, the `data/` folder at the root may be used.

The `.gitignore` excludes data, builds, caches, local add-ons and historical scripts. `scripts/verificar-publicacao.mjs` also checks the versioned list and some secret patterns. It does not replace human review.

Check the publication before committing or pushing. Do not use `git add -f` to get around exclusions. Publishing a folder and then deleting it does not remove its content from the history; incidents require dealing with the history and any exposed secrets.

GitHub does not automatically receive the projects just because the tool was put under version control. Agents, integrations and models may process the data you give them; check their permissions separately.

Git does not replace the backup of the private data excluded from the repository.
