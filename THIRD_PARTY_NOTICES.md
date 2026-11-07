# Third-party components and independent rights

The `LICENSE` file governs NECTAR's original material. It does not alter independent third-party licenses and does not transfer rights over projects processed with the tool.

- Node dependencies are declared in `package.json` and pinned in `package-lock.json`. They are not copied into this repository; they are fetched with `npm ci` and keep their own licenses, including the notices of Electron/Chromium, electron-builder, and pdf-parse.
- The interface fonts in `public/fonts/` ship with their `OFL-*.txt` texts. They remain under the SIL Open Font License and are not subject to the commercial restriction of the original code's license.
- External skills or reference libraries are not redistributed here. `templates/*/skills-opcionais.json` lists the identifiers of known add-ons; a local installation may provide them separately, under their owners' licenses. The local directories of those add-ons are ignored by Git.
- The voice samples in `vozes/` are 12-second public domain excerpts from LibriVox recordings, documented in `vozes/ORIGEM.md`. A person's own sample stays outside the repository.
- The distributed tests use synthetic data. The repository's sample PDF is generated to test text extraction, with no client documents or external publications.

No client project, employer project, or other work repository is included in this distribution. Local resources and projects must not be added with `git add -f`.
