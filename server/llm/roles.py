# SPDX-License-Identifier: Apache-2.0
"""Which model role answers each AI task.

Gradara's AI runs two roles. The **planner** reads the model and decides: it
writes edit and build plans, diagnoses, and answers questions. The **executor**
carries out a plan step that needs new text: it writes block definitions,
symbols, assemblies, and C code. Conventional code does the rest (applying
operations, routing, simulation).

The task label every call already carries picks the role, so the local service
and the Gradara AI gateway route the same task to the same role.
"""
from __future__ import annotations

ROLES = ('planner', 'executor')

TASK_ROLES = {
    'edit-plan': 'planner',
    'model-plan': 'planner',
    'diagnose': 'planner',
    'results': 'planner',
    'component': 'executor',
    'model-assembly': 'executor',
    'export': 'executor',
}


def role_for(task: str) -> str:
    """The role for ``task``; an unknown task goes to the planner (the stronger model)."""
    return TASK_ROLES.get(task, 'planner')
