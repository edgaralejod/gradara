# Troubleshooting

The first part covers the desktop app. The second part is for people running Gradara from a source checkout.

## Using the desktop app

### The app does not start

If Gradara cannot start its local service, it shows "Gradara could not start its local service" and offers **Open logs**. The file `service.log` in the logs folder explains what went wrong. **Help → Open Logs Folder** opens the same folder later.

- **Antivirus or security software** may block or quarantine the app's service (`gradara-backend`, or `gradara-backend.exe` on Windows). Restore it or allow it, then reinstall Gradara.
- **Windows SmartScreen** shows "Windows protected your PC" because the Windows installer is not code-signed yet. Choose **More info → Run anyway**. See [Install Gradara](../INSTALL.md#windows).
- **Linux AppImage** needs FUSE 2. See [Install Gradara](../INSTALL.md#linux).
- **macOS** release builds are signed and notarized and open normally. If you build the app yourself without signing, macOS blocks it on first open. On macOS 15 and later, try to open it once, then go to **System Settings → Privacy & Security** and choose **Open Anyway**. On earlier versions, right-click the app and choose **Open**.

If the service stops while you work, Gradara says "The Gradara service stopped unexpectedly" and offers **Restart**, **Open logs**, or **Quit**. Your saved models are safe. **Help → Restart Local Service** restarts it at any time.

### The engine is not ready

Open **Settings → Engine**. The top line says what is wrong; choose **Check again** after each step. **Help → Copy Diagnostic Info** copies the engine status and the end of the service log for a bug report.

**Built-in engine (the default)**

- **"The built-in engine is incomplete"** or **"could not load its library."** Part of the app's `engine` folder is missing, often removed by antivirus software. Reinstall Gradara; your models are kept.
- **"A C compiler is needed"** (Linux AppImage). OpenModelica builds each model with `gcc`. Install it (`sudo apt install gcc` on Debian or Ubuntu), then choose **Check again**. The `.deb` installs it automatically.
- **"The built-in engine could not start"** (macOS). Choose **Restart engine**. The message includes the end of the engine's logs; the full logs are `engine-vm.log` and `engine-vm-console.log` in the logs folder (**Help → Open Logs Folder**). The engine needs macOS 13 or newer and about 3 GB of free memory. If another virtualization tool is using most of your memory, quit it and restart the engine.
- **"macOS 13 or newer is required."** Update macOS. On older versions, choose **OpenModelica installed on this computer** or **Container engine (Docker)** in the **Engine** menu if you maintain one of those yourself.

**Your own OpenModelica** (Engine menu: **OpenModelica installed on this computer**)

- **"OpenModelica is not installed."** Install OpenModelica 1.27 (**Download OpenModelica** opens the right page), then choose **Check again**. Gradara looks for OpenModelica on your `PATH`, in `OPENMODELICAHOME`, and in the standard install folders.
- **"OpenModelica could not start."** Reinstall OpenModelica with the default options.
- **"Modelica Standard Library 4.1.0 is missing."** Choose **Set up now**. This needs an internet connection once.
- **A note that Gradara is validated with OpenModelica 1.27.1.** Your OpenModelica is another version. It may work, but results can differ from the tested setup.
- **"No C compiler was found"** (Linux): install `gcc` with `sudo apt install build-essential`.

**Container engine** (Engine menu: **Container engine (Docker)**)

- **"Docker is not installed"** or **"Docker is not running."** Install or start your container runtime (Docker Engine, Docker Desktop, OrbStack, or Colima), then choose **Check again**. With Colima installed on macOS, **Set up now** starts it.
- **"Engine image not prepared."** Choose **Set up now**. The image is 1 to 2 GB.
- **"Docker is set to Windows containers."** In Docker Desktop, switch to Linux containers, then choose **Check again**.

### A run fails

1. Open the **Problems** tab (⌘/Ctrl+J). Model checks list problems Gradara found before running, such as an unconnected input. **Last run** lists what the compiler or solver reported, with chips that select the blocks involved. Expand a row for the full message.
2. Common causes:
   - An unconnected signal input, an empty subsystem placeholder, or a bus mistake: a bus wired into a block that takes one signal (split it with a Demux or Bus Selector), a Demux whose output count does not divide its input, or a Bus Selector naming a signal the bus no longer has.
   - A problem inside a subsystem. Open the subsystem to see it on its sheet.
   - A subsystem variant that lacks one of the block's ports. Add the port inside the active variant, or mark it **not used here** in the inspector's **Variants** section.
   - An algebraic loop: a feedback path of signal blocks with no state, delay, or integrator. Problems lists the blocks it found on the loop (a best-effort hint).
   - Parameter values out of range, wrong feedback sign, a floating circuit with no ground, or a switch network that has no valid solution in some state.
   - A run that takes longer than 120 seconds of real time. Shorten the stop time or simplify the model.
3. With an AI provider set up, **Explain** or **Fix with AI** in Problems can suggest a cause and a fix.

A failed run never shows partial results as if they were complete.

### Results disappear after an edit

Results belong to the model exactly as it ran. Changing parameters, connections, equations, or the stop time needs another run. Moving or resizing blocks does not. If moving a block alone clears your results, please report it with the model.

### AI sign-in and credits

| Message | What to do |
| --- | --- |
| "Sign in to Gradara AI" | **Settings → AI → Sign in**. Confirm the code on the page that opens in your browser. If the page does not open, choose **Open sign-in page**. |
| "Sign-in expired. Start again." | The code was not confirmed in time. Choose **Sign in** again. |
| "Not enough credits" | Buy credits in **Settings → AI**. Your balance updates when you return from checkout; choose **Refresh** if it does not. |
| Credits missing after a purchase | Choose **Refresh**. If they still do not appear, email support@virtu-services.us with your account email and the Stripe receipt. |
| "rejected the API key" | Your OpenAI or Anthropic key is wrong or revoked. Paste a new one in **Settings → AI**. |
| "does not recognize the model" | Clear the **Model** field to use the default, or enter a model your account can use. |
| Rate limit, or service temporarily unavailable | Wait a minute and try again. Gradara AI does not charge for requests that fail before producing output. |
| The service is older than the app | Gradara AI has not caught up with your app version yet. Try again later. |
| A generated block fails its checks | Check **Settings → Engine**. Gradara tries one automatic repair, then shows the compiler message. |

AI needs an internet connection. With **Off** selected, AI buttons stay visible and say that AI is off. See [AI features](../AGENT_SETUP.md).

### Updates

- **Settings → Updates** shows your version and the last check. **Check for updates** checks now.
- **Linux .deb** does not update itself. Choose **Download from gradara.app** and install the new `.deb`.
- **The update never finishes downloading.** Check your connection, then quit and reopen Gradara. The update check needs access to `github.com`; some company networks block it. You can always download the latest installer from [gradara.app](https://gradara.app/) and install it over the old version. Your models are kept.
- An update that is ready installs when you choose **Restart to update**, or the next time you quit.

### Where the logs are

**Help → Open Logs Folder** opens it.

| System | Logs folder |
| --- | --- |
| Windows | `%APPDATA%\Gradara\logs` |
| macOS | `~/Library/Application Support/Gradara/logs` |
| Linux | `~/.config/Gradara/logs` |

`service.log` is the main log. Older content moves to `service.log.1` when the file grows past 5 MB.

### Report a bug

Choose **Help → Copy Diagnostic Info** first. It puts the app version, your operating system, the engine status, and the last lines of the service log on the clipboard (your home folder is shown as `~`), then offers to open the issue page. Paste it into the report, and add:

- **What you did, what you expected, and what happened.** For wiring problems, mention the zoom level, any keys you held, and which ports you connected.
- **The whole log**, if asked: `service.log` from **Help → Open Logs Folder**.
- **The model**: **Export → Gradara project**. A small model that shows the problem is best.

Logs and model files can contain your model's content. Remove anything confidential before you post. Never attach passwords, API keys, or your whole data folder. Report security issues privately as described in [SECURITY.md](../../SECURITY.md).

## Working from source

These notes apply when you run Gradara from a source checkout with `scripts/start.py`. See [setup](SETUP.md) and [testing](TESTING.md).

### The workbench cannot connect

Check [service health](http://127.0.0.1:8765/api/health). If it does not answer, read `.runtime/service.log` and the launcher terminal. Read `.runtime/workbench.log` for frontend startup errors. Do not start a second launcher while the first is running. Ports 4317 and 8765 must be free or used by the intended Gradara processes.

The service only accepts requests from `localhost` or `127.0.0.1` at the documented ports. Another hostname or port gets a 403. Keep the service bound to loopback; changing CORS is not a substitute for authentication.

### Engine setup from source

A source checkout has no built-in engine, so **Automatic** prefers a ready native OpenModelica, then a ready Docker image. To use a built engine bundle instead (for example `build/engine` from `packaging/engine/`), set `GRADARA_ENGINE_BUNDLE` to its folder; see [setup](SETUP.md#built-in-engine-bundles).

- If `omc` is not on `PATH` or in a standard location, set `GRADARA_OMC` to its path.
- On macOS, Gradara uses the `colima-gradara` Docker context when it exists, otherwise the default context when its daemon answers (OrbStack or Docker Desktop), otherwise `colima-gradara`, which it can start. Set `GRADARA_DOCKER_CONTEXT` to force a context.
- The launcher builds or pulls the image when it is missing. The first build needs network access. The runtime must be able to mount the run folders and have enough disk and memory. On Linux, the image's `ENGINE_UID` should match the user that creates run folders. See [setup](SETUP.md) and the [manual engine build](TESTING.md).

### Run diagnostics on disk

Each run folder under `projects/runs/` has the emitted Modelica source and `diagnostics.json`, which holds the same structured problems the job reported, with the raw solver text in each `detail`. Do not treat partial CSV output as a successful result or weaken completion checks to remove an error.

Jobs are held in memory. After a service restart, an old job ID can return 404 even though the completed run's files are still on disk. Reopen the model to load a matching result. Unfinished jobs are not resumed.

### AI providers from source

`agentReady` in the API means the selected provider is configured (key saved, signed in, or CLI found), not that it is reachable. Provider errors keep their HTTP meaning: 401 (key rejected), 402 (not enough Gradara AI credits), 429 (rate limit), 503 (unavailable), 422 (the Gradara AI service is older than the app).

For the Codex CLI, it must be installed, signed in, and able to reach its provider. Set `GRADARA_CODEX_BIN` if it is not found. Codex runs keep prompts and logs under the data folder's `agent/` directory (`projects/agent/` in a source checkout). Other providers keep nothing unless `GRADARA_KEEP_AI_TRANSCRIPTS=1`. These files can contain proprietary model content; redact them before sharing.

### Install fails at the React Flow patch

Use `npm ci` with the committed lockfile and the supported Node version. A mismatch in the upstream version or observer implementation stops installation on purpose. Do not delete the postinstall script, suppress errors, or patch a global browser API. Follow [patch maintenance](../../patches/README.md) when upgrading on purpose.

### Changes are not showing

Frontend files reload automatically. A service started with `scripts/start.py` does not reload Python changes; restart it, or use the separate `uvicorn --reload` command from [setup](SETUP.md). Refreshing the browser does not restart Python.

Template changes apply to newly created models. Saved models keep their own copy. Use **Examples → Use example** to see an updated template; do not delete your workspace to make it appear.

### Bug reports from source

Also include the commit, your browser, and the engine version. For simulation problems, attach a small synthetic `.gradara.json`. Never attach all of `projects/`, credentials, or private model data.
