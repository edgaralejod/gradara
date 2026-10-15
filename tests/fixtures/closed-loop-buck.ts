// A closed-loop buck converter: a reference, a discrete voltage loop, and a PWM
// modulator drive the buck power stage, and the output voltage feeds back.
import { readFileSync } from 'node:fs';
import {
  definitionFor,
  type Block,
  type Project,
} from '../../lib/gradara/model';

export function closedLoopBuck(): Project {
  const buck = JSON.parse(
    readFileSync('models/examples/buck.json', 'utf8'),
  ) as Project;
  const block = (kind: string, id: string, x: number, y: number): Block => ({
    id,
    definition: structuredClone(definitionFor(kind)!),
    position: { x, y },
  });
  const wire = (s: string, sh: string, t: string, th: string) => ({
    id: `w_${s}_${sh}_${t}_${th}`,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  });
  const pi = block('piController', 'pi', 300, 0);
  // The measurement comes in from below, as feedback is drawn.
  pi.definition.ports.find((port) => port.id === 'measured')!.side = 'bottom';
  const blocks = [
    // The switches stand upright, so their control inputs face the modulator on the left.
    ...buck.blocks
      .filter((b) => b.id !== 'pwm' && b.id !== 'duty')
      .map((b) => {
        if (b.id !== 'highSide' && b.id !== 'lowSide') return b;
        const definition = structuredClone(b.definition);
        definition.ports.find((port) => port.id === 'control')!.side = 'bottom';
        return { ...b, definition };
      }),
    block('constant', 'ref', 0, 0),
    pi,
    block('unitDelay', 'hold', 450, 0),
    block('pwmSignal', 'modulator', 600, 0),
    block('voltageSensor', 'inputProbe', 0, 400),
    block('terminator', 'sink', 150, 400),
  ];
  const wires = [
    ...buck.wires
      .filter((w) => w.source !== 'pwm' && w.source !== 'duty')
      .map(({ waypoints: _w, ...w }) => w),
    wire('ref', 'y', 'pi', 'reference'),
    wire('voltageProbe', 'y', 'pi', 'measured'),
    wire('pi', 'y', 'hold', 'u'),
    wire('hold', 'y', 'modulator', 'dutyCycle'),
    wire('modulator', 'fire', 'highSide', 'control'),
    wire('modulator', 'notFire', 'lowSide', 'control'),
    wire('inputProbe', 'y', 'sink', 'u'),
    wire('supply', 'p', 'inputProbe', 'p'),
    wire('inputProbe', 'n', 'ground', 'p'),
  ];
  return { ...buck, name: 'Closed-loop buck', blocks, wires, nets: undefined };
}
