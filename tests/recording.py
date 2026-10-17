# SPDX-License-Identifier: Apache-2.0
"""Test helper: log every block output, so an engine test can read any output's series.

Results records only what a model logs (server/engine.py `recorded_series`); tests that
check many outputs log them all, as **Log all block outputs** does in the workbench."""
from server.models import Project


def log_outputs(project: Project) -> Project:
    project = project.model_copy(deep=True)
    for sheet in [project, *(project.subsystems or [])]:
        for block in sheet.blocks:
            d = block.definition
            # As Log all block outputs: not subsystem ports or tags, which are joined away.
            if d.boundary is not None or d.kind in {'goto', 'from', 'connectionLabel'}:
                continue
            outputs = [p.id for p in d.ports if p.direction == 'output']
            if outputs:
                block.logged = outputs
    return project


def unlogged(project: Project) -> Project:
    """The same model logging nothing, for tests whose stand-in engine writes no outputs."""
    project = project.model_copy(deep=True)
    for sheet in [project, *(project.subsystems or [])]:
        for block in sheet.blocks:
            block.logged = None
        for net in sheet.nets or []:
            net.logged = False
    return project


def raw(result: dict, key: str) -> list[float]:
    """A variable's full samples from a run's engine output, logged or not (the run folder
    keeps every variable; Results lists only what was logged)."""
    import csv
    from server.engine import RUNS, result_columns
    folder = RUNS/result['id']
    with (folder/'simulation_res.csv').open(encoding='utf-8') as stream:
        rows = list(csv.DictReader(stream))
    values = result_columns(folder, rows)(key)
    if values is None:
        raise KeyError(key)
    return values
