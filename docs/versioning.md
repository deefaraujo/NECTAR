# NECTAR versioning

The repository holds the source code, templates, tests and resources the application needs. Local data and generated distributions stay on the computer, outside Git.

## Development

```powershell
npm ci
npm start
```

To run without Electron, use `npm run web`. To build the Windows distribution, use `npm run pack` or `npm run build`. The application uses the Claude/Codex accounts connected on the computer; logins and credentials are not part of the repository.

## Recording changes

```powershell
git status
git diff
git add path/to/file
git diff --cached
git commit -m "Describe the change"
git push
```

Create branches for larger changes with `git switch -c change-name`, from a clean working tree. Do not use reset or file cleanup to discard changes you want to keep.

## Data that stays out

`data/`, `projetos/` and `relatorios/` are runtime data and do not go up to GitHub. Also excluded are `node_modules/`, `dist/`, `dist-*/`, executables, ZIPs, caches, logs, environment files and credentials. The `.gitignore` does not delete these files: it only excludes them from version control.

Git does not replace the backup of local conversations, projects and settings. Before publishing new files, check `git diff --cached`; do not use `git add -f` to include data that was intentionally excluded.

The remote repository must remain private until an explicit decision to publish the code and review the licenses of resources and dependencies. No distribution license of its own was added automatically.
