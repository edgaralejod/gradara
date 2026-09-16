import { materializeBranches } from '../lib/gradara/net-branches';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { moveJunctions } from '../lib/gradara/net-layout';
import { polylineOfWire } from '../lib/gradara/net-draw';

import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, library, type Project } from '../lib/gradara/model';
import {
  describeNets,
  netForWire,
  netTopology,
  reconcileNets,
  renameNet,
} from '../lib/gradara/net-registry';
import {
  labelPosition,
  nearestLabelAnchor,
  setNetLabel,
} from '../lib/gradara/net-label';
import { duplicateBlocks, semanticSignature } from '../lib/gradara/project';
import {
  emptySelection,
  extractSelection,
  pasteSelection,
} from '../lib/gradara/selection';

function branched(): Project {
  const block = (id: string, kind: string, x: number, y: number) => ({
    id,
    definition: structuredClone(library.find((d) => d.kind === kind)!),
    position: { x, y },
  });
  return reconcileNets({
    version: 1,
    name: 'Net tests',
    duration: 1,
    revision: 0,
    blocks: [
      block('step', 'step', 0, 0),
      block('a', 'gain', 300, 0),
      block('b', 'gain', 300, 120),
    ],
    junctions: [{ id: 'j', position: { x: 160, y: 28 }, domain: 'signal' }],
    wires: [
      {
        id: 'trunk',
        source: 'step',
        sourceHandle: 'y',
        target: 'j',
        targetHandle: 'node',
      },
      {
        id: 'a',
        source: 'j',
        sourceHandle: 'node',
        target: 'a',
        targetHandle: 'u',
      },
      {
        id: 'b',
        source: 'j',
        sourceHandle: 'node',
        target: 'b',
        targetHandle: 'u',
      },
    ],
  });
}

void test('legacy diagrams receive exactly one persistent ID per connected component, including physical nets', () => {
  const p = reconcileNets(initialProject());
  assert.equal(p.nets!.length, netTopology(p).length);
  assert.equal(new Set(p.nets!.map((n) => n.id)).size, p.nets!.length);
  assert.equal(reconcileNets(p), p);
  const loaded = JSON.parse(JSON.stringify(p)) as Project;
  assert.deepEqual(reconcileNets(loaded).nets, p.nets);
  assert.ok(describeNets(p).some((n) => n.domain === 'electrical'));
});

void test('all branches share identity and name; names and label geometry never change execution', () => {
  const p = branched(),
    id = p.nets![0].id;
  const named = renameNet(p, id, '  feedback ω  ');
  assert.equal(named.nets![0].name, 'feedback ω');
  for (const wire of named.wires)
    assert.equal(netForWire(named, wire.id)?.id, id);
  const labeled = setNetLabel(named, id, {
    wireId: 'b',
    fraction: 0.6,
    side: -1,
  });
  assert.equal(semanticSignature(labeled), semanticSignature(p));
  assert.equal(reconcileNets(labeled, named).nets![0].id, id);
  assert.equal(renameNet(labeled, id, '').nets![0].name, undefined);
  assert.equal(renameNet(named, id, 'feedback ω'), named);
});

void test('branch insertion, route redraw, wire reversal, and junction collapse preserve net ID', () => {
  const p = branched();
  const id = p.nets![0].id;
  const base = renameNet(p, id, 'feedback');
  const collapsed = reconcileNets(
    {
      ...base,
      junctions: [],
      wires: [
        {
          id: 'new1',
          source: 'a',
          sourceHandle: 'u',
          target: 'step',
          targetHandle: 'y',
        },
        {
          id: 'new2',
          source: 'step',
          sourceHandle: 'y',
          target: 'b',
          targetHandle: 'u',
        },
      ],
    },
    base,
  );
  assert.equal(collapsed.nets![0].id, id);
  assert.equal(collapsed.nets![0].name, 'feedback');
  assert.deepEqual(collapsed.nets![0].wireIds, ['new1', 'new2']);
  const moved = reconcileNets(
    {
      ...collapsed,
      wires: collapsed.wires.map((w) => ({
        ...w,
        waypoints: [{ x: 220, y: 200 }],
      })),
    },
    collapsed,
  );
  assert.deepEqual(moved.nets, collapsed.nets);
});

