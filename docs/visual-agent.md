# Experimental interview agent

Access it through the 🧪 button in the NECTAR sidebar or at `/entrevista.html`.
Chrome stays as it is: the agent sees the shared screen and controls Windows input.
The interview HTML page will be created in a later step.

## HackerRank and LeetCode style challenges

The lab's default mode is Desafio de programação (coding challenge). Pick the HackerRank, LeetCode or visual detection style, the Easy/Medium/Hard difficulty and a preferred language. The difficulty is a label entered by the researcher to compare runs, not a guarantee that the problem gets solved. For interview questions without code, select the other mode.

Leave the language on "Analisar o teste e escolher" (analyze the test and choose) for automatic selection. The agent must check the requirements in the problem statement, the stub, the current language/version and the options available in the selector. A requirement from the test takes precedence over preferences. When no language is mandatory, it weighs the options against the resume, the problem, libraries and limits; it does not assume the initial language and is not limited to the preference options in NECTAR. A language offered by the platform that is not in the NECTAR form can also be chosen in automatic mode.

The selection must be visually confirmed in a frame taken after the click. The tracking and the report store the observed options, the selected language, the evidence and a short justification. Code without a confirmed selection is rejected and requested again from the model before any typing. The previous confirmation is discarded when moving on to another question. This confirmation comes from the model's visual reading; it is not a DOM query.

Typing uses per-character keyboard events, with a configurable rate of 5 to 25 characters per second (default 12), small variations in the interval and extra pauses at line breaks. It does not use the clipboard and does not insert the block through the DOM. The speed is approximate: Windows/editor latency and pauses affect the total time. The report records the chosen speed. While typing, the routine checks focus before each key event; if the browser loses focus, it stops sending the remaining keys. This interruption can leave a partial solution in the editor, which must be checked before resuming.

The protocol instructs the agent to read the whole statement, examples, constraints and signature, choose an approach compatible with time/memory limits, preserve the platform's function/class and driver, edit, run cases, interpret errors, fix and submit. Run/Run Code and Submit are separate steps; passing examples do not prove final acceptance. It does not consult the platforms' editorials or assistants.

Before each action identified as Submit, the validator requires a previous Run/Test action that was executed, followed by an approved evaluation with visual evidence and a comparison of the result. Clicking Run does not count as evaluating its result. Pending cases, errors, a missing evaluation or a failed result block the submission and generate feedback for a new analysis, without sending the click. Editing, fixing, changing language or a new question invalidate the evaluation. A submission consumes the approval: another submission requires a new run and evaluation. The compact validation history preserves the cycle even after more than 30 actions. Native actions that failed are not considered executed.

This check uses the intent and the visual observations reported by the model; it does not query the DOM and does not identify the button through a platform API. A click the model wrongly classified as another action is not independently recognized as Submit. The evaluation is recorded in avaliacaoTeste in the events and in ultimaAvaliacaoTeste in the report.

The model can keep a textual memory of up to 24 thousand characters of the statement and the solution between frames. The codigo action types multiline code into the focused editor, with Unicode events and Enter keys, without the clipboard. Selection, home/end and undo shortcuts allow corrections. Autocomplete, auto-pairing and indentation vary by editor; the agent is instructed to check and fix them visually. No editor API is used. Full insertion in Monaco/HackerRank/LeetCode still requires practical validation.

The report includes platform, difficulty, preferred language, model per action, duration, counts of the actions identified as run/submission and the observed verdicts. The counts are the model's classifications, not internal platform telemetry. The verdicts distinguish exemplos_ok, aceito, resposta_incorreta, erro_compilacao, erro_execucao, tempo_excedido and memoria_excedida. Completion in coding mode requires an observed acceptance with evidence and a previous action recorded as a submission. This check avoids concluding on examples alone, but it does not independently verify the site's server.

This feature uses a visual protocol for these interfaces; it is not a certified integration with the platforms. It has not yet been validated solving Easy, Medium and Hard problems on them. Next validation: a technical interview page with an editor and controlled results.

The solving environment is restricted to the platform's content: the editor, files/stubs and documentation provided on the page, examples, custom cases, results console, Run/Test and Submit. A terminal built into the page can be used when the test itself provides it. It does not open the computer's terminal, a local IDE, the file explorer or external sources to solve the problem. The Windows input routine checks the foreground application and blocks the keyboard in applications that are not browsers; clicks and scrolling must also land on the active browser window. This bounds the window; it does not independently verify the domain or each button on the page. The restriction to the test's content is also part of the agent's instructions.

