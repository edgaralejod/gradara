# SPDX-License-Identifier: Apache-2.0
"""Energy conservation and control response in the data-center cooling example."""
import asyncio
import csv
from pathlib import Path
import uuid

import pytest
from pydantic import ValidationError
from server.models import Project
from server.engine import RUNS, simulate

FIXTURE = Path(__file__).parents[1]/'models/examples/datacenter.json'
RACK_C, ROOM_C = 20e6, 10e6  # J/K, as built by scripts/build-datacenter-example.ts


def example():
    return Project.model_validate_json(FIXTURE.read_text(encoding='utf-8'))


def parameter(project, block, name, value):
    """Set a parameter of block `block` anywhere in the model (IDs are unique across sheets)."""
    sheets = [project, *(project.subsystems or [])]
    next(p for s in sheets for b in s.blocks if b.id == block
         for p in b.definition.parameters if p.id == name).value = value


def test_example_uses_library_blocks_in_three_subsystems():
    project = example()
    assert {b.id for b in project.blocks if b.definition.subsystem} == {'it', 'cooling', 'control'}
    blocks = [b for s in [project, *project.subsystems] for b in s.blocks]
    assert not any(b.definition.generated for b in blocks)


def test_long_manual_runs_remain_bounded():
    data = example().model_dump()
    assert Project.model_validate({**data, 'duration': 86400}).duration == 86400
    for duration in (0, -1, 86401, float('inf'), float('nan')):
        with pytest.raises(ValidationError):
            Project.model_validate({**data, 'duration': duration})


@pytest.mark.integration
def test_cooling_conserves_energy_and_pi_recovers_better_than_proportional():
    async def run():
        controlled = example()
        proportional = example()
        parameter(proportional, 'pi', 'ki', 1e-12)  # P only, around the same 0.5 bias
        undersized = example()
        parameter(undersized, 'capacity', 'k', 800)
        parameter(undersized, 'bias', 'value', .75)
        parameter(undersized, 'outage', 'startTime', 7200)
        results = await asyncio.gather(*[
            simulate(project, 'datacenter-test-'+uuid.uuid4().hex[:10])
            for project in (controlled, proportional, undersized)
        ])
        records = []
        for result in results:
            with (RUNS/result['id']/'simulation_res.csv').open(encoding='utf-8') as stream:
                rows = [{key: float(value) for key, value in row.items()}
                        for row in csv.DictReader(stream)]
            rows = [row for row in rows if row['time'] <= 3600+1e-8]
            records.append(rows)
            assert result['time'][-1] == pytest.approx(3600)
            net = 0.0
            for a, b in zip(rows, rows[1:]):
                net += (b['time']-a['time'])*1000*(a['it.itKW.y']+b['it.itKW.y']-a['cooling.capacity.y']-b['cooling.capacity.y'])/2
            last = rows[-1]
            stored = RACK_C*(last['rack.T']-303.15)+ROOM_C*(last['room.T']-297.15)
            # Heat stored in rack and room is IT heat in minus heat removed.
            assert stored == pytest.approx(net, abs=2e6)
            for row in rows[::20]:
                assert row['cooling.rejected.y'] == pytest.approx(row['cooling.capacity.y']+row['cooling.electric.y'], abs=1e-6)
                electrical = -800*row['supply.p.i']/1000
                # The load switch's 10 µΩ drops about 1.4 W that is not IT heat.
                assert electrical == pytest.approx(row['it.itKW.y']+row['cooling.electric.y'], abs=.01)
                assert row['cooling.capacity.y'] == pytest.approx(4*row['cooling.electric.y'], abs=1e-6)
        rows = records[0]
        for row in rows[::20]:
            assert -1e-6 <= row['control.command.y'] <= 1+1e-6
        initial = [r for r in rows if r['time'] < 590]
        assert max(abs(r['roomC.y']-24) for r in initial) < .001
        assert rows[-1]['roomC.y'] == pytest.approx(24, abs=.1)
        assert rows[-1]['rackC.y'] == pytest.approx(33, abs=.1)
        assert rows[-1]['cooling.electric.y'] == pytest.approx(225, abs=1)
        before = min(rows, key=lambda r: abs(r['time']-1790))
        during = min(rows, key=lambda r: abs(r['time']-2090))
        assert during['roomC.y'] > before['roomC.y']+2
        assert during['cooling.capacity.y'] == pytest.approx(600, abs=.1)
        assert records[1][-1]['roomC.y'] > rows[-1]['roomC.y']+2
        assert records[2][-1]['roomC.y'] > 28
        assert records[2][-1]['cooling.limit.y'] == pytest.approx(1)
    asyncio.run(run())
