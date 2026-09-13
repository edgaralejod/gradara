import test from 'node:test';
import { Position } from '@xyflow/react';
import { routeBetween } from '../lib/gradara/routing';
import assert from 'node:assert/strict';
import { initialProject, library, type Project } from '../lib/gradara/model';
import { blockSize } from '../lib/gradara/canvas';
import { portPoint } from '../lib/gradara/ports';
import { flattenWires } from '../lib/gradara/net';
import { firstSegmentHorizontal, nearly } from '../lib/gradara/net-draw';
import {
  moveVertex,
  slideSegment,
  snappedSegment,
} from '../lib/gradara/net-edit';
import { semanticSignature } from '../lib/gradara/project';
import { NetSession } from '../lib/gradara/net-session';

const def = (kind: string) => library.find((d) => d.kind === kind)!;

function place(
  kind: string,
  id: string,
  x: number,
  y: number,
): Project['blocks'][number] {
  return { id, definition: structuredClone(def(kind)), position: { x, y } };
}

/** Step (0,40), Sum (180,50), Gain (300,36) — output/input row at y = 68. */
function sheet(): Project {
  return {
    ...initialProject(),
    name: 'Wiring spec',
    blocks: [
      place('step', 'step', 0, 40),
      place('sum', 'sum', 180, 50),
      place('gain', 'gain', 300, 36),
    ],
    wires: [],
    junctions: [],
  };
}

function port(project: Project, id: string, handle: string) {
  const b = project.blocks.find((x) => x.id === id)!;
  const p = portPoint(b, handle);
  assert.ok(p, `${id}.${handle} missing`);
  return p;
}

void test('fixture ports sit on a shared row so geometry is exact', () => {
  const p = sheet();
  assert.equal(blockSize(p.blocks[0]).width, 64);
  assert.equal(port(p, 'step', 'y').x, 64);
  assert.equal(port(p, 'step', 'y').y, 68);
  assert.equal(port(p, 'sum', 'a').x, 180);
  assert.equal(port(p, 'sum', 'a').y, 68);
  assert.equal(port(p, 'gain', 'u').y, 68);
});

void test('1 pin exit: first segment leaves a right port horizontally', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.move(140, 20);
  const pts = s.preview();
  assert.ok(pts.length >= 2);
  assert.ok(firstSegmentHorizontal(pts));
  assert.ok(nearly(pts[0].y, 68));
  assert.ok(nearly(pts[1].y, 68));
  assert.ok(pts[1].x > pts[0].x);
});

void test('2 click pins a vertex and does not create a junction graphic', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.move(140, 20);
  s.release({ x: 140, y: 20 });
  s.click({ x: 140, y: 20 });
  assert.equal(s.mode, 'drawing');
  assert.ok(s.corners.length >= 1);
  assert.equal(s.junctionCount(), 0);
  s.click({ x: 180, y: 68 });
  assert.equal(s.mode, 'idle');
  assert.equal(s.junctionCount(), 0);
  assert.equal(s.project.wires.length, 1);
  assert.ok((s.project.wires[0].waypoints?.length ?? 0) >= 1);
});

void test('3 anchors magnetize a second wire to an existing run Y without joining', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.move(180, 68);
  s.release({ x: 180, y: 68 });
  assert.equal(s.project.wires.length, 1);
  const sat = place('saturation', 'sat', 300, 160);
  s.project = { ...s.project, blocks: [...s.project.blocks, sat] };
  s.pressPort('sat', 'u');
  s.move(245, 70);
  assert.ok(s.guides.some((g) => g.axis === 'y' && nearly(g.value, 68)));
  assert.equal(s.project.wires.length, 1);
});

void test('4 drop on ink creates a junction; dragging it moves the T', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.move(180, 68);
  s.release({ x: 180, y: 68 });
  const sat = place('saturation', 'sat', 140, 160);
  s.project = { ...s.project, blocks: [...s.project.blocks, sat] };
  s.pressPort('sat', 'u');
  s.move(120, 68);
  s.release({ x: 122, y: 68 });
  assert.ok(s.junctionCount() >= 1, 'splice must create a node graphic');
  const j = s.project.junctions![0];
  const before = { ...j.position };
  s.moveJunction(j.id, before.x, before.y + 24);
  const after = s.project.junctions![0].position;
  assert.equal(after.y, before.y + 24);
  const pairs = flattenWires(s.project);
  assert.ok(pairs.some((w) => w.target === 'sum'));
  assert.ok(pairs.some((w) => w.target === 'sat'));
});

