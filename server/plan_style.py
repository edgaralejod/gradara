# SPDX-License-Identifier: Apache-2.0
"""How the AI writes plans and answers: short, direct, ASD-STE100 style.

``RULES`` goes into every planner prompt that returns text for the user (edit
and model plans, Discuss model answers). ``problems`` checks text against the
measurable part of those rules; the tests run it over recorded planner output
when the prompt changes. It never fails a generation at run time: the schema's
length limits do that, and a plan that is a little wordy is still a plan.
"""
from __future__ import annotations

import re

MAX_STEPS = 8
STEP_WORDS = 20
TEXT_WORDS = 25

RULES = f'''Write every text field for the user in ASD-STE100 Simplified Technical English style:
- One instruction per sentence. Start each step with a verb in the imperative: Add, Connect, Set, Replace, Rewrite, Remove, Log, Group, Create, Run.
- Active voice, present tense. Do not use "should", "may", "might", "could", "would", or "please".
- At most {STEP_WORDS} words in a step and {TEXT_WORDS} words in any other sentence. At most 3 nouns in a row.
- Name blocks by their name on the canvas and parameters by name, value, and unit (Set R1 resistance to 10 ohm).
- No filler: no "I will", "Let's", "First,", or restating the request.
steps are the plan for the user: at most {MAX_STEPS}, in the order they happen, one per distinct change (group repeated small changes into one step). They must describe the same change as the operations.'''

MODALS = ('should', 'may', 'might', 'could', 'would', 'please')
FILLER = ("i will", "i'll", "let's", "let us", "we will", "first,", "next,", "finally,")
_SENTENCE = re.compile(r'(?<=[.!?])\s+')
_WORD = re.compile(r"[A-Za-z0-9][\w'./%-]*")


def sentences(text: str) -> list[str]:
    return [s for s in _SENTENCE.split(text.strip()) if s]


def words(text: str) -> list[str]:
    return _WORD.findall(text)


def problems(text: str, *, step: bool = False) -> list[str]:
    """Where ``text`` breaks the measurable rules (empty when it follows them)."""
    found = []
    limit = STEP_WORDS if step else TEXT_WORDS
    lower = text.lower()
    for sentence in sentences(text):
        count = len(words(sentence))
        if count > limit:
            found.append(f'{count} words (at most {limit}): "{sentence[:60]}"')
    for modal in MODALS:
        if re.search(rf'\b{modal}\b', lower):
            found.append(f'uses "{modal}"')
    for phrase in FILLER:
        if lower.startswith(phrase) or f' {phrase}' in lower:
            found.append(f'filler "{phrase}"')
    if step:
        first = (words(text) or [''])[0]
        if first.lower().endswith('ing') or first.lower() in ('the', 'a', 'an', 'this', 'it', 'we', 'i'):
            found.append(f'does not start with an imperative verb: "{first}"')
        if len(sentences(text)) > 1:
            found.append('more than one sentence in a step')
    return found


def plan_problems(steps: list[str], texts: list[str] = ()) -> list[str]:
    """Problems of a whole plan: its steps and its other user-facing text."""
    found = [f'{len(steps)} steps (at most {MAX_STEPS})'] if len(steps) > MAX_STEPS else []
    for index, step in enumerate(steps, 1):
        found += [f'step {index}: {p}' for p in problems(step, step=True)]
    for text in texts:
        found += problems(text)
    return found
