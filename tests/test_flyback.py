# SPDX-License-Identifier: Apache-2.0
"""The flyback example must switch, start from zero, and regulate its real load."""
import asyncio
import csv
import json
from pathlib import Path
import uuid
import pytest
from server.models import Project
from server.engine import RUNS, simulate


def test_flyback_template_has_explicit_energy_storage_and_physical_ports():
    project = Project.model_validate(json.loads((Path(__file__).parents[1]/'models/examples/flyback.json').read_text()))
    blocks = {block.id: block for block in project.blocks}
    assert blocks['mag'].definition.kind == 'inductor'
    assert len([p for p in blocks['xfmr'].definition.ports if p.direction == 'physical']) == 4
    assert blocks['sw'].definition.generated
    assert all(blocks[key].definition.generated for key in ['d1','d2','d3','d4','rect'])


@pytest.mark.integration
def test_flyback_switching_startup_and_regulation():
    project = Project.model_validate(json.loads((Path(__file__).parents[1]/'models/examples/flyback.json').read_text()))
    result = asyncio.run(simulate(project, 'flybacktest'+uuid.uuid4().hex[:10]))
    with (RUNS/result['id']/'simulation_res.csv').open() as stream:
        rows = list(csv.DictReader(stream))
    rows = [row for row in rows if float(row['time']) <= project.duration + 1e-12]
    assert float(rows[0]['vout.y']) == pytest.approx(0, abs=1e-5)
    tail = [row for row in rows if .25 <= float(row['time']) <= .3]
    volts = [float(row['vout.y']) for row in tail]
    assert 23.9 < min(volts) <= max(volts) < 24.1
    assert max(volts)-min(volts) < .05
    assert max(float(row['vout.y']) for row in rows) < 24.5
    assert 660 < float(tail[-1]['vbus.y']) < 680
    assert .65 < max(float(row['ip.y']) for row in tail) < .8
    assert 800 < max(float(row['vsw.y']) for row in tail) < 920
    gates = [float(row['pwm.gate']) for row in tail]
    assert min(gates) == 0 and max(gates) == 1
    assert sum(a < .5 and b > .5 for a,b in zip(gates,gates[1:])) >= 2400
    assert all(float(row['pwm.gate']) == 0 for row in rows if float(row['time']) < .03-1e-12)
