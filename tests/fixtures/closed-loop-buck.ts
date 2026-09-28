// A closed-loop buck converter: a reference, a discrete voltage loop, and a PWM
// modulator drive the buck power stage, and the output voltage feeds back.
import { readFileSync } from 'node:fs';
import { library, type Block, type Project } from '../../lib/gradara/model';

export function closedLoopBuck(): Project {
  const buck = JSON.parse(
    readFileSync('models/examples/buck.json', 'utf8'),
  ) as Project;
  const block = (kind: string, id: string, x: number, y: number): Block => ({
    id,
    definition: structuredClone(library.find((d) => d.kind === kind)!),
    position: { x, y },
  });
  const wire = (s: string, sh: string, t: string, th: string) => ({
    id: `w_${s}_${sh}_${t}_${th}`,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  });
  const blocks = [
    ...buck.blocks.filter((b) => b.id !== 'pwm'),
    block('constant', 'ref', 0, 0),
    block('subtract', 'error', 150, 0),
    block('currentPI', 'pi', 300, 0),
    block('unitDelay', 'hold', 450, 0),
    block('pwmSignal', 'modulator', 600, 0),
    block('voltageSensor', 'inputProbe', 0, 400),
    block('terminator', 'sink', 150, 400),
  ];
  const wires = [
    ...buck.wires
      .filter((w) => w.source !== 'pwm')
      .map(({ waypoints: _w, ...w }) => w),
    wire('ref', 'y', 'error', 'a'),
    wire('voltageProbe', 'y', 'error', 'b'),
    wire('error', 'y', 'pi', 'u'),
    wire('pi', 'y', 'hold', 'u'),
    wire('hold', 'y', 'modulator', 'dutyCycle'),
    wire('modulator', 'fire', 'highSide', 'gate'),
    wire('modulator', 'notFire', 'lowSide', 'gate'),
    wire('inputProbe', 'y', 'sink', 'u'),
    wire('supply', 'p', 'inputProbe', 'p'),
    wire('inputProbe', 'n', 'ground', 'p'),
  ];
  return { ...buck, name: 'Closed-loop buck', blocks, wires, nets: undefined };
}
