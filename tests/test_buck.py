"""Verify the switched electrical network against steady-state buck relations."""
import asyncio
import csv
from pathlib import Path
import uuid
import pytest
from server.models import Project
from server.modelica import emit_project
from server.engine import RUNS, simulate

FIXTURE = Path(__file__).parents[1]/'models/examples/buck.json'

def buck():
    return Project.model_validate_json(FIXTURE.read_text(encoding='utf-8'))

def test_buck_uses_actual_zero_loss_switches_and_complementary_gate_events():
    source = emit_project(buck())
    assert source.count('Modelica.Electrical.Analog.Ideal.IdealClosingSwitch') == 2
    assert source.count('Goff=(0), Ron=(0)') == 2
    assert 'Modelica.Electrical.PowerConverters.DCDC.Control.SignalPWM' in source
    assert 'connect(pwm.notFire, lowSide.control)' in source

@pytest.mark.integration
def test_buck_settles_to_duty_times_input_with_real_switching_ripple():
    async def run():
        base = buck()
        lower = buck()
        next(p for b in lower.blocks if b.id == 'duty' for p in b.definition.parameters if p.id == 'value').value = .25
        results = await asyncio.gather(*[simulate(model,'buck'+uuid.uuid4().hex[:12]) for model in [base, lower]])
        for result, duty in zip(results, [.5, .25]):
            with (RUNS/result['id']/'simulation_res.csv').open(encoding='utf-8') as stream:
                rows = list(csv.DictReader(stream))
            tail = [row for row in rows if .019 - 1e-12 <= float(row['time']) <= .02 + 1e-12]
            times = [float(row['time']) for row in tail]
            def values(key): return [float(row[key]) for row in tail]
            def mean(key):
                v = values(key)
                return sum((b-a)*(x+y)/2 for a,b,x,y in zip(times,times[1:],v,v[1:]))/(times[-1]-times[0])
            voltage, current = values('voltageProbe.v'), values('current.i')
            assert mean('voltageProbe.v') == pytest.approx(24*duty, abs=.02)
            assert mean('current.i') == pytest.approx(2.4*duty, abs=.02)
            assert mean('pwm.fire') == pytest.approx(duty, abs=.001)
            assert all(h in {0,1} and l == 1-h for h,l in zip(values('pwm.fire'), values('pwm.notFire')))
            expected_di = 24*(1-duty)*duty/(.001*10000)
            assert max(current)-min(current) == pytest.approx(expected_di, rel=.1)
            assert .03 < max(voltage)-min(voltage) < .1
            assert float(rows[0]['voltageProbe.v']) == pytest.approx(0)
            assert result['time'][-1] == pytest.approx(.02, abs=1e-10)
            traces = {s['key']:s['values'] for s in result['series']}
            assert all(len(s['values']) == len(result['time']) for s in result['series'])
            assert all(h+l == 1 for h,l in zip(traces['pwm.fire'], traces['pwm.notFire']))
            print(f"D={duty}: Vmean={mean('voltageProbe.v'):.6f} V, Imean={mean('current.i'):.6f} A, Vpp={max(voltage)-min(voltage):.6f} V, Ipp={max(current)-min(current):.6f} A")
    asyncio.run(run())
