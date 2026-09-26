# SPDX-License-Identifier: Apache-2.0
"""Normalize Gradara's JSON Schemas for provider structured-output modes.

Providers accept a strict subset of JSON Schema: every object closed with
``additionalProperties: false``, every property required, and no numeric or
length constraints. Gradara still validates every response locally with
Pydantic, so dropping constraints here never weakens the accepted data.
"""
from __future__ import annotations

import copy
from typing import Any

DROP = {'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength',
        'pattern', 'minItems', 'maxItems', 'default', 'format', 'multipleOf', 'uniqueItems',
        'title', 'examples', 'minProperties', 'maxProperties'}


def strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
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
