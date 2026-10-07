<!-- Generated from lib/gradara/solver-docs.ts by `npm run docs:solver`. Edit that file, not this one. -->

# Simulation settings

Gradara solves every model with OpenModelica. The defaults suit most models: change a setting when you see one of the [symptoms below](#when-something-looks-wrong), not before. The settings are in the model inspector (click empty canvas), under Stop time; each field explains itself in one line and has a help button with more. The same guide opens from the help button next to **Simulation**. Settings are saved with the model and recorded with every run, so runs with different settings can be compared in Results.

## Solvers

Variable-step solvers choose each step to meet the tolerance. Fixed-step solvers use one step throughout.

| Solver | Type | Use it when |
| --- | --- | --- |
| DASSL | Variable step | Start here. Handles stiff models, switching, and physical networks. |
| Implicit Runge-Kutta | Variable step | Try it when a model that switches often runs slowly. |
| Backward Euler | Fixed step | A fixed step that stays stable on stiff models, at modest accuracy. |
| Runge-Kutta 4 | Fixed step | An accurate fixed step for smooth models without very fast parts. |

**DASSL.** An implicit multistep method (BDF, orders 1 to 5) that picks its own step and order to keep the error within the tolerance, and stops exactly at every event. It suits almost every model.

**Implicit Runge-Kutta.** An implicit single-step method (ESDIRK, order 4) with its own step control. After every event DASSL restarts at low order with small steps; a single-step method does not need to, so models that switch thousands of times often finish sooner.

**Backward Euler.** Every step has the same length. Implicit and first order: it stays stable with a large step, but its error shrinks only in proportion to the step. Use it when you need a fixed step on a model with fast and slow parts.

**Runge-Kutta 4.** The classic fourth-order explicit method at a constant step. Accurate for its step, but a step longer than about the fastest time constant in the model makes values grow without bound.

## Settings

| Setting | Solvers | Default | What it does |
| --- | --- | --- | --- |
| Tolerance | Variable step | 1e-6 | Error allowed in each step. Smaller is more accurate and slower. |
| Maximum step (s) | Variable step | Automatic | Longest step the solver may take. Leave it blank to let the solver decide. |
| Output interval (s) | Variable step | Stop time / 6,000 | How often results are recorded. It hardly affects accuracy. |
| Step size (s) | Fixed step | Stop time / 6,000 | Length of every step; results are recorded at each one. Smaller is more accurate and slower. |

**Tolerance.** The relative error the solver accepts in each step; it is also used as the absolute error. 1e-6 suits almost every model. The choices run from 1e-2 to 1e-10. To check a result, run again with a tolerance 100 times smaller and compare the two runs. If they agree, the result does not depend on the solver. Loosening it rarely speeds up a model that switches. With DASSL it can do the opposite: the solver rattles back and forth across switching thresholds and records far more data. Implicit Runge-Kutta copes better with a loose tolerance.

**Maximum step.** A variable-step solver takes long steps while little changes, and can step right over a pulse that is shorter than its step. Set a maximum step shorter than the shortest pulse or feature you need. On a model that switches, a maximum step of about half the switching period can also make the run faster, because the solver stops overshooting the next edge. Smaller values make every run slower. Leave it blank unless something is missed.

**Output interval.** The spacing of the recorded points. Blank records 6,000 intervals across the stop time. Events are always recorded as well, at the instant they happen. The solver still steps as the tolerance requires, so this changes what you see in plots and downloads, not how accurately the model is solved (final values typically move by less than the tolerance). Make it smaller if a smooth curve looks jagged; larger if runs produce more data than you need.

**Step size.** A fixed-step solver never adapts, so the step must resolve the fastest thing in the model: a few times shorter than the shortest time constant, and many times shorter than a switching period. The step is shortened slightly if needed so that a whole number of steps fits the stop time. Blank uses stop time / 6,000. If values blow up or the run stops early, the step is too large.

## When something looks wrong

| Symptom | What to change |
| --- | --- |
| A smooth curve looks jagged or coarse. | Set a smaller output interval. |
| A short pulse or spike is missing, or looks different from run to run. | Set a maximum step shorter than the pulse. With a fixed step, use a step shorter than the pulse. |
| The run is slow or hits the time limit. | For a model that switches often, try Implicit Runge-Kutta, or a maximum step of about half the switching period. With a fixed step, use a larger step. |
| A run produces far more data than expected, or is stopped for it. | Go back to the default tolerance, or use Implicit Runge-Kutta: with a loose tolerance DASSL can rattle across switching thresholds. A maximum step or a larger output interval also helps. |
| The run stops before the stop time. | With a fixed step, use a smaller step or Backward Euler. With a variable step, try the other variable-step solver or a maximum step. If it still stops, check the Problems list: the model itself may be at fault. |
| With a fixed step, values grow huge or become non-finite. | The step is too large for the fastest part of the model. Use a smaller step or Backward Euler. |
| You are not sure the result is right. | Run again with a tolerance 100 times smaller (or half the fixed step) and compare the two runs in Results. If they agree, the settings are not what shapes the result. |

## Limits

One run may record at most 200,000 points (or take that many fixed steps), must finish within 120 seconds, and is stopped if its results pass 1 GB.
