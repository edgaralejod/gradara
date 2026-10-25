# SPDX-License-Identifier: Apache-2.0
"""Discuss model: the planner answers questions about the open design and changes nothing.

One question is one priced job and one planner call (task ``discuss``). The
prompt carries the model without layout (as an edit's does), the sheet being
looked at, the selected blocks, the catalog, and the last few questions and
answers of this model's discussion, so a follow-up reads naturally. The answer
names the blocks it talks about, which Gradara keeps only when they exist, and
may suggest one change, which the user can send to Edit model.
"""
from __future__ import annotations

import json
from typing import ClassVar

from pydantic import Field

from . import agent
from .llm import dispatch, structured
from .model_agent import Strict, catalog_snapshot, describe
from .model_edit import semantic_view
from .models import Definition, Project
from .paths import DATA
from .plan_style import STYLE
from .sheets import sheet_name, subsystem_at

MAX_TURNS = 4


class Turn(Strict):
    """An earlier question in this model's discussion and the answer the user saw."""
    question: str = Field(max_length=4000)
    answer: str = Field(max_length=3000)


class DiscussRequest(Strict):
    question: str = Field(min_length=3, max_length=4000)
    project: Project
    catalog: list[Definition] = Field(min_length=1, max_length=300)
    selection: list[str] = Field(default_factory=list, max_length=200)
    # The sheet the user is looking at: a path of subsystem instance IDs, empty for the top level.
    sheet: list[str] = Field(default_factory=list, max_length=20)
    thread: list[Turn] = Field(default_factory=list, max_length=MAX_TURNS)


class Discussion(Strict):
    prose: ClassVar = {'answer', 'suggestedEdit'}
    answer: str = Field(max_length=2000)
    # Blocks the answer talks about, so the card can select them.
    blockIds: list[str] = Field(max_length=12)
    # One change worth making, written as a request to Edit model; empty when the answer suggests none.
    suggestedEdit: str = Field(max_length=600)


INSTRUCTIONS = '''You discuss an existing Gradara model with its engineer. Gradara is a graphical simulation workbench on Modelica and OpenModelica. Return only schema JSON; do not use tools.
Answer the question about this design: whether something works, why it behaves as it does, what a block or parameter does, or how to approach a change. You change nothing. Base the answer on the model below and on physics; say plainly when the answer needs a simulation run to confirm, and say what to log or look at.
answer: at most 8 sentences. Name blocks by their canvas name and give values with units. Use paragraphs separated by a blank line when the answer has distinct parts.
blockIds: IDs of the blocks the answer talks about (at most 12), from the model below.
suggestedEdit: when one concrete change to the model would help, write it as a request to Gradara's model editor, for example "Set R1 resistance to 10 ohm." or "Add a speed sensor on the load shaft and log its output." Otherwise empty. Never suggest a change the question did not lead to.
''' + STYLE


def discuss_prompt(request: DiscussRequest, catalog: dict[str, Definition]) -> str:
    project = request.project
    ref = subsystem_at(project, request.sheet) if request.sheet else None
    parts = [INSTRUCTIONS]
    if request.thread:
        parts.append('\nEarlier in this discussion:\n' + '\n'.join(
            f'Q: {turn.question}\nA: {turn.answer}' for turn in request.thread[-MAX_TURNS:]))
    parts.append('\nQuestion:\n' + request.question)
    names = {b.id: b.definition.name for sheet in [project, *(project.subsystems or [])] for b in sheet.blocks}
    selection = [f'{names[i]} ({i})' for i in request.selection if i in names]
    if selection:
        parts.append('\nSelected blocks (the question most likely concerns these):\n' + ', '.join(selection))
    if ref:
        parts.append(f'\nThe engineer is looking inside the subsystem "{sheet_name(project, request.sheet)}" '
                     f'(definition {ref} in "subsystems").')
    parts.append('\nModel (layout omitted):\n' + json.dumps(semantic_view(project)))
    parts.append('\nBlocks available in the library:\n' + describe(catalog))
    return '\n'.join(parts)


def known_blocks(project: Project) -> set[str]:
    return {b.id for sheet in [project, *(project.subsystems or [])] for b in sheet.blocks}


async def discuss(request: DiscussRequest, job_id: str, progress=lambda message, **extra: None) -> dict:
    progress('Reading the model')
    catalog = catalog_snapshot(request, DATA)
    discussion = await structured.generate(discuss_prompt(request, catalog), Discussion, f'{job_id}-discuss',
                                           task='discuss')
    blocks = known_blocks(request.project)
    result = {
        'answer': discussion.answer.strip(),
        'blockIds': list(dict.fromkeys(i for i in discussion.blockIds if i in blocks)),
        'suggestedEdit': discussion.suggestedEdit.strip(),
        'provider': agent.provider_label(),
    }
    credits = dispatch.credits_for_current_job()
    return result | {'credits': credits} if credits is not None else result
