# SPDX-License-Identifier: Apache-2.0
"""Local API boundary, settings, credentials, and safety screening."""
import pytest
from fastapi.testclient import TestClient

from server import app as service
from server import credentials, settings
from server.models import Definition
from server.safety import UnsafeDefinition, check_definition


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'SETTINGS_FILE', tmp_path/'settings.json')
    monkeypatch.setattr(credentials, 'FALLBACK', tmp_path/'.credentials.json')
    monkeypatch.setenv('GRADARA_CREDENTIAL_STORE', 'file')
    monkeypatch.delenv('GRADARA_AI_PROVIDER', raising=False)
    return tmp_path


def test_foreign_host_and_origin_are_refused(isolated):
    client = TestClient(service.app)
    assert client.get('/api/ai', headers={'Host': 'evil.example:8765'}).status_code == 403
    assert client.get('/api/ai', headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.get('/api/ai', headers={'Origin': 'http://localhost:4317'}).status_code == 200
    # The installed app serves the workbench itself, on whatever port it was given.
    same = {'Host': '127.0.0.1:40123', 'Origin': 'http://127.0.0.1:40123'}
    assert client.get('/api/ai', headers=same).status_code == 200
    assert client.get('/api/ai', headers={'Host': '127.0.0.1:40123', 'Origin': 'http://127.0.0.1:40999'}).status_code == 403


def test_mutations_need_the_client_header(isolated):
    client = TestClient(service.app)
    assert client.put('/api/ai', json={'provider': 'off'}).status_code == 403
    response = client.put('/api/ai', json={'provider': 'off'}, headers={'X-Gradara-Client': 'workbench'})
    assert response.status_code == 200 and response.json()['provider'] == 'off'


def test_keys_never_leave_the_service(isolated, monkeypatch):
    async def accept(name, key):
        return None
    monkeypatch.setattr(service, 'verify_key', accept)
    client = TestClient(service.app, headers={'X-Gradara-Client': 'workbench'})
    secret = 'sk-test-abcdefghijklmnop'
    response = client.put('/api/ai/keys/openai', json={'key': secret})
    assert response.status_code == 200 and response.json()['keys']['openai'] is True
    assert secret not in response.text
    assert secret not in (isolated/'settings.json').read_text(encoding='utf-8') if (isolated/'settings.json').exists() else True
    assert credentials.get('openai_api_key') == secret
    assert oct((isolated/'.credentials.json').stat().st_mode & 0o777) == '0o600'
    client.delete('/api/ai/keys/openai')
    assert credentials.get('openai_api_key') is None


def test_provider_errors_become_readable_http_errors(isolated, monkeypatch):
    from server.llm.providers import ProviderError

    async def reject(name, key):
        raise ProviderError('OpenAI rejected the API key.', 401)
    monkeypatch.setattr(service, 'verify_key', reject)
    client = TestClient(service.app, headers={'X-Gradara-Client': 'workbench'})
    response = client.put('/api/ai/keys/openai', json={'key': 'sk-bad-key-123'})
    assert response.status_code == 401 and 'rejected' in response.json()['detail']


def test_account_without_sign_in(isolated):
    client = TestClient(service.app)
    assert client.get('/api/account').json() == {'signedIn': False}


def gain(equations='y = k*u;', declarations=''):
    return Definition.model_validate({
        'kind': 'gain', 'name': 'Gain', 'description': '', 'domain': 'signal', 'symbol': 'K',
        'ports': [{'id': 'u', 'name': 'u', 'direction': 'input', 'domain': 'signal'},
                  {'id': 'y', 'name': 'y', 'direction': 'output', 'domain': 'signal'}],
        'parameters': [{'id': 'k', 'name': 'k', 'value': 2, 'unit': ''}],
        'declarations': declarations, 'equations': equations})


@pytest.mark.parametrize('equations', [
    'y = Modelica.Utilities.System.command("rm -rf ~");',
    'y = k*u; annotation(Library="evil");',
    'y = f(u);\nexternal "C" y = system(u);',
    'y = u; import Modelica.Utilities.Files;',
])
def test_unsafe_equations_are_rejected_even_if_schema_validation_was_bypassed(equations):
    # Documents are validated on load; the compiler-side screen is defense in depth
    # for any path that constructs definitions without validation.
    unsafe = gain().model_copy(update={'equations': equations})
    with pytest.raises(UnsafeDefinition):
        check_definition(unsafe)


def test_ordinary_equations_pass():
    check_definition(gain('der(x) = u - x;\ny = x;', 'Real x(start=0, fixed=true);'))
    check_definition(gain().model_copy(update={'equations': '// external notes in a comment\ny = k*u;'}))