void test('5 unpinned feedback is a U under the blocks, not along the trunk', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.move(180, 68);
  s.release({ x: 180, y: 68 });
  s.pressPort('sum', 'y');
  s.move(300, 68);
  s.release({ x: 300, y: 68 });
  const trunkY = 68;
  s.pressPort('gain', 'y');
  const minus = port(s.project, 'sum', 'b');
  s.move(minus.x, minus.y);
  s.release({ x: minus.x, y: minus.y });
  const fb = s.project.wires.find(
    (w) => w.source === 'gain' && w.target === 'sum',
  );
  assert.ok(fb);
  const pts = s.pathPoints(fb!.id);
  const lowest = Math.max(...pts.map((p) => p.y));
  assert.ok(
    lowest >= 36 + 64 + 40,
    `U rail should clear the gain box, got ${lowest}`,
  );
  assert.ok(lowest > trunkY + 30, 'U must not hug the forward trunk');
});

void test('6 drawn feedback keeps vertices and adds no junction', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.release({ x: 180, y: 68 });
  s.pressPort('sum', 'y');
  s.release({ x: 300, y: 68 });
  s.pressPort('gain', 'y');
  s.move(400, 68);
  s.release({ x: 400, y: 160 });
  s.click({ x: 400, y: 160 });
  s.click({ x: 198, y: 160 });
  const minus = port(s.project, 'sum', 'b');
  s.click({ x: minus.x, y: minus.y });
  assert.equal(s.mode, 'idle');
  assert.equal(s.junctionCount(), 0);
  const fb = s.project.wires.find((w) => w.source === 'gain')!;
  assert.ok((fb.waypoints?.length ?? 0) >= 2);
});

void test('7 branch from a junction does not collapse onto its own net', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.release({ x: 180, y: 68 });
  const sat = place('saturation', 'sat', 140, 180);
  s.project = { ...s.project, blocks: [...s.project.blocks, sat] };
  s.pressPort('sat', 'u');
  s.release({ x: 122, y: 68 });
  assert.ok(s.junctionCount() >= 1);
  const j = s.project.junctions![0];
  s.pressJunction(j.id, { x: j.position.x, y: j.position.y - 40 });
  s.move(j.position.x, j.position.y - 50);
  const live = s.preview();
  assert.ok(live.length >= 2);
  const wentUp = live.some((p) => p.y < j.position.y - 20);
  assert.ok(wentUp, 'tail must follow the mouse away from the trunk');
  s.click({ x: j.position.x, y: j.position.y - 50 });
  assert.equal(s.junctionCount(), 1);
});

void test('8 Esc / cancel while drawing leaves the sheet unchanged', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.move(140, 20);
  s.release({ x: 140, y: 20 });
  s.click({ x: 140, y: 20 });
  s.cancel();
  assert.equal(s.mode, 'idle');
  assert.equal(s.project.wires.length, 0);
  assert.equal(s.junctionCount(), 0);
});

void test('9 two distinct nets do not occupy the same pixels unless snapped as a suggestion', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.release({ x: 180, y: 68 });
  const sat = place('saturation', 'sat', 0, 200);
  const gain2 = place('gain', 'g2', 200, 200);
  s.project = {
    ...s.project,
    blocks: [...s.project.blocks, sat, gain2],
  };
  const u = port(s.project, 'sat', 'u');
  const gy = port(s.project, 'g2', 'u');
  s.pressPort('sat', 'y');
  s.move(gy.x, gy.y);
  s.release({ x: gy.x, y: gy.y });
  const a = s.pathPoints(s.project.wires[0].id);
  const b = s.pathPoints(s.project.wires[1].id);
  const ay = new Set(
    a
      .filter((_, i, pts) => pts[i + 1] && nearly(pts[i].y, pts[i + 1].y))
      .map((p) => Math.round(p.y)),
  );
  const by = new Set(
    b
      .filter((_, i, pts) => pts[i + 1] && nearly(pts[i].y, pts[i + 1].y))
      .map((p) => Math.round(p.y)),
  );
  const shared = [...ay].filter((y) => by.has(y));
  assert.ok(
    shared.every((y) => y !== 68 || gy.y === 68),
    'a second net must not sit on the first trunk',
  );
  void u;
});

