"""Which Docker context Gradara uses on macOS: its Colima profile, else the default runtime."""
import server.runtime as runtime


def pick(monkeypatch, *, contexts=(), default_ready=False, colima=True, explicit=None):
    runtime.docker_context.cache_clear()
    monkeypatch.setattr(runtime.platform, 'system', lambda: 'Darwin')
    monkeypatch.setattr(runtime, '_context_exists', lambda name: name in contexts)
    monkeypatch.setattr(runtime, '_default_daemon_ready', lambda: default_ready)
    monkeypatch.setattr(runtime.shutil, 'which', lambda name: '/opt/homebrew/bin/colima' if colima else None)
    monkeypatch.delenv('GRADARA_DOCKER_CONTEXT', raising=False)
    monkeypatch.delenv('FLUX_DOCKER_CONTEXT', raising=False)
    if explicit is not None:
        monkeypatch.setenv('GRADARA_DOCKER_CONTEXT', explicit)
    try:
        return runtime.docker_context()
    finally:
        runtime.docker_context.cache_clear()


def test_gradara_colima_profile_wins(monkeypatch):
    assert pick(monkeypatch, contexts=('colima-gradara',), default_ready=True) == 'colima-gradara'


def test_orbstack_or_docker_desktop_is_used_when_it_answers(monkeypatch):
    assert pick(monkeypatch, default_ready=True) == ''


def test_colima_is_offered_when_nothing_runs(monkeypatch):
    assert pick(monkeypatch) == 'colima-gradara'


def test_without_colima_the_default_context_is_used(monkeypatch):
    assert pick(monkeypatch, colima=False) == ''


def test_explicit_context_is_respected(monkeypatch):
    assert pick(monkeypatch, explicit='orbstack') == 'orbstack'
