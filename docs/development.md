# Development and validation

Use Node.js 22 and `npm ci`. Start with `npm start` or `npm run web`.

- `npm run check:publicacao`: checks the content staged in Git.
- `npm test`: behavior scenarios for the core.
- `npm run test:teamwork`: Teamwork contracts and flows.
- `python tests/entrevista-ui.py`: visual lab with simulated actions.
- `python tests/avaliacoes-ui.py`: manual organizer and persistence.
- `python tests/entrevista-input.py`: PowerShell with events collected instead of sent to the real keyboard.
- `python tests/empacotado.py`: smoke test of the Electron package with isolated data.

The Python UI tests require Playwright and a compatible browser. Some image tools require Pillow. To regenerate the synthetic PDF, install reportlab separately and run `python scripts/gerar-fixture-pdf.py`.

External skills are optional and their content is not published. The tests check that each reference is either an original file that is available or an explicitly declared add-on. Missing content is neither executed nor considered validated. An installation that already has add-ons can run additional checks on its local files.

Old scripts for batch generation and modification are not part of the maintained code. SDK, account, model, voice or external device features need specific validation; scripted tests do not replace it.
