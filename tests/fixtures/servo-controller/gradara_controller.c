/*
 * Reviewed reference export of the Servo position controller.
 *
 * Each line of gradara_controller_step corresponds to one equation of the
 * block's `when sample(0, samplePeriod)` clause, evaluated in the same order.
 * The Modelica pre(x) operator is the value stored in state before the step.
 */
#include "gradara_controller.h"

static double clamp(double value, double limit) {
  if (value > limit) return limit;
  if (value < -limit) return -limit;
  return value;
}

void gradara_controller_default_params(gradara_controller_params *params) {
  params->kp = 30.0;
  params->ki = 1.0;
  params->kd = 3.0;
  params->filterTime = 0.01;
  params->limit = 24.0;
  params->samplePeriod = GRADARA_CONTROLLER_SAMPLE_PERIOD;
}

void gradara_controller_init(const gradara_controller_params *params,
                             gradara_controller_state *state) {
  (void)params;
  state->integral = 0.0;
  state->derivative = 0.0;
  state->errorPrev = 0.0;
}

void gradara_controller_step(const gradara_controller_params *params,
                             gradara_controller_state *state,
                             const gradara_controller_inputs *inputs,
                             gradara_controller_outputs *outputs) {
  const double ts = params->samplePeriod;
  /* e = reference - measured; */
  const double e = inputs->reference - inputs->measured;
  /* integral = max(-limit, min(limit, pre(integral) + samplePeriod*ki*e)); */
  state->integral = clamp(state->integral + ts * params->ki * e, params->limit);
  /* derivative = (filterTime*pre(derivative) + kd*(e - pre(errorPrev)))
   *              / (filterTime + samplePeriod); */
  state->derivative =
      (params->filterTime * state->derivative + params->kd * (e - state->errorPrev)) /
      (params->filterTime + ts);
  /* errorPrev = e; */
  state->errorPrev = e;
  /* y = max(-limit, min(limit, kp*e + integral + derivative)); */
  outputs->y =
      clamp(params->kp * e + state->integral + state->derivative, params->limit);
}

double gradara_controller_sample_time(const gradara_controller_params *params) {
  return params->samplePeriod;
}
