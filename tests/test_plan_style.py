# SPDX-License-Identifier: Apache-2.0
"""The plan style check (server/plan_style.py) on good and bad plan text.

Add real planner output to `GOOD` when tuning the prompt: every plan the
planner writes for a fixture should pass.
"""
from server.plan_style import MAX_STEPS, RULES, plan_problems, problems

GOOD = [
    (['Add a speed sensor on the load shaft.', 'Connect the sensor output to the PI controller feedback input.',
      'Log the sensor output.'],
     ['Adds speed feedback to the controller.', 'The load shaft speed is the controlled variable.']),
    (['Set R1 resistance to 10 ohm.'], ['Lowers the time constant to 1 ms.']),
    (['Create a block named Buck switch with an ideal switch and diode.', 'Replace S1 with Buck switch.',
      'Set the stop time to 0.02 s.'], []),
]


def test_good_plans_pass():
    for steps, texts in GOOD:
        assert plan_problems(steps, texts) == [], steps


def test_long_and_hedged_text_fails():
    long = ' '.join(['word'] * 30) + '.'
    assert any('30 words' in p for p in problems(long))
    assert problems('You should increase the gain.') == ['uses "should"']
    assert problems("I will add a sensor.") == ['filler "i will"']


def test_steps_start_with_a_verb_and_hold_one_sentence():
    assert problems('Adding a sensor.', step=True) == ['does not start with an imperative verb: "Adding"']
    assert problems('The gain is raised.', step=True) == ['does not start with an imperative verb: "The"']
    assert problems('Add a sensor. Connect it.', step=True) == ['more than one sentence in a step']
    assert any('22 words' in p for p in problems('Add ' + ' '.join(['x'] * 21) + '.', step=True))


def test_too_many_steps():
    steps = [f'Set gain {i} to 2.' for i in range(MAX_STEPS + 1)]
    assert plan_problems(steps)[0] == f'{MAX_STEPS + 1} steps (at most {MAX_STEPS})'


def test_rules_name_the_limits():
    assert 'ASD-STE100' in RULES and str(MAX_STEPS) in RULES
