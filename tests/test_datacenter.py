# SPDX-License-Identifier: Apache-2.0
"""Energy conservation and control response in the lumped cooling example."""
import asyncio
import csv
from pathlib import Path
import uuid

import pytest
from pydantic import ValidationError
from server.models import Project
from server.engine import RUNS, simulate

FIXTURE = Path(__file__).parents[1]/'models/examples/datacenter.json'


def example():
    return Project.model_validate_json(FIXTURE.read_text(encoding='utf-8'))


def parameter(project, block, name, value):
    next(p for b in project.blocks if b.id == block
         for p in b.definition.parameters if p.id == name).value = value


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
        # Freeze the integral at the same baseline bias: a P-only comparison.
        parameter(proportional, 'controller', 'integralTime', 1e12)
        undersized = example()
        parameter(undersized, 'cooling', 'ratedCooling', 800000)
        parameter(undersized, 'controller', 'initialCommand', .75)
        parameter(undersized, 'cooling', 'derateStart', 7200)
        parameter(undersized, 'cooling', 'derateEnd', 7500)
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
            for row in rows:
                # Integral balance includes both thermal stores, not just final power.
                stored = row['rack.energy']+row['room.energy']
                assert stored == pytest.approx(
                    row['it.energy']-row['cooling.removedEnergy'], abs=50)
                assert row['ambient.kW'] == pytest.approx(
                    row['cooling.coolkW']+row['cooling.kW'], abs=1e-6)
                electrical = -800*row['supply.p.i']/1000
                assert electrical == pytest.approx(row['it.kW']+row['cooling.kW'], abs=1e-6)
                assert row['cooling.coolkW'] == pytest.approx(4*row['cooling.kW'], abs=1e-6)
                assert -.000001 <= row['controller.u'] <= 1.000001
            peak = max(row['room.degC'] for row in rows)
            print(f"{result['id']}: room peak={peak:.4f} C; "
                  f"room final={rows[-1]['room.degC']:.4f} C; "
                  f"cooling electricity={rows[-1]['cooling.kW']:.4f} kW")
        rows = records[0]
        initial = [r for r in rows if r['time'] < 590]
        assert max(abs(r['room.degC']-24) for r in initial) < .001
        assert rows[-1]['room.degC'] == pytest.approx(24, abs=.1)
        assert rows[-1]['rack.degC'] == pytest.approx(33, abs=.1)
        assert rows[-1]['cooling.kW'] == pytest.approx(225, abs=1)
        before = min(rows, key=lambda r: abs(r['time']-1790))
        during = min(rows, key=lambda r: abs(r['time']-2090))
        assert during['room.degC'] > before['room.degC']+2
        assert during['cooling.coolkW'] == pytest.approx(600, abs=.1)
        assert records[1][-1]['room.degC'] > rows[-1]['room.degC']+2
        assert records[2][-1]['room.degC'] > 28
        assert records[2][-1]['controller.u'] == pytest.approx(1)
    asyncio.run(run())
