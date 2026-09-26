/*
 * Replay harness for the reference controller: reads one sample per line as
 * "reference measured" from stdin and prints the controller output y.
 */
#include <stdio.h>
#include "gradara_controller.h"

int main(void) {
  gradara_controller_params params;
  gradara_controller_state state;
  gradara_controller_inputs inputs;
  gradara_controller_outputs outputs;
  gradara_controller_default_params(&params);
  gradara_controller_init(&params, &state);
  while (scanf("%lf %lf", &inputs.reference, &inputs.measured) == 2) {
    gradara_controller_step(&params, &state, &inputs, &outputs);
    printf("%.17g\n", outputs.y);
  }
  return 0;
}
