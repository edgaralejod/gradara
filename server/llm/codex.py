# SPDX-License-Identifier: Apache-2.0
"""Developer option: the user's own signed-in Codex CLI.

Kept for source checkouts. Installed builds default to Gradara AI or a
bring-your-own API key, which need no extra tools.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path

from ..paths import AGENT_DIR
from ..processes import spawn_options, terminate_generation
from .providers import Generation, ProviderError, Usage


def codex_path() -> str:
    return (os.environ.get('GRADARA_CODEX_BIN') or os.environ.get('FLUX_CODEX_BIN') or shutil.which('codex')
            or '/Applications/ChatGPT.app/Contents/Resources/codex')


def codex_available() -> bool:
    path = codex_path()
    return Path(path).exists() or shutil.which(path) is not None


async def generate(prompt: str, schema: dict, job_id: str) -> Generation:
    if not codex_available():
        raise ProviderError('Codex CLI was not found. Install it or choose another AI provider in Settings.', 400)
    folder = AGENT_DIR/job_id
    folder.mkdir(parents=True, exist_ok=True)
    schema_path = folder/'schema.json'
    result_path = folder/'response.json'
    schema_path.write_text(json.dumps(schema))
    (folder/'prompt.txt').write_text(prompt)
    command = [codex_path(), 'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox',
               'read-only', '-c', 'features.shell_tool=false', '--output-schema', str(schema_path),
               '--output-last-message', str(result_path), '--color', 'never', '-']
    env = {k: v for k, v in os.environ.items() if not k.startswith('CODEX_') or k == 'CODEX_HOME'}
    process = await asyncio.create_subprocess_exec(*command, cwd=folder, env=env, stdin=asyncio.subprocess.PIPE,
                                                   stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                   **spawn_options())
    try:
        _, stderr = await asyncio.wait_for(process.communicate(prompt.encode()), 180)
    except (asyncio.CancelledError, asyncio.TimeoutError):
        await terminate_generation(process)
        raise
    (folder/'agent.log').write_bytes(stderr)
    if process.returncode != 0 or not result_path.exists():
        raise ProviderError('Component generation did not finish. ' + stderr.decode(errors='replace')[-1200:], 502)
    return Generation(json.loads(result_path.read_text()), 'codex', 'codex', Usage())
