# SPDX-License-Identifier: Apache-2.0
"""Explain results: the AI discusses stored runs, grounded in the run digest, never in the samples.

One question is one priced job. The model reads the digest (statistics, events,
a short envelope of each signal, differences between the shown runs) and the
model description without layout. It may ask once for a few extra local
measurements, which Gradara computes here and sends back. Before the answer is
returned, every number it quotes as evidence is computed again from the stored
data: a matching number is marked as checked, and a claim whose number does not
match is removed. A cause is presented as measured only when checked evidence
supports it; otherwise it is a hypothesis.
"""
from __future__ import annotations

import json
import re
from typing import ClassVar, Literal

from pydantic import Field

from . import agent, run_digest as rd
from .llm import dispatch, structured
from .model_agent import Strict
from .model_edit import semantic_view
from .models import Project
from .run_store import load_full

MAX_MEASUREMENTS = 4
MAX_TURNS = 4


class Turn(Strict):
    """An earlier question in this discussion and the answer the user saw."""
    question: str = Field(max_length=2000)
    answer: str = Field(max_length=3000)


class ExplainRequest(rd.DigestRequest):
    question: str = Field(min_length=3, max_length=2000)
    thread: list[Turn] = Field(default_factory=list, max_length=MAX_TURNS)


class Evidence(Strict):
    run: str = Field(max_length=1)
    signal: str = Field(max_length=300)
    metric: rd.Metric
    t0: float | None = Field(default=None, allow_inf_nan=False)
    t1: float | None = Field(default=None, allow_inf_nan=False)
    at: float | None = Field(default=None, allow_inf_nan=False)
    value: float = Field(allow_inf_nan=False)


class Finding(Strict):
    prose: ClassVar = {'text'}
    text: str = Field(max_length=400)
    evidence: list[Evidence] = Field(max_length=3)


class Cause(Strict):
    prose: ClassVar = {'text'}
    text: str = Field(max_length=500)
    kind: Literal['measured', 'hypothesis']
    blockIds: list[str] = Field(max_length=10)
    evidence: list[Evidence] = Field(max_length=3)


class Measurement(Strict):
    kind: Literal['stats', 'valueAt', 'crossings', 'correlation']
    run: str = Field(max_length=1)
    signal: str = Field(max_length=300)
    other: str | None = Field(default=None, max_length=300)
    t0: float | None = Field(default=None, allow_inf_nan=False)
    t1: float | None = Field(default=None, allow_inf_nan=False)
    at: float | None = Field(default=None, allow_inf_nan=False)
    level: float | None = Field(default=None, allow_inf_nan=False)


class ResultsAnswer(Strict):
    prose: ClassVar = {'explanation', 'nextSteps', 'missing', 'findings', 'causes'}
    explanation: str = Field(max_length=1200)
    findings: list[Finding] = Field(max_length=8)
    causes: list[Cause] = Field(max_length=5)
    nextSteps: list[str] = Field(max_length=5)
    missing: list[str] = Field(max_length=5)
    measurements: list[Measurement] = Field(max_length=MAX_MEASUREMENTS)
    changePrompt: str | None = Field(default=None, max_length=2000)


INSTRUCTIONS = '''You help an engineer understand simulation results in Gradara. Return only schema JSON; do not use tools.
You see a digest of stored runs, computed by Gradara from the full data: per signal and run the minimum and maximum with their times, the time-weighted mean and RMS, initial and final values, the steady value, ripple, settling time and overshoot, crossings, events (transients, steps, switching, clipped stretches), a short envelope ([time, min, max] buckets) that shows the waveform, differences between runs, and the parameters that differ between runs. Runs are labelled A, B, C; A is the run the user is looking at. Times are in seconds.
Answer the user's question in plain engineering terms, starting with what matters most.
Rules you must follow:
- Every number you state goes in a finding with evidence: the run label, the signal key, the metric, the window (t0, t1; null for the digest window) or the time (at, for valueAt), and the value. Gradara recomputes each one from the data and removes claims whose numbers do not match. Do not put numbers in the explanation.
- A cause is "measured" only when its evidence shows it directly. Physical reasoning that the numbers do not settle is a "hypothesis". Refer to blocks by ID in blockIds and by name in text.
- Only logged signals and block outputs in the digest exist. When the question needs a quantity that was not recorded, say so in missing, and suggest recording it (add a sensor or log the net) in nextSteps.
- If you need numbers the digest lacks, ask for at most four measurements (stats over a window, valueAt a time, crossings of a level, correlation of two signals) and leave the rest of the answer short; Gradara computes them and asks you again. Otherwise measurements is empty.
- When a change to the model would test or fix the cause, give changePrompt: a self-contained instruction for Gradara's model editor naming the blocks, parameters and values (it may also log signals). Otherwise changePrompt is null. Never claim to have run a simulation.
- Gradara's results are not certified for safety-critical use; do not present them as such.'''


