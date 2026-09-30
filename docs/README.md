# Documentation

## Use Gradara

- [Install Gradara](INSTALL.md): download, install, the built-in simulation engine, update, and uninstall.
- [Your first 10 minutes](USER_GUIDE.md#your-first-10-minutes): run an example, then build a model from scratch.
- [User guide](USER_GUIDE.md): diagrams, subsystems, variants, the Explorer, results, export, and [keyboard shortcuts](USER_GUIDE.md#keyboard-shortcuts).
- [FAQ](FAQ.md) and glossary.
- [Validation](VALIDATION.md): Gradara's results next to closed-form answers, checked by automated tests.
- [AI features](AGENT_SETUP.md): Gradara AI credits, your own API key, and what each task costs.
- [Troubleshooting](development/TROUBLESHOOTING.md): the engine not being ready, failed runs, AI sign-in, updates, logs, and bug reports.
- [Supported platforms](PLATFORMS.md).
- [Privacy and data handling](PRIVACY.md) and [security](../SECURITY.md).

### Examples

- [DC motor speed control](../models/DC.md)
- [Servo position control](examples/SERVO.md)
- [AC motor with field-oriented control](../models/FOC.md)
- [EV drivetrain](examples/EV.md)
- [Buck converter](../models/BUCK.md)
- [480 VAC flyback](examples/FLYBACK.md)
- [Data center cooling](examples/DATACENTER.md)

## Contribute

- [Developer setup](development/SETUP.md): run Gradara from source.
- [Contribution workflow](../CONTRIBUTING.md) and [community expectations](../CODE_OF_CONDUCT.md)
- [Testing and manual acceptance checks](development/TESTING.md)
- [Root agent instructions](../AGENTS.md) and [agent task playbooks](agents/PLAYBOOKS.md)
- [Roadmap and contribution ideas](../ROADMAP.md)
- [Release preparation](RELEASING.md) and [third-party notices](../THIRD_PARTY_NOTICES.md)

## Understand and extend the code

- [Architecture and decisions](../ARCHITECTURE.md)
- [Desktop distribution, AI providers, and the Gradara AI service](architecture/DISTRIBUTION.md) ([gateway operations](../cloud/README.md))
- [Document format, identity, and persistence](architecture/MODEL_FORMAT.md)
- [Simulation, agents, and exports](architecture/EXECUTION.md)
- [Local API](API.md)
- [Block design](blocks/DESIGN.md) and [block authoring](blocks/AGENT_BLOCK_GUIDE.md)
- [Wiring and interaction contract](architecture/WIRING.md)

## Keep documentation useful

User documentation (install guide, user guide, FAQ, AI features, troubleshooting, examples) is written for engineers using the desktop app: plain language, present tense, and the names the app shows. Put commands and code references in the developer guides or in a "For contributors" section at the end of an example.

Describe shipped behavior in the architecture and user guides. Put proposals in the roadmap or a clearly marked design note. Code and schemas define the actual contract; update these guides when the contract changes.

`python3 scripts/check-docs.py` checks relative Markdown links, backticked repository paths, `npm run` scripts, `cloud/deploy.sh` commands, and `GRADARA_*` variables in repository content. It does not validate external URLs or heading anchors. `npm run report:blocks` generates an ignored local catalog inventory in `reports/`; inspect the live `/block-catalog` page for visual review.

Keep task-specific verification in pull requests and release evidence. The repository documentation should explain how to use, extend, test, and release the current product, without development-session diaries or generated report snapshots.
