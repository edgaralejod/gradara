#!/usr/bin/env python3
"""Start Gradara's local UI and application service; keep processes together."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from server.runtime import IMAGE, LEGACY_IMAGE, colima_profile, docker_argv, docker_context
RUNTIME=ROOT/'.runtime'
RUNTIME.mkdir(exist_ok=True)
URL='http://localhost:4317/'
API='http://127.0.0.1:8765/api/health'


def reachable(url):
    try:
        with urllib.request.urlopen(url,timeout=2) as response:
            return response.status==200
    except Exception:
        return False


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--no-open',action='store_true')
    args=parser.parse_args()
    if reachable(URL) and reachable(API):
        print('Gradara is already running at '+URL,flush=True)
        if not args.no_open:webbrowser.open(URL)
        return
    python=ROOT/'.venv'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    if not python.exists():
        raise RuntimeError('Install the Python environment first. See README.md.')
    if not shutil.which('npm'):
        raise RuntimeError('Node.js is required. See README.md.')
    docker=docker_argv()
    if platform.system()=='Darwin':
        check=subprocess.run([*docker,'info'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if check.returncode and shutil.which('colima'):
            print('Starting the local numerical engine…',flush=True)
            subprocess.run(['colima','start','--profile',colima_profile(docker_context()),'--cpu','4','--memory','4','--disk','30','--vm-type','vz','--mount-type','virtiofs','--activate=false'],check=True)
    check=subprocess.run([*docker,'image','inspect',IMAGE],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if check.returncode:
        legacy=subprocess.run([*docker,'image','inspect',LEGACY_IMAGE],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if legacy.returncode==0:
            subprocess.run([*docker,'tag',LEGACY_IMAGE,IMAGE],check=True)
        else:
            print('Preparing OpenModelica and the component library…',flush=True)
            subprocess.run([*docker,'build','-f','Dockerfile.engine','--build-arg',f'ENGINE_UID={os.getuid() if hasattr(os,"getuid") else 1000}','-t',IMAGE,'.'],cwd=ROOT,check=True)
    commands=[('service',[str(python),'-m','uvicorn','server.app:app','--host','127.0.0.1','--port','8765']),('workbench',[shutil.which('npm'),'run','dev','--','--port','4317'])]
    children=[]
    logs=[]
    def stop(*_):
        for child in children:
            if child.poll() is None:
                if os.name=='nt':child.terminate()
                else:os.killpg(child.pid,signal.SIGTERM)
        for child in children:
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:child.kill()
        (RUNTIME/'launcher.pid').unlink(missing_ok=True)
        for log in logs:log.close()
    signal.signal(signal.SIGTERM,lambda *args:sys.exit(0))
    signal.signal(signal.SIGINT,lambda *args:sys.exit(0))
    try:
        for name,command in commands:
            log=(RUNTIME/f'{name}.log').open('a')
            logs.append(log)
            child=subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            children.append(child)
        (RUNTIME/'launcher.pid').write_text(str(os.getpid()))
        deadline=time.monotonic()+75
        while time.monotonic()<deadline:
            if any(child.poll() is not None for child in children):
                raise RuntimeError('A service could not start. See .runtime/service.log and .runtime/workbench.log.')
            if reachable(API) and reachable(URL):break
            time.sleep(.25)
        else:raise RuntimeError('The workbench did not become ready. See .runtime logs.')
        print('Gradara is running at '+URL,flush=True)
        if not args.no_open:webbrowser.open(URL)
        while all(child.poll() is None for child in children):time.sleep(1)
    finally:stop()

if __name__=='__main__':
    try:main()
    except Exception as exc:print(f'Gradara: {exc}',file=sys.stderr);sys.exit(1)