def labels(request: ExplainRequest) -> dict[str, str]:
    return {rd.LABELS[i]: run_id for i, run_id in enumerate(request.runIds)}


def prompt_for(request: ExplainRequest, digest: dict, project: dict | None, measured: list[dict] | None = None) -> str:
    parts = [INSTRUCTIONS]
    for turn in request.thread[-MAX_TURNS:]:
        parts.append('\nEarlier question:\n' + turn.question + '\nYour earlier answer:\n' + turn.answer)
    parts.append('\nQuestion:\n' + request.question)
    parts.append('\nDigest:\n' + json.dumps(digest, separators=(',', ':')))
    if project is not None:
        parts.append('\nModel of run A (layout omitted):\n' + json.dumps(project, separators=(',', ':')))
    if measured is not None:
        parts.append('\nMeasurements you asked for, computed by Gradara:\n' + json.dumps(measured, separators=(',', ':'))
                     + '\nNow give your complete answer. measurements must be empty.')
    return '\n'.join(parts)


def model_view(run: dict) -> dict | None:
    """The run's own model, as diagnosis sends it: blocks, parameters and connections, no layout."""
    snapshot = run.get('snapshot')
    if not snapshot:
        return None
    try:
        return semantic_view(Project.model_validate(snapshot))
    except ValueError:
        return None


class Runs:
    """The requested runs at full resolution, by label."""

    def __init__(self, request: ExplainRequest, loader=load_full):
        self.by_label = {label: loader(run_id) for label, run_id in labels(request).items()}

    def series(self, label: str, key: str) -> tuple[list[float], list[float]] | None:
        run = self.by_label.get(label)
        if run is None:
            return None
        found = next((s for s in run['series'] if s['key'] == key), None)
        return (run['time'], found['values']) if found else None


def measure(runs: Runs, item: Measurement, window: tuple[float, float]) -> dict:
    """One requested measurement, or the reason it could not be made."""
    out = item.model_dump(exclude_none=True)
    data = runs.series(item.run, item.signal)
    if data is None:
        return out | {'error': 'No such signal in that run (it may not have been logged).'}
    time, values = data
    t0 = item.t0 if item.t0 is not None else window[0]
    t1 = item.t1 if item.t1 is not None else window[1]
    if t1 <= t0:
        return out | {'error': 'The window must run forward.'}
    if item.kind == 'valueAt':
        return out | {'value': rd.sig(rd.value_at(time, values, item.at if item.at is not None else t1))}
    if item.kind == 'stats':
        ts, vs = rd.window_of(time, values, t0, t1)
        return out | {'stats': rd.round_dict(rd.statistics(ts, vs)),
                      'steady': rd.round_dict({k: v for k, v in rd.steady_state(ts, vs).items() if v is not None})}
    if item.kind == 'crossings':
        ts, vs = rd.window_of(time, values, t0, t1)
        times = rd.crossings(ts, vs, item.level if item.level is not None else 0.0)
        return out | {'count': len(times), 'first': [rd.sig(t) for t in times[:10]]}
    other = runs.series(item.run, item.other or '')
    if other is None:
        return out | {'error': 'The second signal is not in that run.'}
    value = rd.correlation(time, values, other[0], other[1], t0, t1)
    return out | {'correlation': None if value is None else rd.sig(value, 3)}


TIME_METRICS = {'tMin', 'tMax', 'settlingTime'}