void test('10 flatten ignores vertices; occupancy stays one driver per input', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.release({ x: 140, y: 20 });
  s.click({ x: 140, y: 20 });
  s.click({ x: 180, y: 68 });
  const pairs = flattenWires(s.project);
  assert.deepEqual(
    pairs.map((w) => [w.source, w.sourceHandle, w.target, w.targetHandle]),
    [['step', 'y', 'sum', 'a']],
  );
  assert.throws(() => {
    s.pressPort('gain', 'y');
    s.release({ x: 180, y: 68 });
  });
});

function orthogonal(pts: { x: number; y: number }[]) {
  for (let i = 1; i < pts.length; i++)
    assert.ok(
      pts[i - 1].x === pts[i].x || pts[i - 1].y === pts[i].y,
      `Diagonal ${JSON.stringify(pts.slice(i - 1, i + 1))}`,
    );
}
function connectedSheet() {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.release(port(s.project, 'sum', 'a'));
  s.pressPort('sum', 'y');
  s.release(port(s.project, 'gain', 'u'));
  return s;
}

void test('a forward edge in a feedback cycle keeps its straight route', () => {
  const s = connectedSheet();
  s.pressPort('gain', 'y');
  s.release(port(s.project, 'sum', 'b'));
  const w = s.project.wires.find((w) => w.source === 'sum')!;
  assert.deepEqual(
    s.pathPoints(w.id),
    [port(s.project, 'sum', 'y'), port(s.project, 'gain', 'u')].map(
      ({ x, y }) => ({ x, y }),
    ),
  );
});
void test('backspace restores the whole last click, including the previous exit direction', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.release({ x: 140, y: 20 });
  const before = {
    corners: [...s.corners],
    origin: { ...s.origin },
    exit: s.exit,
  };
  s.click({ x: 140, y: 20 });
  s.unpin();
  assert.deepEqual(
    { corners: s.corners, origin: s.origin, exit: s.exit },
    before,
  );
});
void test('reverse drawing with pinned bends preserves every segment in the right order', () => {
  const s = new NetSession(sheet());
  s.pressPort('gain', 'u');
  s.release({ x: 260, y: 160 });
  s.click({ x: 260, y: 160 });
  s.click({ x: 110, y: 160 });
  s.click(port(s.project, 'step', 'y'));
  const w = s.project.wires[0];
  assert.equal(w.source, 'step');
  assert.equal(w.target, 'gain');
  const pts = s.pathPoints(w.id);
  orthogonal(pts);
  assert.ok(pts.some((p) => p.y === 160));
  assert.ok(pts[1].x > pts[0].x, 'output normal must be respected');
  assert.ok(
    pts.at(-2)!.x < pts.at(-1)!.x,
    'input must be entered from the left',
  );
});
void test('splitting a routed feedback run retains its exact existing ink', () => {
  const s = connectedSheet();
  s.pressPort('gain', 'y');
  s.release(port(s.project, 'sum', 'b'));
  const w = s.project.wires.find((w) => w.source === 'gain')!;
  const before = s.pathPoints(w.id);
  const rail = before[2].y;
  const at = { x: (before[2].x + before[3].x) / 2, y: rail };
  const end = s.spliceAt(w.id, at)!;
  const halves = s.project.wires
    .filter((w) => w.source === end.id || w.target === end.id)
    .map((w) => s.pathPoints(w.id));
  halves.forEach(orthogonal);
  assert.deepEqual(halves[0].slice(0, -1), before.slice(0, 3));
  assert.deepEqual(halves[1].slice(1), before.slice(3));
  s.cancel();
  assert.equal(s.project.wires.length, 3);
  assert.equal(s.junctionCount(), 0);
});
void test('an invalid drop onto a driven net never changes another free input or leaves a splice', () => {
  const s = connectedSheet();
  const before = s.project;
  s.pressPort('gain', 'y');
  assert.throws(() => s.release({ x: 120, y: 68 }), /already has a source/);
  assert.equal(s.project, before);
  assert.equal(s.junctionCount(), 0);
  assert.ok(
    !flattenWires(s.project).some(
      (w) => w.target === 'sum' && w.targetHandle === 'b',
    ),
  );
  s.cancel();
  assert.equal(s.project, before);
});
void test('the entire source net is excluded when branching from a junction', () => {
  const s = connectedSheet();
  s.project = {
    ...s.project,
    blocks: [...s.project.blocks, place('scope', 'scope', 200, 200)],
  };
  s.pressPort('scope', 'u');
  s.release({ x: 120, y: 68 });
  const j = s.project.junctions![0];
  s.pressJunction(j.id);
  s.move(90, 68);
  assert.equal(s.target, null);
  assert.equal(s.ignoreWireIds.length, 3);
});
void test('alignment outside segment extents does not join the net', () => {
  const s = connectedSheet();
  s.project = {
    ...s.project,
    blocks: [...s.project.blocks, place('scope', 'scope', 200, 200)],
  };
  s.pressPort('scope', 'u');
  s.release({ x: 500, y: 70 });
  assert.equal(s.mode, 'drawing');
  assert.equal(s.junctionCount(), 0);
  assert.equal(s.project.wires.length, 2);
  assert.equal(s.cursor.y, 68);
});
void test('hit tolerance scales with zoom and is independent of the twenty-unit block grid', () => {
  for (const zoom of [0.5, 1, 2]) {
    const s = connectedSheet();
    s.zoom = zoom;
    s.project = {
      ...s.project,
      blocks: [...s.project.blocks, place('scope', 'scope', 220, 200)],
    };
    s.pressPort('scope', 'u');
    s.release({ x: 121.3, y: 68 + 5 / zoom });
    assert.equal(s.mode, 'idle');
    assert.equal(s.junctionCount(), 1);
    assert.equal(s.project.junctions![0].position.x, 121.3);
  }
});
void test('subpixel offsets never become diagonal segments', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.release({ x: 130.1, y: 150.03 });
  s.click({ x: 130.1, y: 150.03 });
  s.click(port(s.project, 'gain', 'u'));
  orthogonal(s.pathPoints(s.project.wires[0].id));
});
void test('cancel after grabbing an existing wire restores the original document identity', () => {
  const s = connectedSheet();
  const before = s.project;
  assert.ok(s.pressSegment({ x: 120, y: 68 }));
  s.move(120, 180);
  s.release({ x: 120, y: 180 });
  s.click({ x: 120, y: 180 });
  s.cancel();
  assert.equal(s.project, before);
});
void test('moving a real junction keeps all incident paths orthogonal and simulation unchanged', () => {
  const s = connectedSheet();
  s.project = {
    ...s.project,
    blocks: [...s.project.blocks, place('scope', 'scope', 220, 200)],
  };
  s.pressPort('scope', 'u');
  s.release({ x: 120, y: 68 });
  const before = flattenWires(s.project);
  const j = s.project.junctions![0];
  s.moveJunction(j.id, 140, 120);
  s.project.wires.forEach((w) => orthogonal(s.pathPoints(w.id)));
  assert.deepEqual(flattenWires(s.project), before);
});
void test('physical junctions flatten to a unique spanning tree regardless of edge direction', () => {
  const p = {
    ...sheet(),
    blocks: [
      place('resistor', 'a', 0, 0),
      place('resistor', 'b', 200, 0),
      place('resistor', 'c', 400, 0),
    ],
    wires: [],
    junctions: [],
  };
  const handles = p.blocks.map((b) => b.definition.ports[0].id);
  const s = new NetSession(p);
  s.pressPort('a', handles[0]);
  s.release(port(s.project, 'b', handles[1]));
  s.pressPort('c', handles[2]);
  s.release(port(s.project, 'b', handles[1]));
  assert.equal(flattenWires(s.project).length, 2);
  assert.deepEqual(
    flattenWires({
      ...s.project,
      wires: s.project.wires.map((w) => ({
        ...w,
        source: w.target,
        sourceHandle: w.targetHandle,
        target: w.source,
        targetHandle: w.sourceHandle,
      })),
    }),
    flattenWires(s.project),
  );
});
void test('automatic return rails on distinct nets occupy different lanes', () => {
  const p = {
    ...sheet(),
    blocks: [
      place('gain', 'a', 400, 0),
      place('gain', 'b', 0, 0),
      place('gain', 'c', 400, 140),
      place('gain', 'd', 0, 140),
    ],
    wires: [
      {
        id: 'ab',
        source: 'a',
        sourceHandle: 'y',
        target: 'b',
        targetHandle: 'u',
      },
      {
        id: 'cd',
        source: 'c',
        sourceHandle: 'y',
        target: 'd',
        targetHandle: 'u',
      },
    ],
  };
  const s = new NetSession(p);
  const a = s.pathPoints('ab'),
    b = s.pathPoints('cd');
  orthogonal(a);
  orthogonal(b);
  const railA = Math.max(...a.map((p) => p.y)),
    railB = Math.max(...b.map((p) => p.y));
  assert.equal(railB - railA, 8);
});

