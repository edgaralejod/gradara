# Security and data handling

## Intended environment

The desktop app and local service are a **trusted, single-user local application**. The service binds to the loopback interface only (`127.0.0.1:8765` from the source launcher, a random free port in the desktop app). There is no authentication, authorization, tenant isolation, or TLS. Do not expose it through a public bind address, port forwarding, or a tunnel.

Browser-facing protections: requests must use a loopback Host name (blocking DNS-rebinding pages), a browser Origin must be the workbench itself, and every state-changing request must carry the `X-Gradara-Client` header. Browsers cannot add that header cross-origin without a CORS preflight, which is refused, so other websites cannot trigger simulations or paid AI requests. A local process that can reach the port can still operate the workspace; this is not authentication.

The hosted Gradara AI service (`cloud/`) is separate: it has per-user authentication, a credit ledger, rate limits, and a task allowlist. See [privacy](docs/PRIVACY.md) and [the gateway guide](cloud/README.md).

## Files and execution

Saved documents, generated Modelica, full results, and controller exports live in the data folder: `projects/` in a source checkout, the OS application-data folder in the desktop app. Runtime logs live under `.runtime/` or the app's `logs/` folder. API keys, the Gradara AI token, and the GitHub token for personal features are kept in the OS keychain, which the operating system protects, or in a user-only (0600) file in the data folder when no keychain is available or `GRADARA_CREDENTIAL_STORE=file` is set. The data folder itself is ignored by Git but not encrypted. Nothing in it is deleted automatically, except that each model's Proposals thread keeps only its newest 60 entries, and deleting a run also deletes the results discussions about it. Back up important models and remove sensitive artifacts deliberately. Do not attach these directories wholesale to bug reports.

