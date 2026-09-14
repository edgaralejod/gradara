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
- [Launch copy and demo outline](LAUNCH.md)

## Understand and extend the code

- [Architecture and decisions](../ARCHITECTURE.md)
- [Document format, identity, and persistence](architecture/MODEL_FORMAT.md)
- [Simulation, agents, and exports](architecture/EXECUTION.md)
- [Local API](API.md)
- [Block design](../BLOCK_DESIGN.md), [block authoring](blocks/AGENT_BLOCK_GUIDE.md), and [generated block audit](../BLOCK_AUDIT.md)
- [Wiring contract and implementation history](../WIRING.md) and [Simulink-based wiring audit](../WIRING_AUDIT.md)
- [Workflow/UI audit](../UI_AUDIT.md) and [validation history](../VALIDATION.md)

## Keep documentation useful

Describe shipped behavior in the architecture and user guides. Put proposals in the roadmap or a clearly marked design note. Keep reproducible commands in the development guides rather than duplicating them in every document. Code and schemas define the actual contract; update these guides when the contract changes.

`python3 scripts/check-docs.py` checks relative Markdown file links in repository content. It does not validate external URLs or heading anchors. Generated reports should be regenerated from their scripts, not hand-edited. Historical audits record what was verified at the time; they are not a claim that every later checkout passed the same checks.
