from pathlib import Path
import os,signal
pid_file=Path(__file__).resolve().parent.parent/'.runtime'/'launcher.pid'
if pid_file.exists():
    try:os.kill(int(pid_file.read_text()),signal.SIGTERM)
    except ProcessLookupError:pass
    print('Gradara stopped. Your projects remain saved.')
else:print('No Gradara launcher is running.')
