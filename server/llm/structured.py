# SPDX-License-Identifier: Apache-2.0
"""Turn a provider's JSON into a validated Pydantic model, tolerating what does not matter.

Providers' structured-output modes accept no length limits (see schema.py), so a
model can return an explanation longer than the field allows. Failing the whole
operation for that (and charging for it) helps nobody. So:

* The schema we send states every limit in words (``describe_limits``).
* Free-text fields a model class lists in ``prose`` are cut to fit before
  validation: a summary trimmed at a sentence or word boundary, or a list of
  assumptions shortened. Identifiers, equations, and numbers are never touched.
* If the answer still does not validate, the provider gets one chance to
  correct it, with the exact problems.
"""
from __future__ import annotations

import json
import typing
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from .providers import ProviderError

M = TypeVar('M', bound=BaseModel)


def _limit(model: type[BaseModel], name: str) -> int | None:
    """``max_length`` of a field, from its Field() constraints."""
    for item in model.model_fields[name].metadata:
        value = getattr(item, 'max_length', None)
        if value is not None:
            return value
    return None


def trim_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit - 1]
    for mark in ('. ', '; ', ', ', ' '):
        at = cut.rfind(mark)
        if at > limit * 0.6:
            cut = cut[:at + (1 if mark != ' ' else 0)]
            break
    return cut.rstrip() + '…'


def _models_in(annotation: Any) -> list[type[BaseModel]]:
    """Model classes inside an annotation such as ``list[Cause]`` or ``Cause | None``."""
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return [annotation]
    found = []
    for arg in typing.get_args(annotation):
        found.extend(_models_in(arg))
    return found


def fit(model: type[BaseModel], data: Any) -> Any:
    """``data`` with the model's prose fields cut to their limits (nested models too)."""
    if not isinstance(data, dict):
        return data
    prose = getattr(model, 'prose', frozenset())
    out = dict(data)
    for name, info in model.model_fields.items():
        if name not in out:
            continue
        value = out[name]
        limit = _limit(model, name)
        if name in prose and limit is not None:
            if isinstance(value, str):
                value = trim_text(value, limit)
            elif isinstance(value, list):
                value = value[:limit]
        nested = _models_in(info.annotation)
        if nested:
            if isinstance(value, list):
                value = [fit(nested[0], item) for item in value]
            elif isinstance(value, dict):
                value = fit(nested[0], value)
        out[name] = value
    return out


def problems(error: ValidationError, limit: int = 12) -> str:
    """The validation errors as short lines a model (or a person) can act on."""
    lines = []
    for item in error.errors()[:limit]:
        where = '.'.join(str(part) for part in item.get('loc', ())) or '(top level)'
        lines.append(f'- {where}: {item.get("msg", "invalid")}')
    return '\n'.join(lines)


def parse(model: type[M], data: Any) -> M:
    """Validate ``data`` as ``model`` after fitting its prose fields."""
    return model.model_validate(fit(model, data))


async def generate(prompt: str, model: type[M], attempt_id: str, *, task: str) -> M:
    """One structured generation validated as ``model``, with one corrective retry."""
    from .. import agent  # the one seam every AI feature (and its tests) goes through
    schema = model.model_json_schema()
    data = await agent.structured_generation(prompt, schema, attempt_id, task=task)
    try:
        return parse(model, data)
    except ValidationError as error:
        first = error
    retry = (prompt + '\n\nYour previous answer:\n' + json.dumps(data)[-12000:]
             + '\n\nIt does not match the required format:\n' + problems(first)
             + '\nReturn the complete corrected JSON.')
    data = await agent.structured_generation(retry, schema, attempt_id + '-fix', task=task)
    try:
        return parse(model, data)
    except ValidationError as error:
        raise ProviderError('The AI answer did not match the expected format, even after a retry:\n'
                            + problems(error, 4) + '\nTry again, or choose another model in Settings → AI.',
                            502) from error