The service can access the host filesystem and Docker daemon. With the **built-in** engine on Windows and Linux and with the **native** engine, OpenModelica runs as the user without container isolation. On macOS the built-in engine runs in a Linux virtual machine (Apple's Virtualization framework, started by vfkit) that has no network device, sees only the app's data folder (read and write, over virtio-fs), and boots a read-only root filesystem shipped inside the signed app; the app talks to it only through a local socket. In every case, `server/safety.py` rejects external functions, `Modelica.Utilities`, annotations, imports, class definitions, and string literals in definition text before any compiler runs, in addition to the document schema's own checks. Simulation containers use an unprivileged user, network isolation, resource limits, dropped capabilities, and a job-directory mount. With every engine, a run is stopped after 120 seconds and as soon as its result file passes 1 GB, so neither a model nor its simulation settings can fill the disk. These controls reduce exposure; they are not a guarantee that arbitrary hostile model files or compiler exploits are safe. Imported documents and equation snippets should come from trusted sources. The equation validator is a bounded input filter, not a complete Modelica security parser.

Agent and export subprocesses have separate lifecycle code. Native Windows agent cancellation uses `taskkill.exe /T /F` for its process tree; this is cleanup, not additional sandboxing. Full native Windows provider validation and C-export timeout/cancellation cleanup remain areas for improvement. Do not claim all subprocesses are hardened identically to the simulation adapter.

## Personal features

Personal features are code. A layer replaces the app's workbench and its local service package, and runs with the user's permissions, exactly like Gradara itself. The trust rules (`desktop/layers.cjs`, `desktop/main.cjs`):

- A layer installs only from GitHub release assets of the workshop repository chosen in Settings, and only when its Ed25519 signature verifies with a key trusted **for that repository**: the built-in key in `desktop/layer-keys.json` for the main repository, or a key the user added for a fork in **Settings → Personal features**, after a dialog that says code signed with it runs with their permissions. Every file must match the signed manifest's SHA-256, and nothing unlisted is accepted. Archives refuse links, absolute paths, and `..`.
- A layer can contain only the workbench build, the `server` package, and the service's JSON data files. It cannot replace the shell, its signature checks, the bundled Python dependencies, or the engine.
- Signatures and hashes are checked at install, not at every launch; the unpacked layer folder in the app's folder is as trusted as the app's own files.
- A layer that fails to start is marked faulty and the shipped code starts instead. Layers are disabled in development and self-test runs.
- The workshop pipeline that builds layers runs an AI agent on GitHub's runners with a spending cap, refuses changes to credential, safety, and path modules, the shell, packaging, CI, dependencies, and the legal and privacy documents, runs the tests, has a second agent review the change, and loads the layer into the released service before signing. These gates reduce risk; they are not a security review by a person. Steps that run the branch's code get no token or secret.

## What leaves the machine

Ordinary local simulation does not call an LLM provider and needs no network: installers include the engine. Setting up an optional engine of your own (native OpenModelica or Docker) downloads OpenModelica's library or the engine image. The desktop app checks GitHub Releases for updates. AI features contact the provider selected in Settings → AI: Gradara AI, OpenAI or Anthropic with the user's key, or the Codex CLI. Personal features, when set up, contact GitHub.

- Component creation sends the request text; refinement also sends the existing component definition.
- Full-model creation sends the request, built-in catalog snapshot, and local AI library definitions to the configured provider for planning and assembly. It does not send unrelated saved models.
- Repair attempts may send the candidate and compiler diagnostics.
- Model edits and diagnoses send the open model's blocks, parameters, equations, and connections without its layout, the selected block names, and the block catalog. Refining a proposal also sends the earlier request and that proposal's operations. Diagnosis also sends the problems you ask about and, for a failed run of the same model, the emitted Modelica source and solver messages.
- Explain results sends the question, up to four earlier questions and answers of the discussion, a digest of the shown runs computed locally (statistics, events, an outline of each signal of at most 900 points in all, differences between runs, parameters, solver warnings, signal names), and run A's model without layout. A follow-up request sends the results of up to four measurements the AI asked for. Recorded samples and CSV files are not sent.
- Controller export sends project name/revision, the selected block's equations, parameters and definition, nearby connection metadata, and target-interface instructions.
- Personal features send requests to api.github.com with the user's GitHub token (starting the workshop workflow, following its runs, reading its reports and releases) and download layer files from the repository's public release assets. The request text, the generated code, the run's reports, and a draft pull request are public on GitHub.
- **Improve Gradara** opens GitHub's new-issue page in the browser with the request, the reason Gradara gave, the app version, and the platform in the page address. No model or file is attached, and the issue is public once submitted.
- With the Codex CLI, prompts and responses are also kept locally for diagnostics. Other providers keep no local copy unless `GRADARA_KEEP_AI_TRANSCRIPTS=1` is set.

Do not submit confidential equations or model metadata unless using the configured provider for that content is acceptable to you. With your own key, vendor retention and account terms apply. Gradara AI does not store or log prompts or responses, though its model provider (Anthropic) may keep them briefly for abuse monitoring; see [privacy](docs/PRIVACY.md). Gradara does not need provider credentials for normal editing or simulation. Never commit CLI authentication files, API keys, environment files, or provider logs.

## Reporting a vulnerability

Contact Edgar Duarte privately at **[support@virtu-services.us](mailto:support@virtu-services.us?subject=Gradara%20security%20report)** with the subject **Gradara security report**. This is the single contact address for Gradara at [Virtu Services](https://virtu-services.us), and it is also published in `site/public/.well-known/security.txt`. Do not post exploit details, credentials, or private models in a public issue.

A useful report identifies the affected revision, trust boundary, impact, and minimal synthetic reproduction. Start with a concise description and arrange transfer of sensitive attachments with the maintainer. No guaranteed response time or supported long-term release series is currently offered.

## Contributor requirements

Preserve loopback defaults and runtime restrictions. Changes to transport, validation, path handling, process launch, mounts, or agent permissions need a concrete threat-boundary explanation and relevant tests. Do not add personal credentials to CI or run untrusted pull-request code on a personal machine through an automated workflow. The only secrets workflows use are the repository's own: release signing, the website deploy key, and the workshop's `ANTHROPIC_API_KEY` and `LAYER_SIGNING_KEY`, which no step that runs a branch's code receives.

The repository hygiene script is a limited detector, not a security certification. Before publication, review the entire reachable Git history and release payload, and use the host's secret scanning where available. Dependency updates require reviewing actual upstream terms and runtime behavior; successful installation is not a vulnerability or license audit.
