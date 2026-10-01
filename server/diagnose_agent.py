# SPDX-License-Identifier: Apache-2.0
"""Explain run and model problems, and optionally propose a checked fix through the edit pipeline."""
import json
from typing import ClassVar
from pydantic import Field
from . import agent
from .diagnostics import Diagnostic
from .llm import dispatch, structured
from .model_agent import Strict
from .model_edit import ModelEditRequest, Unsupported, edit_model, semantic_view
from .models import Definition, Project
from .paths import RUNS


class DiagnoseRequest(Strict):
    project: Project
    diagnostics: list[Diagnostic] = Field(min_length=1, max_length=50)
    runId: str | None = Field(default=None, max_length=80)
    catalog: list[Definition] = Field(min_length=1, max_length=300)
    question: str | None = Field(default=None, max_length=2000)
    proposeFix: bool = False


class Cause(Strict):
    prose: ClassVar = {'explanation'}
    diagnosticIds: list[str] = Field(max_length=50)
    blockIds: list[str] = Field(max_length=50)
    explanation: str = Field(max_length=1200)


class Diagnosis(Strict):
    # Free text a model may overrun: cut to fit rather than fail (llm/structured.py).
    prose: ClassVar = {'summary', 'causes', 'manualSteps', 'editPrompt'}
    summary: str = Field(max_length=800)
    causes: list[Cause] = Field(max_length=10)
    fixable: bool
    manualSteps: list[str] = Field(max_length=8)
    editPrompt: str | None = Field(default=None, max_length=4000)


def run_context(request: DiagnoseRequest) -> dict | None:
    """Source and solver text of a failed run, only when it belongs to the same document."""
    run_id = request.runId
    if not run_id or not run_id.isalnum():
        return None
    folder = RUNS/run_id
    try:
        snapshot = json.loads((folder/'project.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if not request.project.modelId or snapshot.get('modelId') != request.project.modelId:
        return None
    context = {'source': ''}
    try:
        context['source'] = (folder/'model.mo').read_text(encoding='utf-8')[-12000:]
    except OSError:
        pass
    try:
        saved = json.loads((folder/'diagnostics.json').read_text(encoding='utf-8'))
        context['solver'] = '\n\n'.join(d.get('detail', '') for d in saved.get('diagnostics', []))[-8000:]
    except (OSError, ValueError):
        context['solver'] = ''
    return context


INSTRUCTIONS = '''You diagnose problems in a Gradara simulation model. Return only schema JSON; do not use tools.
Explain what is wrong in plain engineering terms, starting with the most likely cause. Refer to blocks by their IDs in blockIds and by their names in text.
Each cause lists the diagnostic IDs it explains and the blocks involved.
Set fixable to true only when the problem can be fixed by editing the model: adding, removing, or renaming blocks, changing parameters or the stop time, rewriting a block's equations, or connecting and disconnecting ports.
When fixable, editPrompt is a self-contained instruction for the model editor that names the exact blocks, parameters, and values to change; otherwise editPrompt is null.
manualSteps are short things the user can do or check themselves. Do not claim to have run a simulation.'''


def diagnose_prompt(request: DiagnoseRequest, context: dict | None) -> str:
    problems = [d.model_dump(exclude={'detail'}) | {'detail': d.detail[-2000:]} for d in request.diagnostics]
    parts = [INSTRUCTIONS]
    if request.question:
        parts.append('\nUser question:\n' + request.question)
    parts.append('\nProblems:\n' + json.dumps(problems))
    parts.append('\nModel (layout omitted):\n' + json.dumps(semantic_view(request.project)))
    if context:
        if context.get('solver'):
            parts.append('\nSolver output from the failed run:\n' + context['solver'])
        if context.get('source'):
            parts.append('\nEmitted Modelica source of the failed run:\n' + context['source'])
    return '\n'.join(parts)


def clean(diagnosis: Diagnosis, request: DiagnoseRequest) -> Diagnosis:
    blocks = {b.id for b in request.project.blocks}
    ids = {d.id for d in request.diagnostics}
    for cause in diagnosis.causes:
        cause.blockIds = [i for i in cause.blockIds if i in blocks]
        cause.diagnosticIds = [i for i in cause.diagnosticIds if i in ids]
    if not diagnosis.fixable:
        diagnosis.editPrompt = None
    return diagnosis


async def diagnose(request: DiagnoseRequest, job_id: str, progress=lambda message: None):
    progress('Reading the problems')
    context = run_context(request)
    diagnosis = clean(await structured.generate(diagnose_prompt(request, context), Diagnosis,
                                                f'{job_id}-diagnose', task='diagnose'), request)
    result = {'diagnosis': diagnosis.model_dump(), 'proposal': None, 'provider': agent.provider_label()}
    if not (request.proposeFix and diagnosis.fixable and diagnosis.editPrompt):
        return with_credits(result)
    selection = list(dict.fromkeys(i for c in diagnosis.causes for i in c.blockIds))
    evidence = '\n'.join(f'- {d.message}' + (f' (hint: {d.hint})' if d.hint else '') for d in request.diagnostics)
    edit = ModelEditRequest(prompt=diagnosis.editPrompt, project=request.project, catalog=request.catalog,
                            selection=selection, verify=True,
                            context=('Problems being fixed:\n' + evidence + '\n\nDiagnosis:\n' + diagnosis.summary)[-6000:])
    try:
        with dispatch.job_part('edit'):
            result['proposal'] = await edit_model(edit, f'{job_id}fix', progress)
    except (Unsupported, ValueError) as exc:
        result['fixError'] = str(exc)[-1500:]
    return with_credits(result)


def with_credits(result: dict) -> dict:
    credits = dispatch.credits_for_current_job()
    return result | {'credits': credits} if credits is not None else result
