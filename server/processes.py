# SPDX-License-Identifier: Apache-2.0
"""Platform-specific cleanup for the isolated generation subprocess."""
import asyncio
import os
import signal
import subprocess


async def terminate_generation(process):
    if process.returncode is not None:
        return
    if os.name == 'nt':
        # terminate()/kill() alone leave CLI wrapper children running on Windows.
        cleanup = await asyncio.create_subprocess_exec(
            'taskkill.exe', '/PID', str(process.pid), '/T', '/F',
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        try:
            output, _ = await asyncio.wait_for(cleanup.communicate(), 10)
        except asyncio.TimeoutError:
            cleanup.kill()
            await cleanup.communicate()
            raise RuntimeError('Timed out stopping the generation process tree.')
        if cleanup.returncode and process.returncode is None:
            raise RuntimeError('Could not stop the generation process tree: '
                               + output.decode(errors='replace')[-1200:])
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    await process.communicate()
