# Install Gradara

Gradara is a desktop app for Windows, macOS, and Linux. Each installer includes the simulation engine, OpenModelica 1.27.1 with the Modelica Standard Library 4.1.0, so there is nothing else to download or set up: install the app, open it, and run a model.

After that, see [Your first 10 minutes](USER_GUIDE.md#your-first-10-minutes).

## Requirements

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| System | Windows 10 or 11, 64-bit (x64) | macOS 13 Ventura or newer, Apple silicon or Intel | 64-bit (x86-64). Tested on Ubuntu 22.04 and 24.04 and Debian 12. |
| Download | `Gradara-win-x64.exe` | `Gradara-mac-arm64.dmg` (Apple silicon) or `Gradara-mac-x64.dmg` (Intel) | `Gradara-linux-amd64.deb` (Debian, Ubuntu) or `Gradara-linux-x86_64.AppImage` (other distributions) |
| Simulation engine | Included | Included (runs in a small built-in virtual machine) | Included. It uses the system's `gcc`, which the `.deb` installs for you. |
| Disk space | About 1 GB installed | About 700 MB installed | About 600 MB installed |

[Supported platforms](PLATFORMS.md) lists what is tested on each system.

Rough guidance: 8 GB of RAM or more. On macOS the engine's virtual machine uses up to 2 GB while it runs. Large models and long simulations need more space for results.

You need a network connection only to download the app. Drawing and simulating work offline. AI features and update checks need a connection.

## Download

Download from **[gradara.app](https://gradara.app/)** or from the [latest GitHub release](https://github.com/edgaralejod/gradara/releases/latest). Direct links:

- Windows: [Gradara-win-x64.exe](https://github.com/edgaralejod/gradara/releases/latest/download/Gradara-win-x64.exe)
- macOS, Apple silicon (M1 and later): [Gradara-mac-arm64.dmg](https://github.com/edgaralejod/gradara/releases/latest/download/Gradara-mac-arm64.dmg)
- macOS, Intel: [Gradara-mac-x64.dmg](https://github.com/edgaralejod/gradara/releases/latest/download/Gradara-mac-x64.dmg)
- Linux, Debian or Ubuntu: [Gradara-linux-amd64.deb](https://github.com/edgaralejod/gradara/releases/latest/download/Gradara-linux-amd64.deb)
- Linux, other distributions: [Gradara-linux-x86_64.AppImage](https://github.com/edgaralejod/gradara/releases/latest/download/Gradara-linux-x86_64.AppImage)

Not sure which Mac you have? Open the Apple menu → **About This Mac**. "Chip: Apple M…" means Apple silicon. "Processor: Intel" means Intel.

## Install the app

### Windows

1. Run `Gradara-win-x64.exe`.
2. The Windows installer is not code-signed yet, so Windows SmartScreen may show **"Windows protected your PC"**. Choose **More info**, check that the file name is `Gradara-win-x64.exe`, then choose **Run anyway**.
3. Follow the installer. It installs for your user account only. You can change the install folder. It adds a desktop shortcut and a Start menu entry.
4. Open **Gradara** from the Start menu.

Some antivirus tools block the app's local service (`gradara-backend.exe`). If Gradara reports that it could not start its local service, see [Troubleshooting](development/TROUBLESHOOTING.md#the-app-does-not-start).

### macOS

1. Open the `.dmg` file.
2. Drag **Gradara** to the **Applications** folder.
3. Open Gradara from Applications or Launchpad.

The macOS app is signed by Virtu Services LLC and notarized by Apple. On first open, macOS asks you to confirm that you want to open an app downloaded from the internet. Choose **Open**.

### Linux

**Debian or Ubuntu (.deb)**

```sh
sudo apt install ./Gradara-linux-amd64.deb
```

Then open **Gradara** from your applications menu, or run `gradara` in a terminal. The `.deb` does not update itself (see [Updates](#updates)).

**AppImage**

1. Make the file executable: right-click → Properties → Permissions → **Allow executing file as program**, or run `chmod +x Gradara-linux-x86_64.AppImage`.
2. Double-click it, or run `./Gradara-linux-x86_64.AppImage`.

AppImages need FUSE 2. If the AppImage does not start on Ubuntu, install it with `sudo apt install libfuse2` (Ubuntu 22.04) or `sudo apt install libfuse2t64` (Ubuntu 24.04). The AppImage updates itself.

## The simulation engine

There is no engine to set up. The first time you run a model, Gradara starts its built-in engine:

- **Windows and Linux**: OpenModelica runs directly from the app's folder.
- **macOS**: OpenModelica does not publish macOS builds, so Gradara runs it in a small Linux virtual machine that ships inside the app. It starts in a few seconds the first time you run a model, stays ready while Gradara is open, and stops when you quit. It uses Apple's built-in Virtualization framework; you do not need Docker or any other software. The virtual machine has no network access and sees only Gradara's data folder.

**Settings → Engine** shows the engine's status, for example **OpenModelica 1.27.1 (built in)** with a green dot. **Check again** refreshes it. If the engine reports a problem, the tab says what to do (on macOS, **Restart engine**), and **Help → Copy Diagnostic Info** collects what a bug report needs.

**Linux AppImage**: OpenModelica turns each model into a small program with `gcc`. The `.deb` installs it for you; with the AppImage, install it once (`sudo apt install gcc` on Debian or Ubuntu). The Engine tab tells you if it is missing.

### Using your own OpenModelica or Docker instead

The **Engine** menu in **Settings → Engine** also offers **OpenModelica installed on this computer** and **Container engine (Docker)**. They are for people who already maintain their own OpenModelica installation or container setup; most people should keep **Built-in engine (recommended)**. Gradara is validated with OpenModelica 1.27; other versions may work, but results can differ. If a chosen engine is not ready, see [Troubleshooting](development/TROUBLESHOOTING.md#the-engine-is-not-ready).

## Updates

Gradara checks for a new version shortly after it starts and every four hours.

- **Windows, macOS, and the Linux AppImage** download the update in the background. A small progress indicator appears in the header. When the update is ready, the header shows **Restart to update**. Your models are already saved, so restarting is safe. If you do not restart, the update installs the next time you quit.
- **Linux .deb** cannot replace itself without your password. The header shows **Update available**, and **Download from gradara.app** opens the download page. Install the new `.deb` the same way as the first one.

**Settings → Updates** shows your version and has **Check for updates**. The **Help → Check for Updates** menu item does the same.

## Where your models are stored

Gradara keeps your models, simulation results, AI block library, and settings in a data folder. **Help → Open Data Folder** opens it.

| System | Data folder | Logs folder |
| --- | --- | --- |
| Windows | `%APPDATA%\Gradara\data` | `%APPDATA%\Gradara\logs` |
| macOS | `~/Library/Application Support/Gradara/data` | `~/Library/Application Support/Gradara/logs` |
| Linux | `~/.config/Gradara/data` | `~/.config/Gradara/logs` |

Inside the data folder, `models` holds your models and `trash` holds models you removed. Back up the whole data folder to keep your models and results. API keys you enter for OpenAI or Anthropic are stored in your system's keychain, not in this folder.

To move a single model to another computer, use **Export → Gradara project** and **Models → Import file** instead of copying folders.

## Uninstall

Uninstalling the app removes it together with its built-in engine and keeps your data folder, so you can reinstall without losing models. Remove the data folder yourself if you want it gone. (If you set up an engine of your own for Gradara in an earlier version, such as OpenModelica, Colima, or a Docker image, remove it the way you installed it; the app no longer needs it.)

### Windows

1. **Settings → Apps → Installed apps → Gradara → Uninstall** (or **Add or remove programs**).
2. Optional: delete `%APPDATA%\Gradara` to remove your models, results, and settings.

### macOS

1. Quit Gradara and drag it from **Applications** to the Trash.
2. Optional: delete `~/Library/Application Support/Gradara` to remove your models, results, and settings.

### Linux

1. `.deb`: run `sudo apt remove gradara`. AppImage: delete the `.AppImage` file.
2. Optional: delete `~/.config/Gradara` to remove your models, results, and settings.

## Next steps

A new model opens with the block library on the left, the sheet in the middle, and the inspector on the right.

![A new, empty model](images/first-launch.webp)

- [Your first 10 minutes](USER_GUIDE.md#your-first-10-minutes)
- [User guide](USER_GUIDE.md)
- [AI features](AGENT_SETUP.md) (optional)
- [FAQ](FAQ.md) and [Troubleshooting](development/TROUBLESHOOTING.md)
- Building from source instead? See the [developer setup](development/SETUP.md).