void test('deleting the last branch removes its junction and preserves the original connection', async () => {
  const { removeSelection, semanticSignature } =
    await import('../lib/gradara/project');
  const s = connectedSheet();
  s.project = {
    ...s.project,
    blocks: [...s.project.blocks, place('scope', 'scope', 220, 200)],
  };
  const baseline = s.project;
  s.pressPort('scope', 'u');
  s.release({ x: 120, y: 68 });
  const branch = s.project.wires.find((w) => w.target === 'scope')!;
  const pruned = removeSelection(s.project, [], [branch.id]);
  assert.equal(pruned.junctions?.length, 0);
  assert.equal(semanticSignature(pruned), semanticSignature(baseline));
  pruned.wires.forEach((w) =>
    orthogonal(new NetSession(pruned).pathPoints(w.id)),
  );
});
void test('a splice on a lane-offset auto route uses the displayed lane', () => {
  const p = {
    ...sheet(),
    blocks: [
      place('gain', 'a', 400, 0),
      place('gain', 'b', 0, 0),
      place('gain', 'c', 400, 140),
      place('gain', 'd', 0, 140),
    ],
    wires: [
      {
        id: 'ab',
        source: 'a',
        sourceHandle: 'y',
        target: 'b',
        targetHandle: 'u',
      },
      {
        id: 'cd',
        source: 'c',
        sourceHandle: 'y',
        target: 'd',
        targetHandle: 'u',
      },
    ],
  };
  const s = new NetSession(p);
  const rail = Math.max(...s.pathPoints('cd').map((p) => p.y));
  const end = s.spliceAt('cd', { x: 200, y: rail });
  assert.ok(end);
  assert.equal(s.project.junctions![0].position.y, rail);
});