Navigation references: https://candidatesupport.hackerrank.com/articles/9623161883-answer-coding-questions and https://support.leetcode.com/hc/en-us/articles/32442719377939-How-to-create-test-cases-on-LeetCode.

## Configuration

Connect your Claude or Codex account in NECTAR's Ajustes (settings). It does not require Ollama or an additional API key.

In the lab, select Claude Opus 5.5, GPT-6.1 Sol, GPT-6.1 Terra or Automático (automatic). Automatic mode tries them in that order, moving to the next one on unavailability/error. An explicit selection does not switch models. Login confirms the account; model availability and quotas are confirmed on the real call. The report records the model used in each action and the failures of previous attempts.

The visual bridge reuses NECTAR's executable discovery and login, with multimodal input from Claude Code and the Codex App Server. The resume and the frames are sent to the selected provider. There are no local screenshot files; the inference sessions use a no-persistence/ephemeral mode. Claude tools are disabled; in Codex, shell, apps, browser, computer use, web search and the file viewer are disabled, with a read-only sandbox. Interaction with the screen goes only through NECTAR's validated actions.

## Running it

1. Open the lab in the NECTAR app for Windows.
2. Enter the resume as text or upload a PDF (up to 10 MB), TXT or Markdown. Check the extracted text in the field before starting. Scanned PDFs without selectable text need a version with text or a transcription. The text limit is 40 thousand characters, with no silent truncation.
3. Share the entire screen where Chrome is and enter the action limit.
4. Click start and bring the test interview to the foreground during the five-second preparation. The countdown appears only inside NECTAR; no extra window is opened. Control is locked until the countdown ends.
5. Watch and take your notes while keeping the mouse and keyboard free (for notes on the same computer, use another session/device). Use Parar (stop) or Ctrl+Shift+F12 to interrupt. The shortcut also cancels a pending analysis.
6. Download the JSON report. It contains timestamps and actions, including typed text; store it as participant data.

The run shows no floating indicators, browser warnings or extra windows. Tracking, countdown and stop reasons stay only on the NECTAR page. NECTAR can be minimized; the test browser must remain visible on the shared screen. The window's processing is not throttled when it is in the background. Closing NECTAR still shuts down the agent.

Network failures, timeouts and invalid model responses allow up to three consecutive analyses, always with a new frame and the error as feedback. No invalid action is executed. Click/typing failures are not retried automatically. Manual stop, the shortcut, the end of screen sharing, login/CAPTCHA and an explicit request to stop still end control. The reason reported by the model is shown.

The last shutdown and a summary of events are kept in `data/entrevista-diagnostico.json` in the app's data folder and can be queried at `/api/entrevista/diagnostico`. This diagnostic does not include the resume, the frames or the text of typed actions. The full report remains available for download on the page.

The agent receives one current frame per decision. It does not use the DOM, the clipboard, separate OCR or screenshot files. The frames are transient JPEG images from the stream, kept in memory and sent to the engine. The decision frequency depends on inference: it is not continuous video perception. Typing uses Unicode keyboard events, without pasting text.

## Limits of the experiment

Select an entire screen; per-window control is not implemented. The interview must remain visible: this mode does not operate a minimized Chrome, does not confine actions to a window and does not allow using the same desktop at the same time. The lab keeps processing while Chrome is in the foreground. Closing the page ends the run. The global shortcut disarms control, interrupts input in progress and cancels the pending analysis. There is a limit of 300 actions and a 90-second timeout per model attempt (up to 280 seconds in automatic mode).

Completion is an indication from the model based on the image, not an independent confirmation from the interview system. Resume, state and report live in the page's memory; download the report before leaving. There is no resume after closing the app. Visual quality, click precision, DPI and comprehension depend on the model and need validation on the future HTML interview.

## Verification

`node tests/entrevista.mjs` validates the action contract and the integration with a simulated response. The test does not prove the visual model's capability or the real operation of mouse and keyboard.

Real validation in this implementation: Opus 5.5 and GPT-6.1 Sol identified the word in a synthetic image sent in memory through the connected accounts. This verifies the multimodal channel, not a complete interview. GPT-6.1 Terra was found in the catalog but did not receive a visual call in this validation.

References: https://learn.chatgpt.com/docs/app-server and https://code.claude.com/docs/en/cli-reference.
