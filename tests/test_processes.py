# SPDX-License-Identifier: Apache-2.0
"""Exercise cancellation without invoking a provider or numerical engine."""
import asyncio
import ctypes
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace

from server.processes import terminate_generation


class GenerationCleanupTests(unittest.TestCase):
    def test_finished_process_needs_no_cleanup(self):
        process = AsyncMock(returncode=0)
        with patch('server.processes.asyncio.create_subprocess_exec') as spawn:
            asyncio.run(terminate_generation(process))
        spawn.assert_not_called()

    def test_posix_keeps_process_group_cleanup(self):
        process = SimpleNamespace(pid=123, returncode=None, communicate=AsyncMock())
        with patch('server.processes.os.name', 'posix'), \
                patch('server.processes.os.killpg', create=True) as killpg:
            asyncio.run(terminate_generation(process))
        killpg.assert_called_once_with(123, 15)
        process.communicate.assert_awaited_once()

    @unittest.skipUnless(os.name == 'nt', 'Windows taskkill error handling')
    def test_windows_cleanup_failure_is_visible(self):
        process = SimpleNamespace(pid=123, returncode=None, communicate=AsyncMock())
        cleanup = SimpleNamespace(
            returncode=1, communicate=AsyncMock(return_value=(b'access denied', None)),
        )
        with patch('server.processes.asyncio.create_subprocess_exec',
                   AsyncMock(return_value=cleanup)):
            with self.assertRaisesRegex(RuntimeError, 'access denied'):
                asyncio.run(terminate_generation(process))

    def test_posix_handles_exit_during_cleanup(self):
        process = SimpleNamespace(pid=123, returncode=None, communicate=AsyncMock())
        with patch('server.processes.os.name', 'posix'), \
                patch('server.processes.os.killpg', create=True,
                      side_effect=ProcessLookupError):
            asyncio.run(terminate_generation(process))
        process.communicate.assert_awaited_once()

    @unittest.skipUnless(os.name == 'nt', 'Native Windows process tree regression')
    def test_windows_stops_parent_and_child(self):
        async def exercise():
            script = (
                'import subprocess, sys, time; '
                'child = subprocess.Popen([sys.executable, "-c", '
                '"import time; time.sleep(60)"]); '
                'print(child.pid, flush=True); time.sleep(60)'
            )
            process = await asyncio.create_subprocess_exec(
                sys.executable, '-c', script,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
            handle = None
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
            kernel.OpenProcess.restype = ctypes.c_void_p
            kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
            kernel.WaitForSingleObject.restype = ctypes.c_ulong
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            try:
                child_pid = int(await asyncio.wait_for(process.stdout.readline(), 10))
                handle = kernel.OpenProcess(0x00100000, False, child_pid)
                self.assertTrue(handle, 'Open a handle while the child is alive')
                await asyncio.wait_for(terminate_generation(process), 15)
                self.assertIsNotNone(process.returncode)
                self.assertEqual(kernel.WaitForSingleObject(handle, 5000), 0,
                                 'The child must exit too')
            finally:
                if process.returncode is None:
                    await terminate_generation(process)
                if handle:
                    kernel.CloseHandle(handle)
        asyncio.run(exercise())
