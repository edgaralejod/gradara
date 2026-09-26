# SPDX-License-Identifier: Apache-2.0
"""Platform-specific process spawning and cleanup for engine and agent subprocesses."""
import asyncio
import os
import signal
import subprocess


def spawn_options(new_group: bool = True) -> dict:
    """Keyword arguments for child processes started by the local service.

    New process groups let cancellation stop a whole tree (omc, make, gcc and the
    simulation executable). On Windows, CREATE_NO_WINDOW keeps an installed GUI
    app from flashing console windows for every child.
    """
    if os.name == 'nt':
        flags = subprocess.CREATE_NO_WINDOW
        if new_group:
            flags |= subprocess.CREATE_NEW_PROCESS_GROUP
        return {'creationflags': flags}
    return {'start_new_session': new_group}


async def terminate_tree(process):
    """Stop a child process and everything it started; wait for it to exit."""
    await terminate_generation(process)


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
