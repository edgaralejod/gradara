# SPDX-License-Identifier: Apache-2.0
"""Compile inactive variants so a broken alternative shows before anyone switches to it.

Each inactive variant is checked on its own: the model with only that instance
switched is validated like a run, then compiled with OpenModelica `checkModel`
(no simulation). Variants run one at a time.
"""
from __future__ import annotations

from .diagnostics import SimulationFailure, validate_simulation
from .diagnostics import EngineUnavailable
from .engine import check_project, engine_available
from .hierarchy import variant_choices, with_variant
from .models import Project


async def check_variants(project: Project, job_id: str, progress=lambda message: None) -> dict:
    if not await engine_available():
        raise EngineUnavailable('The simulation engine is not ready, so inactive variants were not compiled.')
    results = []
    todo = [(sheet, block, v) for sheet, block in variant_choices(project)
            for v in block.definition.subsystem.variants if v.id != block.definition.subsystem.active]
    for n, (sheet, block, variant) in enumerate(todo, 1):
        label = f'{block.definition.name} [{variant.name}]'
        progress(f'Checking {label} ({n} of {len(todo)})')
        entry = {'key': f'{sheet}/{block.id}', 'sheetId': sheet, 'blockId': block.id,
                 'variantId': variant.id, 'variant': variant.name, 'name': label}
        try:
            candidate = with_variant(project, sheet, block.id, variant.id)
            validate_simulation(candidate)
            report = await check_project(candidate, f'{job_id}{n}')
            error = report.get('error')
            entry |= {'ok': not error, 'message': error or report.get('message', '')}
        except (SimulationFailure, EngineUnavailable, ValueError, RuntimeError) as exc:
            # With the engine available, a native-backend failure here is the compiler's message.
            entry |= {'ok': False, 'message': str(exc)}
        results.append(entry)
    return {'variants': results}