void test('a split keeps identity on the anchored side; detached branches get distinct unnamed IDs', () => {
  const original = branched(),
    p = renameNet(original, original.nets![0].id, 'feedback');
  // Remove the branch point, leaving the source->a net and a detached b->c net.
  const c = {
    ...structuredClone(p.blocks[1]),
    id: 'c',
    position: { x: 450, y: 120 },
  };
  const next = reconcileNets(
    {
      ...p,
      blocks: [...p.blocks, c],
      junctions: [],
      wires: [
        {
          id: 'b',
          source: 'b',
          sourceHandle: 'u',
          target: 'c',
          targetHandle: 'u',
        },
        {
          id: 'a',
          source: 'step',
          sourceHandle: 'y',
          target: 'a',
          targetHandle: 'u',
        },
      ],
    },
    p,
  );
  assert.equal(netForWire(next, 'a')?.id, p.nets![0].id);
  assert.equal(netForWire(next, 'a')?.name, 'feedback');
  assert.notEqual(netForWire(next, 'b')?.id, p.nets![0].id);
  assert.equal(netForWire(next, 'b')?.name, undefined);
  assert.equal(netForWire(next, 'b')?.anchor, 'b.u');
});

void test('reconnecting a deleted anchor recovers ID from surviving wire IDs', () => {
  const p = branched();
  const next = reconcileNets(
    {
      ...p,
      blocks: p.blocks.filter((b) => b.id !== 'step'),
      wires: p.wires.filter((w) => w.id !== 'trunk'),
    },
    p,
  );
  assert.equal(next.nets![0].id, p.nets![0].id);
  assert.notEqual(next.nets![0].anchor, 'step.y');
});

void test('physical merge has a deterministic identity and preserves both names', () => {
  const port = {
    id: 'p',
    name: 'p',
    direction: 'physical' as const,
    domain: 'electrical' as const,
  };
  const base: Project = {
    version: 1,
    name: 'Physical',
    duration: 1,
    revision: 0,
    blocks: ['a', 'b', 'c', 'd'].map((id, i) => ({
      id,
      position: { x: i * 100, y: 0 },
      definition: {
        kind: 'terminal',
        name: id,
        description: '',
        domain: 'electrical',
        symbol: '',
        parameters: [],
        equations: '',
        ports: [port],
      },
    })),
    wires: [
      {
        id: 'ab',
        source: 'a',
        sourceHandle: 'p',
        target: 'b',
        targetHandle: 'p',
      },
      {
        id: 'cd',
        source: 'c',
        sourceHandle: 'p',
        target: 'd',
        targetHandle: 'p',
      },
    ],
  };
  let p = reconcileNets(base);
  p = renameNet(p, p.nets![0].id, 'supply');
  p = renameNet(p, p.nets![1].id, 'rail');
  const merge = {
    ...p,
    wires: [
      ...p.wires,
      {
        id: 'bc',
        source: 'b',
        sourceHandle: 'p',
        target: 'c',
        targetHandle: 'p',
      },
    ],
  };
  const next = reconcileNets(merge, p);
  assert.equal(next.nets!.length, 1);
  assert.deepEqual(
    new Set([next.nets![0].name, ...next.nets![0].aliases!]),
    new Set(['supply', 'rail']),
  );
  assert.deepEqual(
    reconcileNets(
      {
        ...merge,
        wires: [...merge.wires].reverse(),
        nets: [...p.nets!].reverse(),
      },
      p,
    ).nets,
    next.nets,
  );
  assert.ok(p.nets!.some((n) => n.id === next.nets![0].id));
});

void test('duplicate and clipboard remap net identity, label wire, and anchor without sharing metadata', () => {
  const initial = branched();
  const named = renameNet(initial, initial.nets![0].id, 'feedback');
  const p = setNetLabel(named, named.nets![0].id, {
    wireId: 'trunk',
    fraction: 0.5,
    side: -1,
  });
  const { project: copy } = duplicateBlocks(
    p,
    p.blocks.map((b) => b.id),
  );
  assert.equal(copy.nets!.length, 2);
  const other = copy.nets!.find((n) => n.id !== p.nets![0].id)!;
  assert.equal(other.name, 'feedback');
  assert.ok(other.wireIds.includes(other.label!.wireId));
  assert.notEqual(other.label!.wireId, 'trunk');
  assert.notEqual(other.anchor, p.nets![0].anchor);
  const fragment = extractSelection(p, {
    ...emptySelection(),
    blockIds: ['step', 'b'],
  });
  const pasted = pasteSelection(p, fragment).project;
  assert.equal(pasted.nets!.length, 2);
  assert.ok(
    pasted.nets!.every((n) =>
      n.wireIds.every((id) => pasted.wires.some((w) => w.id === id)),
    ),
  );
  assert.deepEqual(
    p.nets,
    named.nets!.map((n) => ({
      ...n,
      label: { wireId: 'trunk', fraction: 0.5, side: -1 },
    })),
  );
});