function editableSheet() {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.release(port(s.project, 'gain', 'u'));
  return s;
}
void test('reconnect either endpoint keeps its wire ID and changes only that connection', () => {
  for (const end of ['source', 'target'] as const) {
    const s = editableSheet();
    const id = s.project.wires[0].id;
    s.project = {
      ...s.project,
      blocks: [...s.project.blocks, place('step', 'other', 0, 200)],
    };
    s.reconnect(id, end);
    s.release(
      port(
        s.project,
        end === 'source' ? 'other' : 'sum',
        end === 'source' ? 'y' : 'a',
      ),
    );
    assert.equal(s.mode, 'idle');
    assert.equal(s.project.wires.length, 1);
    assert.equal(s.project.wires[0].id, id);
    assert.equal(s.project.wires[0][end], end === 'source' ? 'other' : 'sum');
    orthogonal(s.pathPoints(id));
  }
});
void test('dropping an endpoint back on its old port is a true no-op', () => {
  const s = editableSheet(),
    original = s.project,
    id = original.wires[0].id;
  s.reconnect(id, 'target');
  s.release(port(s.project, 'gain', 'u'));
  assert.equal(s.project, original);
  assert.equal(s.mode, 'idle');
});
void test('invalid reconnection stays provisional and Escape restores the exact original', () => {
  const s = editableSheet(),
    original = s.project,
    id = original.wires[0].id;
  s.reconnect(id, 'target');
  assert.throws(
    () => s.release(port(s.project, 'gain', 'y')),
    /output|driver|source/i,
  );
  assert.equal(s.mode, 'drawing');
  assert.equal(s.project.wires.length, 0);
  s.cancel();
  assert.equal(s.project, original);
  assert.equal(s.editing, null);
});
void test('reconnecting a source to another wire makes a real branch and preserves the edited ID', () => {
  const s = editableSheet();
  s.project = {
    ...s.project,
    blocks: [
      ...s.project.blocks,
      place('step', 'other', 0, 240),
      place('scope', 'scope', 300, 228),
    ],
  };
  s.pressPort('other', 'y');
  s.release(port(s.project, 'scope', 'u'));
  const edited = s.project.wires[0].id;
  s.reconnect(edited, 'source');
  s.release({ x: 120, y: 268 });
  assert.equal(s.mode, 'idle');
  assert.equal(s.project.junctions!.length, 1);
  assert.ok(s.project.wires.some((w) => w.id === edited));
  assert.deepEqual(
    flattenWires(s.project)
      .map((w) => [w.source, w.target])
      .sort((a, b) => a.join('.').localeCompare(b.join('.'))),
    [
      ['other', 'gain'],
      ['other', 'scope'],
    ],
  );
  s.project.wires.forEach((w) => orthogonal(s.pathPoints(w.id)));
});
void test('redraw pins a new route while preserving endpoints, identity and simulation', () => {
  const s = editableSheet(),
    original = s.project,
    id = original.wires[0].id;
  const signature = semanticSignature(original);
  s.redraw(id);
  s.click({ x: 110, y: 180 });
  s.click({ x: 250, y: 180 });
  s.finishRedraw();
  assert.equal(s.mode, 'idle');
  assert.equal(s.project.wires[0].id, id);
  assert.equal(semanticSignature(s.project), signature);
  assert.ok(s.project.wires[0].waypoints?.some((p) => p.y === 180));
  orthogonal(s.pathPoints(id));
  assert.equal(original.wires[0].waypoints, undefined);
});
void test('redraw can finish at its destination but cannot change its endpoints', () => {
  const s = editableSheet(),
    original = s.project,
    id = original.wires[0].id;
  s.redraw(id);
  assert.throws(
    () => s.click(port(s.project, 'sum', 'a')),
    /highlighted endpoint/,
  );
  s.click({ x: 140, y: 160 });
  s.click(port(s.project, 'gain', 'u'));
  assert.equal(s.mode, 'idle');
  assert.equal(semanticSignature(s.project), semanticSignature(original));
});
void test('cancel redraw and unpin restore geometry without modifying cached routes', () => {
  const s = editableSheet(),
    original = s.project,
    id = original.wires[0].id;
  const cached = structuredClone(s.pathPoints(id));
  s.redraw(id);
  s.click({ x: 130, y: 180 });
  s.unpin();
  assert.deepEqual(s.corners, []);
  s.click({ x: 130, y: 200 });
  s.cancel();
  assert.equal(s.project, original);
  assert.deepEqual(s.pathPoints(id), cached);
});
void test('sliding a straight connection creates a dogleg and retains both port normals', () => {
  const s = editableSheet(),
    original = s.project,
    id = original.wires[0].id;
  const cached = structuredClone(s.pathPoints(id));
  const slid = slideSegment(original, id, 0, 70);
  const points = new NetSession(slid).pathPoints(id);
  orthogonal(points);
  assert.deepEqual(points[0], cached[0]);
  assert.deepEqual(points.at(-1), cached.at(-1));
  assert.ok(points.some((p) => p.y === 138));
  assert.equal(points[1].y, points[0].y);
  assert.ok(points[1].x > points[0].x);
  assert.equal(points.at(-2)!.y, points.at(-1)!.y);
  assert.ok(points.at(-2)!.x < points.at(-1)!.x);
  assert.equal(semanticSignature(slid), semanticSignature(original));
  assert.deepEqual(s.pathPoints(id), cached);
});
void test('every run of a hand-routed wire slides orthogonally without changing endpoints', () => {
  const s = editableSheet(),
    id = s.project.wires[0].id;
  s.redraw(id);
  s.click({ x: 110, y: 180 });
  s.click({ x: 250, y: 180 });
  s.finishRedraw();
  const original = s.project,
    before = structuredClone(s.pathPoints(id));
  for (let i = 0; i < before.length - 1; i++) {
    const p = new NetSession(slideSegment(original, id, i, 30)).pathPoints(id);
    orthogonal(p);
    assert.deepEqual(p[0], before[0]);
    assert.deepEqual(p.at(-1), before.at(-1));
  }
  assert.deepEqual(s.pathPoints(id), before);
});
void test('moving a vertex never mutates the cached original route', () => {
  const s = editableSheet(),
    id = s.project.wires[0].id;
  s.project = slideSegment(s.project, id, 0, 70);
  const original = s.project,
    before = structuredClone(s.pathPoints(id));
  const moved = moveVertex(original, id, 2, { x: 120, y: 160 });
  assert.deepEqual(s.pathPoints(id), before);
  orthogonal(new NetSession(moved).pathPoints(id));
});
void test('segment alignment uses screen-pixel tolerance across zoom levels', () => {
  const s = editableSheet(),
    id = s.project.wires[0].id;
  for (const zoom of [0.5, 1, 2]) {
    const result = snappedSegment(
      s.project,
      id,
      0,
      { x: 150, y: 150 + 5 / zoom },
      zoom,
      [{ axis: 'y', value: 150 }],
    );
    assert.ok(
      new NetSession(result.project).pathPoints(id).some((p) => p.y === 150),
    );
    assert.deepEqual(result.guides, [{ axis: 'y', value: 150 }]);
  }
});

