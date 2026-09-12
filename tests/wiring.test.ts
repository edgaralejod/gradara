import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, library, type Project } from '../lib/gradara/model';
import { blockSize } from '../lib/gradara/canvas';
import { portPoint } from '../lib/gradara/ports';
import { flattenWires } from '../lib/gradara/net';
import { firstSegmentHorizontal, nearly } from '../lib/gradara/net-draw';
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

test('fixture ports sit on a shared row so geometry is exact', () => {
  const p = sheet();
  assert.equal(blockSize(p.blocks[0]).width, 64);
  assert.equal(port(p, 'step', 'y').x, 64);
  assert.equal(port(p, 'step', 'y').y, 68);
  assert.equal(port(p, 'sum', 'a').x, 180);
  assert.equal(port(p, 'sum', 'a').y, 68);
  assert.equal(port(p, 'gain', 'u').y, 68);
});

test('1 pin exit: first segment leaves a right port horizontally', () => {
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

test('2 click pins a vertex and does not create a junction graphic', () => {
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

test('3 anchors magnetize a second wire to an existing run Y without joining', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.move(180, 68);
  s.release({ x: 180, y: 68 });
  assert.equal(s.project.wires.length, 1);
  const sat = place('saturation', 'sat', 300, 160);
  s.project = { ...s.project, blocks: [...s.project.blocks, sat] };
  s.pressPort('sat', 'u');
  s.move(120, 70);
  assert.ok(s.guides.some((g) => g.axis === 'y' && nearly(g.value, 68)));
  assert.equal(s.project.wires.length, 1);
});

test('4 drop on ink creates a junction; dragging it moves the T', () => {
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

test('5 unpinned feedback is a U under the blocks, not along the trunk', () => {
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

test('6 drawn feedback keeps vertices and adds no junction', () => {
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

test('7 branch from a junction does not collapse onto its own net', () => {
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

test('8 Esc / cancel while drawing leaves the sheet unchanged', () => {
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

test('9 two distinct nets do not occupy the same pixels unless snapped as a suggestion', () => {
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
  const ay = new Set(a.filter((_, i, pts) => pts[i + 1] && nearly(pts[i].y, pts[i + 1].y)).map((p) => Math.round(p.y)));
  const by = new Set(b.filter((_, i, pts) => pts[i + 1] && nearly(pts[i].y, pts[i + 1].y)).map((p) => Math.round(p.y)));
  const shared = [...ay].filter((y) => by.has(y));
  assert.ok(
    shared.length === 0 || shared.every((y) => y !== 68 || gy.y === 68),
    'a second net must not sit on the first trunk',
  );
  void u;
});

test('10 flatten ignores vertices; occupancy stays one driver per input', () => {
  const s = new NetSession(sheet());
  s.pressPort('step', 'y');
  s.release({ x: 140, y: 20 });
  s.click({ x: 140, y: 20 });
  s.click({ x: 180, y: 68 });
  const pairs = flattenWires(s.project);
  assert.deepEqual(pairs.map((w) => [w.source, w.sourceHandle, w.target, w.targetHandle]), [
    ['step', 'y', 'sum', 'a'],
  ]);
  assert.throws(() => {
    s.pressPort('gain', 'y');
    s.release({ x: 180, y: 68 });
  });
});