void test('label anchors stay on their net and follow translation, branch selection and either side', () => {
  const p = branched(),
    net = p.nets![0];
  const initial = labelPosition(p, net)!;
  assert.ok(initial.horizontal);
  const above = nearestLabelAnchor(p, net, { x: 100, y: 0 })!;
  assert.equal(above.wireId, 'trunk');
  assert.equal(above.side, -1);
  const label = labelPosition(p, net, above)!;
  const moved: Project = {
    ...p,
    blocks: p.blocks.map((b) => ({
      ...b,
      position: { x: b.position.x + 50, y: b.position.y + 80 },
    })),
    junctions: p.junctions!.map((j) => ({
      ...j,
      position: { x: j.position.x + 50, y: j.position.y + 80 },
    })),
  };
  const at = labelPosition(moved, net, above)!;
  assert.equal(at.x, label.x + 50);
  assert.equal(at.y, label.y + 80);
  assert.equal(nearestLabelAnchor(p, net, { x: 250, y: 175 })!.wireId, 'b');
});

void test('deleted net and stale label anchors are cleaned without changing unrelated IDs', () => {
  const p = reconcileNets(initialProject());
  const target = p.nets![0];
  const next = reconcileNets(
    { ...p, wires: p.wires.filter((w) => !target.wireIds.includes(w.id)) },
    p,
  );
  assert.ok(!next.nets!.some((n) => n.id === target.id));
  assert.deepEqual(
    next.nets!.map((n) => n.id),
    p.nets!.slice(1).map((n) => n.id),
  );
});

void test('the anchor wins a split even when the detached fragment has over a thousand wire sections', () => {
  const p = branched();
  const junctions = Array.from({ length: 1200 }, (_, i) => ({
    id: `chain${i}`,
    position: { x: i * 10, y: 100 },
    domain: 'signal' as const,
  }));
  const wires = [
    {
      id: 'source',
      source: 'step',
      sourceHandle: 'y',
      target: 'chain0',
      targetHandle: 'node',
    },
    ...junctions.slice(1).map((j, i) => ({
      id: `link${i}`,
      source: `chain${i}`,
      sourceHandle: 'node',
      target: j.id,
      targetHandle: 'node',
    })),
    {
      id: 'sink',
      source: 'chain1199',
      sourceHandle: 'node',
      target: 'a',
      targetHandle: 'u',
    },
  ];
  const whole = reconcileNets({ ...p, nets: [], junctions, wires });
  const split = reconcileNets(
    { ...whole, wires: wires.filter((w) => w.id !== 'link0') },
    whole,
  );
  assert.equal(netForWire(split, 'source')?.id, whole.nets![0].id);
  assert.notEqual(netForWire(split, 'sink')?.id, whole.nets![0].id);
});

void test('explicitly clearing a merged name does not resurrect its aliases', () => {
  const p = branched();
  p.nets![0] = { ...p.nets![0], name: 'one', aliases: ['two'] };
  const cleared = reconcileNets(renameNet(p, p.nets![0].id, ''), p);
  assert.equal(cleared.nets![0].name, undefined);
  assert.equal(cleared.nets![0].aliases, undefined);
});

void test('signal logging survives reconciliation and affects run identity', () => {
  const p = branched();
  const net = p.nets![0];
  const logged = {
    ...p,
    nets: p.nets!.map((n) => (n.id === net.id ? { ...n, logged: true } : n)),
  };
  const next = reconcileNets(logged, p);
  assert.equal(next.nets!.find((n) => n.id === net.id)!.logged, true);
  assert.notEqual(semanticSignature(p), semanticSignature(next));
  assert.equal(
    reconcileNets(next, next).nets!.find((n) => n.id === net.id)!.logged,
    true,
  );
});