void test('finishing a manually drawn route turns at the last pinned corner, not beyond it', () => {
  const s = editableSheet(),
    id = s.project.wires[0].id;
  s.redraw(id);
  s.click({ x: 120, y: 160 });
  s.click({ x: 240, y: 160 });
  s.finishRedraw();
  const points = s.pathPoints(id);
  assert.ok(
    points.some(
      (p, i) => p.x === 240 && p.y === 160 && points[i + 1]?.x === 240,
    ),
  );
  orthogonal(points);
});

void test('closely stacked blocks never double back through an input port', () => {
  const cases = [
    [{ x: 492, y: 68 }, { x: 500, y: 272 }, Position.Right, Position.Left],
    [{ x: 500, y: 272 }, { x: 492, y: 68 }, Position.Left, Position.Right],
    [{ x: 68, y: 492 }, { x: 272, y: 500 }, Position.Bottom, Position.Top],
    [{ x: 272, y: 500 }, { x: 68, y: 492 }, Position.Top, Position.Bottom],
  ] as const;
  for (const [from, to, exit, entry] of cases) {
    const points = routeBetween(from, to, exit, entry);
    orthogonal(points);
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1],
        b = points[i],
        c = points[i + 1];
      assert.ok(
        (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0,
        JSON.stringify(points),
      );
    }
  }
});

