# SPDX-License-Identifier: Apache-2.0
"""Discuss model with a fake provider: the prompt, the planner role, cleaning the answer, and pricing scope."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from server import discuss_agent as talk
from server.llm import dispatch
from server.llm.roles import role_for
from tests.test_model_edit import catalog, grouped_dc, motor

ANSWER = {'answer': 'Yes. The PI controller limits its output at 24 V, so the motor reaches 150 rad/s.\n\n'
                    'Log the motor speed to confirm it.',
          'blockIds': ['controller', 'ghost', 'controller'], 'suggestedEdit': '  Log the motor speed.  '}


def request(**fields):
    return talk.DiscussRequest(**{'question': 'Will the motor reach 150 rad/s?', 'project': motor(),
                                  'catalog': list(catalog().values()), **fields})


@pytest.fixture
def provider(monkeypatch, tmp_path):
    monkeypatch.setattr(talk, 'DATA', tmp_path)
    fake = AsyncMock(return_value=ANSWER)
    monkeypatch.setattr(talk.agent, 'structured_generation', fake)
    monkeypatch.setattr(talk.agent, 'provider_label', lambda: 'Test AI')
    return fake


def test_an_answer_keeps_only_blocks_in_the_model(provider):
    result = asyncio.run(talk.discuss(request(), 'job1'))
    assert result == {'answer': ANSWER['answer'], 'blockIds': ['controller'], 'suggestedEdit': 'Log the motor speed.',
                      'provider': 'Test AI'}
    provider.assert_awaited_once()
    assert provider.call_args.kwargs['task'] == 'discuss'
    assert role_for('discuss') == 'planner'


def test_the_prompt_carries_the_question_selection_thread_and_model(provider):
    thread = [{'question': 'What limits the speed?', 'answer': 'The 24 V supply.'}]
    asyncio.run(talk.discuss(request(selection=['controller'], thread=thread), 'job1'))
    prompt = provider.call_args.args[0]
    assert prompt.index('What limits the speed?') < prompt.index('Will the motor reach 150 rad/s?')
    assert '(controller)' in prompt and '"position"' not in prompt
    assert 'You change nothing' in prompt and 'ASD-STE100' in prompt and 'steps are' not in prompt


def test_inside_a_subsystem_the_prompt_names_it(provider):
    doc = grouped_dc()
    path = [next(b.id for b in doc.blocks if b.definition.kind == 'subsystem')]
    asyncio.run(talk.discuss(request(project=doc, sheet=path), 'job1'))
    assert 'looking inside the subsystem' in provider.call_args.args[0]


def test_the_thread_is_bounded():
    with pytest.raises(ValueError):
        request(thread=[{'question': 'q', 'answer': 'a'}] * (talk.MAX_TURNS + 1))


def test_one_question_is_one_job_of_its_own_kind(provider, monkeypatch):
    seen = []

    async def fake(prompt, schema, attempt_id, *, task, role=None):
        seen.append((dispatch.current_job.get(), task))
        return ANSWER
    monkeypatch.setattr(talk.agent, 'structured_generation', fake)

    async def run():
        dispatch.current_job.set({'id': 'job9', 'kind': 'discuss'})
        return await talk.discuss(request(), 'job9')
    asyncio.run(run())
    assert seen == [({'id': 'job9', 'kind': 'discuss'}, 'discuss')]
