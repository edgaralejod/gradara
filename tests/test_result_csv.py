# SPDX-License-Identifier: Apache-2.0
"""The CSV a run downloads as: named columns with units, and a provenance line (QA Q04)."""
import json


def test_csv_download_names_columns_and_the_run(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import app as service
    monkeypatch.setattr(service, 'RUNS', tmp_path)
    run = tmp_path/'run1234abcd'
    run.mkdir()
    (run/'simulation_res.csv').write_text('time,b_84bd.y,sensor.y,extra\n0,0.5,1,9\n1,0.75,2,9\n1.5,0.8,3,9\n', encoding='utf-8')
    (run/'result.json').write_text(json.dumps({
        'id': 'run1234abcd', 'engine': 'OpenModelica 1.27.1 (built in)', 'projectRevision': 7, 'duration': 1, 'elapsed': 2.5,
        'snapshot': {'name': 'DC motor (copy)'},
        'series': [{'key': 'b_84bd.y', 'name': 'PI controller.out', 'unit': 'V', 'blockId': 'b_84bd'},
                   {'key': 'sensor.y', 'name': 'Speed sensor.out', 'unit': 'rad/s', 'blockId': 'sensor'}],
    }), encoding='utf-8')
    with TestClient(service.app, headers={'X-Gradara-Client': 'test'}) as client:
        response = client.get('/api/results/run1234abcd/csv')
        assert response.status_code == 200
        assert response.headers['content-disposition'] == 'attachment; filename="DC-motor-copy-run1234a.csv"'
        lines = response.text.splitlines()
        assert lines[0].startswith('# Gradara ') and 'DC motor (copy)' in lines[0] and 'revision 7' in lines[0]
        assert '1 s simulated in 2.5 s' in lines[0] and 'run run1234abcd' in lines[0]
        assert lines[1] == 'time [s],PI controller.out [V],Speed sensor.out [rad/s]'
        assert lines[2] == '0,0.5,1.0'
        # Rows past the stop time (a DASSL output-grid extra) are left out; internal columns too.
        assert len(lines) == 4 and 'extra' not in response.text
        assert client.get('/api/results/nope/csv').status_code == 404
