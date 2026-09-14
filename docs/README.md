# Documentation

## Use Gradara

- [Install and run](development/SETUP.md)
- [Enable AI features: accounts, infrastructure, and troubleshooting](AGENT_SETUP.md)
- [Modeling workflow and controls](USER_GUIDE.md)
- [Troubleshooting](development/TROUBLESHOOTING.md)
- Examples: [DC motor](../models/DC.md), [field-oriented control](../models/FOC.md), [ideal-switch buck](../models/BUCK.md)
- [Security and data handling](../SECURITY.md)

## Contribute

- [Contribution workflow](../CONTRIBUTING.md) and [community expectations](../CODE_OF_CONDUCT.md)
- [Testing and manual acceptance checks](development/TESTING.md)
- [Root agent instructions](../AGENTS.md) and [agent task playbooks](agents/PLAYBOOKS.md)
- [Roadmap and bounded contribution ideas](../ROADMAP.md)
- [Release preparation](RELEASING.md) and [third-party notices](../THIRD_PARTY_NOTICES.md)

## Understand and extend the code

- [Architecture and decisions](../ARCHITECTURE.md)
- [Document format, identity, and persistence](architecture/MODEL_FORMAT.md)
- [Simulation, agents, and exports](architecture/EXECUTION.md)
- [Local API](API.md)
- [Block design](blocks/DESIGN.md) and [block authoring](blocks/AGENT_BLOCK_GUIDE.md)
- [Wiring and interaction contract](architecture/WIRING.md)

## Keep documentation useful

Describe shipped behavior in the architecture and user guides. Put proposals in the roadmap or a clearly marked design note. Keep reproducible commands in the development guides rather than duplicating them in every document. Code and schemas define the actual contract; update these guides when the contract changes.

`python3 scripts/check-docs.py` checks relative Markdown file links in repository content. It does not validate external URLs or heading anchors. `npm run report:blocks` generates an ignored local catalog inventory in `reports/`; inspect the live `/block-catalog` page for visual review.

Keep task-specific verification in pull requests and release evidence. The repository documentation should explain how to use, extend, test, and release the current product, without development-session diaries or generated report snapshots.
