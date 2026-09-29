# SPDX-License-Identifier: Apache-2.0
"""Command agent inside the Gradara engine VM.

Listens on vsock port 1024 (exposed on the Mac as a Unix socket by vfkit). Each
connection carries one JSON request line and gets one JSON response line:

    {"ping": true}                                   -> {"ok": true, "kernel": "..."}
    {"argv": [...], "cwd": "/data/...", "timeout": s,
     "env": {...}, "time": epoch}                   -> {"code": n, "output": "...", "timedOut": false}

A command runs in its own process group and is killed when it exceeds its
timeout or when the app closes the connection (a cancelled run). Runs as PID 1:
the parent process only reaps orphans and restarts the server if it exits.
"""
import json
import os
import select
import signal
import socket
import subprocess
import sys
import threading
import time

PORT = 1024
OUTPUT_LIMIT = 2_000_000
BASE_ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp/home', 'LANG': 'C.UTF-8',
            'OPENMODELICALIBRARY': '/opt/modelica'}


def respond(conn, payload):
    conn.sendall((json.dumps(payload) + '\n').encode())


def run(conn, request):
    if request.get('time'):
        try:
            time.clock_settime(time.CLOCK_REALTIME, float(request['time']))
        except (OSError, ValueError):
            pass
    if request.get('ping'):
        respond(conn, {'ok': True, 'kernel': os.uname().release})
        return
    env = dict(BASE_ENV, **{str(k): str(v) for k, v in (request.get('env') or {}).items()})
    os.makedirs(env['HOME'], exist_ok=True)
    timeout = float(request.get('timeout') or 120)
    try:
        process = subprocess.Popen(request['argv'], cwd=request.get('cwd') or '/tmp', env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    except OSError as exc:
        respond(conn, {'code': 127, 'output': str(exc), 'timedOut': False})
        return
    chunks, size = [], [0]

    def drain():
        for block in iter(lambda: process.stdout.read1(65536), b''):
            chunks.append(block)
            size[0] += len(block)
            while size[0] > OUTPUT_LIMIT and len(chunks) > 1:
                size[0] -= len(chunks.pop(0))

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout
    timed_out = cancelled = False
    while process.poll() is None:
        if time.monotonic() > deadline:
            timed_out = True
            break
        readable, _, _ = select.select([conn], [], [], 0.2)
        if readable and not conn.recv(1, socket.MSG_PEEK):
            cancelled = True
            break
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            pass
    process.wait()
    reader.join(5)
    if cancelled:
        return
    output = b''.join(chunks).decode('utf-8', errors='replace')
    respond(conn, {'code': process.returncode, 'output': output, 'timedOut': timed_out})


def serve_one(conn):
    try:
        with conn:
            data = b''
            while not data.endswith(b'\n'):
                block = conn.recv(65536)
                if not block:
                    return
                data += block
            run(conn, json.loads(data))
    except Exception as exc:  # keep the agent alive whatever one request does
        try:
            respond(conn, {'code': 125, 'output': f'engine agent error: {exc}', 'timedOut': False})
        except OSError:
            pass


def server():
    tcp = os.environ.get('GRADARA_AGENT_TCP')
    if tcp:  # tests only: the same protocol over TCP, for running the image under Docker
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(('0.0.0.0', int(tcp)))
    else:
        listener = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
        listener.bind((socket.VMADDR_CID_ANY, PORT))
    listener.listen(16)
    print('gradara-agent: listening on', f'tcp port {tcp}' if tcp else f'vsock port {PORT}', flush=True)
    while True:
        conn, _ = listener.accept()
        threading.Thread(target=serve_one, args=(conn,), daemon=True).start()


def main():
    if os.getpid() != 1:
        server()
        return
    # PID 1: reap every orphan; keep one server process running.
    while True:
        child = os.fork()
        if child == 0:
            try:
                server()
            finally:
                os._exit(1)
        while True:
            pid, _ = os.wait()
            if pid == child:
                print('gradara-agent: server exited; restarting', flush=True)
                time.sleep(0.5)
                break


if __name__ == '__main__':
    main()