void test('redrawing a path never splices another wire that starts at its destination', () => {
  const s = editableSheet();
  s.project = {
    ...s.project,
    blocks: [...s.project.blocks, place('scope', 'scope', 420, 200)],
  };
  s.pressPort('gain', 'u');
  // A second consumer shares the input endpoint as part of the same signal net.
  s.release(port(s.project, 'scope', 'u'));
  const id = s.project.wires[0].id,
    before = s.project;
  s.redraw(id);
  const other = s.project.wires[0].id,
    pts = s.pathPoints(other);
  const a = pts[1],
    b = pts[2];
  s.move((a.x + b.x) / 2, (a.y + b.y) / 2);
  assert.equal(s.target, null);
  s.cancel();
  assert.equal(s.project, before);
});
void test('reconnecting a manually routed end preserves the fixed portion', () => {
  const s = editableSheet(),
    id = s.project.wires[0].id;
  s.project = {
    ...s.project,
    blocks: [...s.project.blocks, place('scope', 'scope', 400, 240)],
  };
  s.redraw(id);
  s.click({ x: 120, y: 180 });
  s.click({ x: 240, y: 180 });
  s.finishRedraw();
  const old = s.pathPoints(id);
  s.reconnect(id, 'target');
  s.release(port(s.project, 'scope', 'u'));
  assert.equal(s.mode, 'idle');
  assert.deepEqual(s.pathPoints(id).slice(0, 3), old.slice(0, 3));
  assert.equal(s.project.wires[0].id, id);
  orthogonal(s.pathPoints(id));
});
void test('physical endpoint reconnection preserves the domain and removes the old participant', () => {
  const s = new NetSession({
    ...sheet(),
    blocks: [
      place('resistor', 'a', 0, 0),
      place('resistor', 'b', 200, 0),
      place('resistor', 'c', 400, 120),
    ],
  });
  const handle = s.project.blocks[0].definition.ports[0].id;
  s.pressPort('a', handle);
  s.release(port(s.project, 'b', handle));
  const id = s.project.wires[0].id;
  s.reconnect(id, 'target');
  s.release(port(s.project, 'c', handle));
  assert.equal(s.mode, 'idle');
  assert.equal(s.project.wires[0].target, 'c');
  assert.equal(flattenWires(s.project).length, 1);
  orthogonal(s.pathPoints(id));
});
