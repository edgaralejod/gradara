# Security and data handling

## Intended environment

Gradara is currently a **trusted, single-user local application**. The launcher binds FastAPI to `127.0.0.1:8765` and the browser workbench to localhost. There is no authentication, authorization, tenant isolation, TLS termination, or public-service hardening. Do not expose the service through a public bind address, port forwarding, or an unauthenticated tunnel.

The service checks browser Origin headers against local origins and configures CORS. Requests without an Origin header are accepted. These checks reduce some accidental browser access; they do not authenticate a caller or make an internet deployment safe. A local process that can reach the API can operate the workspace and invoke configured generation features.

## Files and execution

Saved documents, generated Modelica, full results, prompts, agent responses/logs, and controller exports live under `projects/`. Runtime logs live under `.runtime/`. They are ignored by Git, but not encrypted or automatically deleted. Back up important models and remove sensitive artifacts deliberately. Do not attach these directories wholesale to bug reports.

The service can access the host filesystem and Docker daemon. Simulation containers use an unprivileged user, network isolation, resource limits, dropped capabilities, and a job-directory mount. These controls reduce exposure; they are not a guarantee that arbitrary hostile model files or compiler exploits are safe. Imported documents and equation snippets should come from trusted sources. The equation validator is a bounded input filter, not a complete Modelica security parser.

Agent and export subprocesses have separate lifecycle code. Native Windows agent cancellation and C-export timeout/cancellation cleanup remain areas for improvement. Do not claim all subprocesses are hardened identically to the simulation adapter.

## What leaves the machine

Ordinary local simulation does not call an LLM provider. Dependency installation and the first Docker image/library build download upstream packages. The optional agent features contact the configured Codex provider using the user's existing CLI authentication.

- Component creation sends the request text; refinement also sends the existing component definition.
- Repair attempts may send the candidate and compiler diagnostics.
- Controller export sends project name/revision, the selected block's equations, parameters and definition, nearby connection metadata, and target-interface instructions.
- Generation prompts and responses are also retained locally for diagnostics.

Do not submit confidential equations or model metadata unless using the configured provider for that content is acceptable to you. Provider retention and account terms are outside this repository's control. Gradara does not need provider credentials for normal editing or simulation. Never commit CLI authentication files, API keys, environment files, or provider logs.

## Reporting a vulnerability

Contact Edgar Duarte privately at **[contact@virtu-services.us](mailto:contact@virtu-services.us?subject=Gradara%20security%20report)** with the subject **Gradara security report**. This is the public contact address for [Virtu Services](https://virtu-services.us). Do not post exploit details, credentials, or private models in a public issue.

A useful report identifies the affected revision, trust boundary, impact, and minimal synthetic reproduction. Start with a concise description and arrange transfer of sensitive attachments with the maintainer. No guaranteed response time or supported long-term release series is currently offered.

## Contributor requirements

Preserve loopback defaults and runtime restrictions. Changes to transport, validation, path handling, process launch, mounts, or agent permissions need a concrete threat-boundary explanation and relevant tests. Do not add credentials to CI or run untrusted pull-request code on a personal machine through an automated workflow.

The repository hygiene script is a limited detector, not a security certification. Before publication, review the entire reachable Git history and release payload, and use the host's secret scanning where available. Dependency updates require reviewing actual upstream terms and runtime behavior; successful installation is not a vulnerability or license audit.