def check(evidence: Evidence, runs: Runs, window: tuple[float, float]) -> float | None:
    """The recomputed value when the quoted one matches the data, else None."""
    data = runs.series(evidence.run, evidence.signal)
    if data is None:
        return None
    time, values = data
    t0 = evidence.t0 if evidence.t0 is not None else window[0]
    t1 = evidence.t1 if evidence.t1 is not None else window[1]
    if t1 <= t0 and evidence.metric != 'valueAt':
        return None
    actual = rd.measure(time, values, evidence.metric, t0, t1, evidence.at)
    if actual is None:
        return None
    if evidence.metric in TIME_METRICS:
        tolerance = 0.02 * (t1 - t0)
    elif evidence.metric == 'overshootPercent':
        tolerance = max(1.0, 0.05 * abs(actual))
    else:
        ts, vs = rd.window_of(time, values, t0, t1)
        tolerance = max(0.02 * abs(actual), 0.005 * (max(vs) - min(vs)), 1e-12)
    return actual if abs(evidence.value - actual) <= tolerance else None


NUMBER = re.compile(r'(?<![A-Za-z_])[-+]?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?')


def verify(answer: ResultsAnswer, runs: Runs, window: tuple[float, float], block_ids: set[str]) -> dict:
    """The answer as the user sees it: checked evidence, unsupported claims removed, causes labelled honestly."""
    removed = 0

    def checked(items: list[Evidence]) -> tuple[list[dict], int]:
        good, bad = [], 0
        for item in items:
            value = check(item, runs, window)
            if value is None:
                bad += 1
            else:
                good.append(item.model_dump() | {'value': value, 'checked': True})
        return good, bad

    findings = []
    for finding in answer.findings:
        evidence, bad = checked(finding.evidence)
        # A claim with a wrong number, or with numbers and nothing to check them against, is dropped.
        if bad or (not evidence and NUMBER.search(finding.text)):
            removed += 1
            continue
        findings.append({'text': finding.text, 'evidence': evidence})
    causes = []
    for cause in answer.causes:
        evidence, bad = checked(cause.evidence)
        kind = 'measured' if cause.kind == 'measured' and evidence and not bad else 'hypothesis'
        removed += bad
        causes.append({'text': cause.text, 'kind': kind, 'blockIds': [i for i in cause.blockIds if i in block_ids],
                       'evidence': evidence})
    return {'explanation': answer.explanation, 'findings': findings, 'causes': causes,
            'nextSteps': answer.nextSteps, 'missing': answer.missing, 'changePrompt': answer.changePrompt,
            'removed': removed}


def preview(request: ExplainRequest, loader=load_full) -> dict:
    """Exactly what the first request sends, for "Show what will be sent"."""
    digest = rd.digest(request, loader)
    text = prompt_for(request, digest, model_view(loader(request.runIds[0])))
    return {'prompt': text, 'characters': len(text)}


async def explain(request: ExplainRequest, job_id: str, progress=lambda message: None, loader=load_full) -> dict:
    progress('Summarizing the runs')
    digest = rd.digest(request, loader)
    runs = Runs(request, loader)
    project = model_view(runs.by_label['A'])
    window = (digest['window'][0], digest['window'][1])
    exact = rd.window_for(request, list(runs.by_label.values()))
    progress('Reading the results')
    answer = await structured.generate(prompt_for(request, digest, project), ResultsAnswer,
                                       f'{job_id}-results', task='results')
    measured: list[dict] = []
    if answer.measurements:
        progress('Measuring')
        measured = [measure(runs, item, exact) for item in answer.measurements[:MAX_MEASUREMENTS]]
        progress('Reading the measurements')
        answer = await structured.generate(prompt_for(request, digest, project, measured), ResultsAnswer,
                                           f'{job_id}-results2', task='results')
    progress('Checking the numbers')
    snapshot = runs.by_label['A'].get('snapshot') or {}
    blocks = {b.get('id') for b in snapshot.get('blocks', [])}
    checked = verify(answer, runs, exact, blocks)
    # Names and units of the signals the evidence points at, so the card can label its chips.
    cited = {e['signal'] for item in checked['findings'] + checked['causes'] for e in item['evidence']}
    result = {
        'answer': checked,
        'measurements': measured,
        'window': list(window),
        'runs': labels(request),
        'signals': {s['key']: {'name': s['name'], 'unit': s.get('unit', '')}
                    for run in runs.by_label.values() for s in run['series'] if s['key'] in cited},
        'provider': agent.provider_label(),
    }
    credits = dispatch.credits_for_current_job()
    return result | {'credits': credits} if credits is not None else result