for (const domain of [
  'signal',
  'electrical',
  'mechanical',
  'thermal',
] as const) {
  void test(`${domain} shared runs become movable junctions without changing net identity`, () => {
    const blocks = [0, 1, 2].map((i) => ({
      id: `b${i}`,
      position: { x: i ? 300 : 0, y: i === 2 ? 160 : 0 },
      size: { width: 80, height: 40 },
      definition: {
        kind: 'test',
        name: `Block${i}`,
        domain,
        symbol: 'T',
        description: '',
        parameters: [],
        equations: '',
        ports: [
          {
            id: 'p',
            name: 'p',
            domain,
            direction:
              domain === 'signal'
                ? ((i ? 'input' : 'output') as 'input' | 'output')
                : ('physical' as const),
            side: i ? ('left' as const) : ('right' as const),
          },
        ],
      },
    }));
    const before = reconcileNets({
      version: 1,
      name: 'Branch test',
      modelId: 'test',
      duration: 1,
      revision: 0,
      blocks,
      wires: [
        {
          id: 'a',
          source: 'b0',
          sourceHandle: 'p',
          target: 'b1',
          targetHandle: 'p',
          waypoints: [],
        },
        // Reversed storage must not change physical or signal branching behavior.
        {
          id: 'b',
          source: 'b2',
          sourceHandle: 'p',
          target: 'b0',
          targetHandle: 'p',
          waypoints: [
            { x: 180, y: 180 },
            { x: 180, y: 20 },
          ],
        },
      ],
    });
    before.nets![0].name = 'Preserved';
    const after = normalizeProject(before);
    assert.equal(after.junctions?.length, 1);
    assert.equal(after.junctions![0].domain, domain);
    assert.deepEqual(after.junctions![0].position, { x: 180, y: 20 });
    assert.equal(after.wires.length, 3);
    assert.equal(after.nets![0].id, before.nets![0].id);
    assert.equal(after.nets![0].name, 'Preserved');
    const terminals = (p: Project) =>
      netTopology(p).map((n) =>
        [...n.keys].filter((e) => !e.startsWith('j:')).sort(),
      );
    assert.deepEqual(terminals(after), terminals(before));
    assert.equal(materializeBranches(after), after);
    const moved = moveJunctions(
      after,
      new Map([[after.junctions![0].id, { x: 200, y: 40 }]]),
    );
    for (const wire of moved.wires) {
      const route = polylineOfWire(moved, wire.id);
      assert.ok(route.some((p) => p.x === 200 && p.y === 40));
    }
    assert.equal(before.junctions?.length ?? 0, 0);
    // A third leaf must join the existing trunk, even with reversed storage.
    const third = structuredClone(before.blocks[2]);
    third.id = 'b3';
    third.position.y = -160;
    const fanout = normalizeProject({
      ...before,
      blocks: [...before.blocks, third],
      wires: [
        ...before.wires,
        {
          id: 'c',
          source: 'b3',
          sourceHandle: 'p',
          target: 'b0',
          targetHandle: 'p',
          waypoints: [
            { x: 180, y: -140 },
            { x: 180, y: 20 },
          ],
        },
      ],
    });
    assert.equal(fanout.junctions?.length, 1);
    assert.equal(fanout.wires.length, 4);
    assert.equal(
      fanout.wires.filter((w) => w.source === 'b0' || w.target === 'b0').length,
      1,
    );
    assert.deepEqual(normalizeProject(fanout), fanout);
  });
}
void test('unrelated geometric crossings never become nodes', () => {
  const p = branched();
  p.junctions = [];
  const source = structuredClone(p.blocks[0]);
  source.id = 'independent';
  source.position.y = 120;
  p.blocks.push(source);
  p.wires = [
    {
      id: 'one',
      source: 'step',
      sourceHandle: 'y',
      target: 'b',
      targetHandle: 'u',
      waypoints: [
        { x: 160, y: 28 },
        { x: 160, y: 148 },
      ],
    },
    {
      id: 'two',
      source: 'independent',
      sourceHandle: 'y',
      target: 'a',
      targetHandle: 'u',
      waypoints: [
        { x: 220, y: 148 },
        { x: 220, y: 28 },
      ],
    },
  ];
  const before = structuredClone(p);
  const after = materializeBranches(p);
  assert.equal(after, p);
  assert.deepEqual(after, before);
});
