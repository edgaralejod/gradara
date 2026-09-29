# Frequently asked questions

## Getting started

### Do I need MATLAB or Simulink?

No. Gradara is an independent tool. It has its own model format and simulates with OpenModelica. It cannot open MATLAB or Simulink files, and it does not run MATLAB scripts. Gradara is not affiliated with or endorsed by MathWorks.

### Do I need Docker?

- **Windows and Linux:** no. Gradara uses OpenModelica installed on your computer. You can choose a container engine instead if you prefer.
- **macOS:** yes, for now. OpenModelica does not publish macOS builds, so Gradara runs it in a small Linux container. Install Colima (free) and Gradara starts it for you. See [Install Gradara](INSTALL.md#macos-1).

### Is Gradara free?

Yes. The app is free and open source under the [Apache License 2.0](../LICENSE). Every modeling, simulation, and export feature is free. AI features are optional. You can use Gradara AI with prepaid credits (20 free credits when you sign up), use your own OpenAI or Anthropic account, or turn AI off. See [AI features](AGENT_SETUP.md).

### Which systems does it run on?

Windows 10 and 11 (64-bit), macOS 13 or newer on Apple silicon or Intel, and 64-bit Linux (tested on Ubuntu 22.04 and 24.04). See [Install Gradara](INSTALL.md) and [supported platforms](PLATFORMS.md).

## Modeling

### What can I simulate?

Systems that mix control and physics:

- Control and signal processing: sources, math, continuous and discrete (sampled) blocks, PI and PID controllers, transforms, and Boolean logic.
- Electrical circuits: passive parts, sources, sensors, diodes, transistors, ideal switches, and power converters.
- Electric machines: DC, induction, and synchronous machines, plus 3-phase sources, loads, and transformers.
- Mechanics: rotational (inertia, springs, gears) and translational (mass, spring, damper, force).
- Thermal and magnetic networks.

The library has 218 blocks. Most physical blocks come from the Modelica Standard Library 4.1.0. With AI, you can also describe a new block and have it written for you. The [examples](README.md#examples) show a DC motor, a servo, an AC motor with field-oriented control, an electric vehicle, a buck converter, a flyback converter, and data center cooling.

### How is this different from a block diagram tool?

Signal blocks work like a classic block diagram: values flow from outputs to inputs. Physical blocks connect like real components: you wire a resistor to a capacitor or a motor to a load, and the solver works out currents and torques. You can mix both in one model. See [Ports and connections](USER_GUIDE.md#ports-and-connections).

### Can I export my model?

Yes. **Export** offers:

- **Modelica source** (`.mo`), to use in other Modelica tools.
- **Gradara project** (`.gradara.json`), to share with other Gradara users or move to another computer.
- **C code** for a controller: a subsystem or selected signal blocks, or the controller Gradara detects on the sheet. You can check the C code against your last simulation run.

Gradara cannot import Modelica files. See [Export](USER_GUIDE.md#export).

### Can I use it offline?

Yes, after the one-time engine setup, which needs an internet connection. Drawing, simulating, and exporting then work offline. AI features and update checks need a connection.

### Where are my files?

In your data folder. **Help → Open Data Folder** opens it. On Windows it is `%APPDATA%\Gradara\data`, on macOS `~/Library/Application Support/Gradara/data`, and on Linux `~/.config/Gradara/data`. Your models never leave your computer unless you use an AI feature or export them yourself. See [Where your models are stored](INSTALL.md#where-your-models-are-stored).

### Can I trust AI-generated blocks?

Every generated block passes checks and the OpenModelica compiler before it appears, and its equations are visible and editable. Compiling is not the same as being physically correct, so review AI blocks the way you would review any model.

## Trust and support

### Is Gradara validated or certified?

No. Gradara is not certified for safety-critical use. OpenModelica and the Modelica Standard Library are widely used, and Gradara's results are checked against closed-form answers by automated tests (see [Validation](VALIDATION.md)), but you are responsible for verifying results before relying on them. Do not use Gradara as the only evidence for safety-related design decisions.

### Does my model leave my computer?

Only when you use an AI feature, and only what that request needs. Simulation always runs on your computer. Gradara has no analytics or tracking. See [privacy](PRIVACY.md).

### Who makes Gradara?

Gradara is created by Edgar Duarte and published by Virtu Services LLC, with contributions from the open-source community. The source code is on [GitHub](https://github.com/edgaralejod/gradara).

### How do I report a bug or ask for help?

Choose **Help → Report an Issue** in the app, or open an issue on [GitHub](https://github.com/edgaralejod/gradara/issues). [Troubleshooting](development/TROUBLESHOOTING.md#report-a-bug) lists what to include. For account and billing questions, email support@virtu-services.us.

## Glossary

| Term | Meaning |
| --- | --- |
| **Modelica** | An open, standard language for describing physical systems with equations. Gradara turns your diagram into Modelica. |
| **MSL** | The Modelica Standard Library: a free library of tested components (resistors, motors, gears, heat capacities, and more). Gradara uses version 4.1.0. |
| **OpenModelica** | The free, open-source compiler and solver that runs Gradara's simulations. |
| **Block** | One component on the diagram, such as a gain, a resistor, or a motor. |
| **Port** | A connection point on a block. Signal ports are inputs or outputs. Physical ports are terminals. |
| **Net** | Everything joined by one set of wires: one signal, or one electrical node or shaft. A net can be drawn with several wire pieces and have its own name. |
| **Signal connection** | A one-way connection from an output to inputs. The value flows in one direction, as in a classic block diagram. |
| **Physical (acausal) connection** | A connection between physical terminals with no fixed direction. The solver works out which way current, torque, force, or heat flows. |
| **Subsystem** | A block that holds its own diagram inside, used to organize large models. |
| **Variant** | One of several alternative contents of a subsystem, behind the same ports. Only the active variant is simulated. |
| **Configuration** | A saved set of variant choices for the whole model. You can switch configurations or run them all to compare. |
