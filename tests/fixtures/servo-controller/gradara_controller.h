/*
 * Reviewed reference export of the Servo position control example's
 * "Position controller" (Gradara discretePID block).
 *
 * The controller is sampled: call gradara_controller_step exactly once per
 * sample period, after reading the inputs for that instant. Time is not an
 * input; the host owns the sample clock.
 */
#ifndef GRADARA_CONTROLLER_H
#define GRADARA_CONTROLLER_H

#ifdef __cplusplus
extern "C" {
#endif

/* Default sample period in seconds (1 kHz). */
#define GRADARA_CONTROLLER_SAMPLE_PERIOD 0.001

typedef struct {
  double kp;           /* Proportional gain. Default 30. */
  double ki;           /* Integral gain, 1/s. Default 1. */
  double kd;           /* Derivative gain, s. Default 3. */
  double filterTime;   /* Derivative filter time constant, s. Default 0.01. */
  double limit;        /* Output and integral limit (symmetric). Default 24. */
  double samplePeriod; /* Sample period, s. Default 0.001. */
} gradara_controller_params;

typedef struct {
  double integral;   /* Clamped integral contribution. */
  double derivative; /* Filtered derivative contribution. */
  double errorPrev;  /* Error at the previous sample. */
} gradara_controller_state;

typedef struct {
  double reference; /* Position request, rad. */
  double measured;  /* Measured shaft angle, rad. */
} gradara_controller_inputs;

typedef struct {
  double y; /* Drive voltage command, V. */
} gradara_controller_outputs;

/* Fill params with the values from the example model. */
void gradara_controller_default_params(gradara_controller_params *params);

/* Reset all states to zero, matching the Modelica start values. */
void gradara_controller_init(const gradara_controller_params *params,
                             gradara_controller_state *state);

/* One synchronous sample: read inputs, update states, write outputs. */
void gradara_controller_step(const gradara_controller_params *params,
                             gradara_controller_state *state,
                             const gradara_controller_inputs *inputs,
                             gradara_controller_outputs *outputs);

/* The sample period the host must call gradara_controller_step at. */
double gradara_controller_sample_time(const gradara_controller_params *params);

#ifdef __cplusplus
}
#endif

#endif /* GRADARA_CONTROLLER_H */
