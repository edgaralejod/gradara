# SPDX-License-Identifier: Apache-2.0
"""Native OpenModelica backend plumbing, exercised with a stand-in omc."""
import asyncio
import json
import os
import stat
import sys
import textwrap

import pytest

from server import engines

pytestmark = pytest.mark.skipif(os.name == 'nt', reason='stand-in omc is a POSIX script')

FAKE_OMC = textwrap.dedent('''\
    #!{python}
    import pathlib, sys
    if sys.argv[1:] == ['--version']:
        print('OpenModelica v1.27.0 (64-bit)'); sys.exit(0)
    script = pathlib.Path(sys.argv[1]).read_text()
    here = pathlib.Path.cwd()
    mode = (pathlib.Path(__file__).parent/'mode').read_text().strip()
    if 'installPackage' in script or script.startswith('loadModel'):
        print('true' if mode != 'nolib' else 'false'); sys.exit(0)
    (here/'om_load.txt').write_text('false' if mode == 'nolib' else 'true')
    (here/'om_load_errors.txt').write_text('Error: library missing' if mode == 'nolib' else '')
    (here/'om_file.txt').write_text('true')
    if 'checkModel' in script:
        (here/'om_check.txt').write_text('Check of Gradara.Component completed successfully.')
        (here/'om_check_errors.txt').write_text('')
        sys.exit(0)
    if mode == 'fail':
        (here/'om_result.txt').write_text('')
        (here/'om_messages.txt').write_text('Simulation execution failed')
        (here/'om_sim_errors.txt').write_text('Error: division by zero at time 0.1')
        sys.exit(0)
    if mode == 'echo-only':
        print('record SimulationResult\\n    resultFile = "%s/simulation_res.csv",\\n    messages = "LOG_SUCCESS | info | The simulation finished successfully.\\n"\\nend SimulationResult;' % here)
    else:
        (here/'om_result.txt').write_text(str(here/'simulation_res.csv'))
        (here/'om_messages.txt').write_text('LOG_SUCCESS | info | The simulation finished successfully.')
        (here/'om_sim_errors.txt').write_text('Warning: minor')
    (here/'simulation_res.csv').write_text('"time","y"\\n0,0\\n1,1\\n')
''')


@pytest.fixture
def fake_omc(tmp_path, monkeypatch):
    tool = tmp_path/'bin'
    tool.mkdir()
    omc = tool/'omc'
    omc.write_text(FAKE_OMC.format(python=sys.executable), encoding='utf-8')
    omc.chmod(omc.stat().st_mode | stat.S_IEXEC)
    (tool/'mode').write_text('ok', encoding='utf-8')
    monkeypatch.setenv('GRADARA_OMC', str(omc))
    monkeypatch.setenv('GRADARA_ENGINE', 'native')
    monkeypatch.setattr(engines, 'NATIVE', engines.NativeBackend())
    monkeypatch.setitem(engines.BACKENDS, 'native', engines.NATIVE)
    return tool


def run(coro):
    return asyncio.run(coro)


def test_native_simulation_report(fake_omc, tmp_path):
    folder = tmp_path/'run'
    folder.mkdir()
    report = run(engines.execute(folder, {'duration': 1.0}, 'x'))
    assert report['result']['messages'].endswith('finished successfully.')
    assert report['diagnostics'] == 'Warning: minor'
    assert report['engine'] == 'OpenModelica 1.27.0'
    script = (folder/'gradara.mos').read_text(encoding='utf-8')
    assert 'stopTime=1.0' in script and 'loadModel(Modelica, {"4.1.0"})' in script
    assert json.loads((folder/'engine.json').read_text(encoding='utf-8'))['result']


def test_native_parses_echoed_record_when_files_absent(fake_omc, tmp_path):
    (fake_omc/'mode').write_text('echo-only', encoding='utf-8')
    folder = tmp_path/'run'
    folder.mkdir()
    report = run(engines.execute(folder, {'duration': 1.0}, 'x'))
    assert report['result']['resultFile'].endswith('simulation_res.csv')


