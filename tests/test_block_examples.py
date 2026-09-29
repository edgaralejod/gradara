"""The block examples (models/examples/blocks/): every one loads, and every one
simulates to the results its manifest promises. Together they run every library
block in a working model, so a block that stops compiling or starts producing a
wrong answer fails here."""
import asyncio
import bisect
import csv
import json
from pathlib import Path
import uuid
import pytest
from server import msl
from server.engine import RUNS, result_columns, simulate
from server.models import Project

FOLDER = Path(__file__).parents[1]/'models/examples/blocks'
MANIFEST = json.loads((FOLDER/'index.json').read_text(encoding='utf-8'))['examples']
IDS = [entry['id'] for entry in MANIFEST]


def load(example_id: str) -> Project:
    return Project.model_validate_json((FOLDER/f'{example_id}.json').read_text(encoding='utf-8'))


def test_manifest_lists_exactly_the_example_files():
    files = {p.stem for p in FOLDER.glob('*.json')} - {'index'}
    assert files == set(IDS)
    assert len(IDS) == len(set(IDS))


@pytest.mark.parametrize('example_id', IDS)
def test_example_is_a_valid_document(example_id):
    project = load(example_id)
    assert project.exampleId == f'block-{example_id}'
    assert project.plots


def column(project: Project, signal: str) -> str:
    """The solver-output column for `block.port`, or a raw variable after `=`."""
    if signal.startswith('='):
        return signal[1:]
    block_id, port = signal.split('.', 1)
    block = next(b for b in project.blocks if b.id == block_id)
    return f'{block_id}.{msl.connector(block.definition, port)}'


def sample(times, values, at):
    """The value at `at`: the last sample at or before it (right after any event)."""
    i = bisect.bisect_right(times, at + 1e-9) - 1
    return values[max(i, 0)]


def average(times, values, t0, t1):
    """Time average over [t0, t1] by the trapezoid rule on the solver's samples."""
    area = span = 0.0
    for a, b, x, y in zip(times, times[1:], values, values[1:]):
        lo, hi = max(a, t0), min(b, t1)
        if hi <= lo:
            continue
        area += (hi - lo) * (x + y) / 2
        span += hi - lo
    return area / span


@pytest.mark.integration
@pytest.mark.parametrize('example_id', IDS)
def test_example_simulates_to_its_expected_results(example_id):
    project = load(example_id)
    entry = next(e for e in MANIFEST if e['id'] == example_id)
    result = asyncio.run(simulate(project, 'example' + uuid.uuid4().hex[:12]))
    with (RUNS/result['id']/'simulation_res.csv').open(encoding='utf-8') as stream:
        rows = list(csv.DictReader(stream))
    times = [float(r['time']) for r in rows]
    lookup = result_columns(RUNS/result['id'], rows)
    problems = []
    for check in entry['checks']:
        key = column(project, check['signal'])
        values = lookup(key)
        assert values is not None, f'{example_id}: no result column {key}'
        where = f"{check['signal']} ({check['why']})"
        if 'mean' in check:
            t0, t1 = check['mean']
            got = average(times, values, t0, t1)
            if abs(got - check['value']) > check.get('tol', 1e-6):
                problems.append(f"{where}: mean {got:.6g} over {t0:g}–{t1:g} s, expected {check['value']:.6g} ± {check.get('tol', 1e-6):g}")
        elif 'value' in check:
            at = check.get('at', times[-1])
            got = sample(times, values, at)
            if abs(got - check['value']) > check.get('tol', 1e-6):
                problems.append(f"{where}: {got:.6g} at {at:g} s, expected {check['value']:.6g} ± {check.get('tol', 1e-6):g}")
        else:
            span = [sample(times, values, check['at'])] if 'at' in check else values
            low, high = min(span), max(span)
            if 'min' in check and low < check['min']:
                problems.append(f"{where}: minimum {low:.6g} below {check['min']:.6g}")
            if 'max' in check and high > check['max']:
                problems.append(f"{where}: maximum {high:.6g} above {check['max']:.6g}")
    assert not problems, f'{example_id}:\n' + '\n'.join(problems)


def test_result_columns_fill_outputs_that_equal_a_parameter(tmp_path):
    # OpenModelica leaves parameter aliases out of the CSV; the engine reads them from
    # simulation_init.xml so a voltmeter across a DC source still has a trace.
    (tmp_path/'simulation_init.xml').write_text('''<fmiModelDescription><ModelVariables>
      <ScalarVariable name="src.V" variability="parameter" alias="noAlias"><Real start="12.0" fixed="true"/></ScalarVariable>
      <ScalarVariable name="v.y" variability="continuous" alias="alias" aliasVariable="src.V"><Real/></ScalarVariable>
      <ScalarVariable name="neg.y" variability="continuous" alias="negatedAlias" aliasVariable="x"><Real/></ScalarVariable>
      <ScalarVariable name="bound" variability="parameter" alias="noAlias"><Real start="3.0" fixed="false"/></ScalarVariable>
    </ModelVariables></fmiModelDescription>''', encoding='utf-8')
    rows = [{'time': '0', 'x': '1'}, {'time': '1', 'x': '2'}]
    column = result_columns(tmp_path, rows)
    assert column('x') == [1.0, 2.0]
    assert column('v.y') == [12.0, 12.0]
    assert column('neg.y') == [-1.0, -2.0]
    assert column('bound') is None
    assert column('missing') is None
