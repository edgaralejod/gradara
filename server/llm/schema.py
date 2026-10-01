# SPDX-License-Identifier: Apache-2.0
"""Normalize Gradara's JSON Schemas for provider structured-output modes.

Providers accept a strict subset of JSON Schema: every object closed with
``additionalProperties: false``, every property required, and no numeric or
length constraints. Gradara still validates every response locally with
Pydantic, so dropping constraints here never weakens the accepted data; each
constraint is first restated in the field's description so the model still sees it.
"""
from __future__ import annotations

import copy
from typing import Any

DROP = {'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength',
        'pattern', 'minItems', 'maxItems', 'default', 'format', 'multipleOf', 'uniqueItems',
        'title', 'examples', 'minProperties', 'maxProperties'}


WORDS = {
    'maxLength': 'at most {} characters', 'minLength': 'at least {} characters',
    'maxItems': 'at most {} items', 'minItems': 'at least {} items',
    'minimum': 'at least {}', 'maximum': 'at most {}',
    'exclusiveMinimum': 'more than {}', 'exclusiveMaximum': 'less than {}',
    'pattern': 'matching the pattern {}',
}
MARK = 'Limits: '


def describe_limits(schema: dict[str, Any]) -> dict[str, Any]:
    """The schema with each constraint also stated in its description.

    Structured-output modes drop the constraints themselves (``strict_schema``), so
    without this a model cannot know that a summary must stay under 800 characters.
    Applying it twice changes nothing.
    """
    def visit(node: Any) -> Any:
        if isinstance(node, list):
            return [visit(item) for item in node]
        if not isinstance(node, dict):
            return node
        out = {key: ({name: visit(child) for name, child in value.items()}
                     if key in ('properties', '$defs', 'definitions') else visit(value))
               for key, value in node.items()}
        limits = [WORDS[key].format(value) for key, value in node.items() if key in WORDS]
        if limits and MARK not in out.get('description', ''):
            text = MARK + '; '.join(limits) + '.'
            out['description'] = (out['description'].rstrip() + ' ' + text) if out.get('description') else text
        return out

    return visit(copy.deepcopy(schema))


def strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
    schema = describe_limits(schema)

    def visit(node: Any) -> Any:
        if isinstance(node, list):
            return [visit(item) for item in node]
        if not isinstance(node, dict):
            return node
        out = {}
        for key, value in node.items():
            if key in DROP:
                continue
            if key in ('properties', '$defs', 'definitions'):
                out[key] = {name: visit(child) for name, child in value.items()}
            else:
                out[key] = visit(value)
        if out.get('type') == 'object' or 'properties' in out:
            out.setdefault('properties', {})
            out['additionalProperties'] = False
            out['required'] = list(out['properties'].keys())
        return out

    return visit(copy.deepcopy(schema))


def schema_size_ok(schema: dict, limit: int = 64_000) -> bool:
    import json
    return len(json.dumps(schema)) <= limit