def test_native_failure_is_reported_with_compiler_text(fake_omc, tmp_path):
    (fake_omc/'mode').write_text('fail', encoding='utf-8')
    folder = tmp_path/'run'
    folder.mkdir()
    # A model failure comes back as the report's error, like the Docker backend, so diagnostics can explain it.
    report = run(engines.execute(folder, {'duration': 1.0}, 'x'))
    assert 'division by zero' in report['error']


def test_native_check_and_status(fake_omc, tmp_path):
    folder = tmp_path/'check'
    folder.mkdir()
    assert run(engines.execute(folder, {'checkOnly': True}, 'x'))['checked']
    status = run(engines.status())
    assert status['backend'] == 'native' and status['ready'] and status['version'] == '1.27.0'


def test_missing_library_offers_setup(fake_omc):
    (fake_omc/'mode').write_text('nolib', encoding='utf-8')
    status = run(engines.status())
    assert not status['ready'] and status['actions'] == ['prepare']


def test_missing_omc_offers_install(monkeypatch, tmp_path):
    monkeypatch.setenv('GRADARA_ENGINE', 'native')
    monkeypatch.setattr(engines, '_om_candidates', lambda: [])
    status = run(engines.status())
    assert not status['ready'] and status['actions'] == ['install-openmodelica']


def test_simulation_end_to_end_with_native_backend(fake_omc, tmp_path, monkeypatch):
    from server import engine
    from server.workspace import document
    monkeypatch.setattr(engine, 'RUNS', tmp_path/'runs')
    project = document(json.loads(open('tests/motor-project.json', encoding='utf-8').read()))
    # The stand-in writes a generic CSV; only check that the pipeline reaches parsing.
    with pytest.raises(RuntimeError, match='before the requested|not'):
        run(engine.simulate(project.model_copy(update={'duration': 2.0}), 'native1'))
    assert (tmp_path/'runs'/'native1'/'model.mo').exists()


def test_docker_probe_is_cached_and_detects_windows_containers(monkeypatch):
    """One status check asks Docker once, and Windows-container mode is not 'ready'."""
    import asyncio
    from server import engines
    calls = []

    async def fake_run(argv, timeout, cwd=None, env=None):
        calls.append(argv[1:3])
        if argv[1] == 'info':
            return 0, 'windows\n'
        return 1, ''

    backend = engines.DockerBackend()
    monkeypatch.setattr(engines, '_run', fake_run)
    monkeypatch.setattr(engines.shutil, 'which', lambda name: '/usr/bin/docker' if name == 'docker' else None)
    monkeypatch.setattr(engines, 'docker_argv', lambda: ['docker'])

    status = asyncio.run(backend.status())
    assert status.label == 'Docker is set to Windows containers'
    assert not asyncio.run(backend.available())
    assert calls == [['info', '--format']], 'image lookups are skipped and the probe is reused'
    backend.forget()
    asyncio.run(backend.status())
    assert len(calls) == 2


def test_library_check_is_shared_by_concurrent_callers(monkeypatch, tmp_path):
    # Two status calls at once (the app's engine poll and a run request after the
    # macOS VM boots): the second must wait for the MSL check, not read the
    # in-progress check as a recent failure.
    monkeypatch.setattr(engines, 'DATA', tmp_path)
    backend = engines.NativeBackend()
    scripts = []

    async def slow_script(omc, folder, body, timeout):
        scripts.append(body)
        await asyncio.sleep(0.2)
        return 0, 'true\n""\n'

    monkeypatch.setattr(backend, 'script', slow_script)

    async def both():
        return await asyncio.gather(backend.library_ready(engines.Path('/omc')), backend.library_ready(engines.Path('/omc')))

    assert asyncio.run(both()) == [True, True]
    assert len(scripts) == 1, 'MSL is loaded once, not once per caller'
