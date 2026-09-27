# SPDX-License-Identifier: Apache-2.0
"""Generated blocks follow the block design contract (docs/blocks/DESIGN.md)."""
from server.block_style import house_style
from server.models import Definition


def definition(**overrides) -> Definition:
    data = dict(kind='softLimit', name='Soft limit', description='Limits smoothly.', domain='signal', symbol='tanh',
                ports=[dict(id='u', name='u', direction='input', domain='signal', side='right'),
                       dict(id='y', name='y', direction='output', domain='signal', side='top')],
                parameters=[], equations='y = tanh(u);')
    data.update(overrides)
    return Definition.model_validate(data)


def test_signal_terminals_read_left_to_right():
    styled, problems = house_style(definition())
    assert problems == []
    assert {p.id: p.side for p in styled.ports} == {'u': 'left', 'y': 'right'}


def test_one_feedback_input_may_enter_from_below():
    ports = [dict(id='ref', name='ref', direction='input', domain='signal', side='left'),
             dict(id='meas', name='meas', direction='input', domain='signal', side='bottom'),
             dict(id='y', name='y', direction='output', domain='signal', side='right')]
    styled, _ = house_style(definition(ports=ports))
    assert [p.side for p in styled.ports] == ['left', 'bottom', 'right']


def test_two_terminal_element_has_opposite_terminals():
    ports = [dict(id='p', name='p', direction='physical', domain='electrical', side='top'),
             dict(id='n', name='n', direction='physical', domain='electrical', side='top')]
    styled, _ = house_style(definition(domain='electrical', ports=ports, equations='p.i + n.i = 0; p.v - n.v = p.i;'))
    assert [p.side for p in styled.ports] == ['left', 'right']


def test_instance_suffix_is_removed_and_long_text_is_sent_back():
    styled, problems = house_style(definition(name='Soft limit 2'))
    assert styled.name == 'Soft limit' and problems == []
    _, problems = house_style(definition(name='Smooth hyperbolic tangent amplitude limiter block',
                                         symbol='y = L*tanh(u/L)',
                                         ports=[dict(id='u', name='input signal', direction='input', domain='signal'),
                                                dict(id='y', name='y', direction='output', domain='signal')]))
    assert len(problems) == 3
    assert any('name' in p for p in problems) and any('symbol' in p for p in problems)
    assert any('input signal' in p for p in problems)


def test_revision_never_moves_existing_terminals():
    existing = definition(ports=[dict(id='u', name='u', direction='input', domain='signal', side='bottom'),
                                 dict(id='y', name='y', direction='output', domain='signal', side='right')])
    revised, _ = house_style(definition(), existing)
    assert [p.side for p in revised.ports] == ['bottom', 'right']
