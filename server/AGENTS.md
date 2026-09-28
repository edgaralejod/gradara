# Local service and numerical engine

The root [AGENTS.md](../AGENTS.md) applies, including [keeping documentation current](../AGENTS.md#keep-documentation-current): service changes usually own `docs/API.md`, the execution guide, or the privacy notice. Read [execution](../docs/architecture/EXECUTION.md), [model format](../docs/architecture/MODEL_FORMAT.md), [API](../docs/API.md), and [SECURITY.md](../SECURITY.md) for relevant changes.

- Preserve loopback binding, origin checks, bounded request validation, and container isolation. Do not turn this trusted local prototype into a hosted service by changing only a bind address.
- Keep `models.py` and the TypeScript document contract aligned. Omit unset optional values in document responses; test save/load, migration, and identity with temporary directories.
- Built-in physical library kinds use canonical Modelica wrappers. Generated physical definitions use bounded snippets with standard typed connectors. Enforce the selected creation type and preserve terminal identity on refinement. Preserve connection laws and surface compiler diagnostics rather than guessing execution order.
- Run immutable snapshots. Keep source, result identity, input contract, and failure output associated with the correct run. Never turn partial or non-finite output into a completed result.
- Read and write text files with `encoding='utf-8'` (and pass it to text-mode subprocess calls). Windows defaults to a legacy code page, so a bare `read_text()` breaks on names like µF; `tests/test_text_encoding.py` enforces this across the repository.
- Preserve timeouts, cancellation, and container/process cleanup. Agent generation cleanup lives in `processes.py` (POSIX process groups, Windows `taskkill.exe /T /F`). The C-export adapter has a separate lifecycle and documented gaps; check each path explicitly.
- Generated definitions and C source are data/artifacts. Do not give generation subprocesses project-editing privileges or add provider credentials to tests.
- Unit tests must not touch a user's active workspace. Real-engine tests may create unique ignored run folders; never clean the entire `projects/` directory.
- For engine, compiler, or physical-wrapper changes, run meaningful real-engine tests as well as schema/unit checks. Report unavailable prerequisites instead of faking integration success.
