/**
 * Auto arrange: redraw a block diagram in house style.
 *
 * Placement follows the terminals. A terminal on a block's right side wants what it
 * connects to on its right; one on the bottom wants it below. Every connection says, for
 * each axis, which of its two blocks comes first, so the drawing's columns and rows come
 * from the model itself: signal flow reads left to right, feedback and measurement run
 * underneath, a ground sits under its terminal, a shaft drops to its load. Where the
 * terminals do not decide, the current drawing does, so running it again changes nothing
 * and a rough arrangement keeps its order.
 *
 * Blocks go on columns and rows sized to the real blocks and names, connected terminals
 * are pulled onto one line so wires run straight, and then every wire is left to the
 * sheet router (router.ts), which draws it around blocks and off other nets.
 */
import { blockSize } from './canvas';
import type { Block, Project, Wire } from './model';
import { flattenWires, isTap, netComponents } from './net';
import { portPoint, type Side } from './ports';
import type { Pt } from './routing';
import { labelOf } from './router';

/** Port-to-port distance of a straight connection; matches the curated templates. */
const GAP = 96;
/** Space between rows, beyond the block and its name. */
const ROW_GAP = 72;
const GRID = 20;
const ORIGIN = { x: 40, y: 80 };

/** "a comes before b" on one axis, with how much the model cares. */
type Order = { a: string; b: string; weight: number };
/** Two terminals that read best on one straight line (same y, or same x). */
type Pair = {
  a: string;
  portA: string;
  b: string;
  portB: string;
  axis: 'x' | 'y';
  weight: number;
};

type Terminal = { block: string; port: string; side: Side; signal: boolean };

/**
 * What the terminals say about placement, net by net. A net is a line (a rail): a
 * terminal facing right starts it on the left, one facing left ends it on the right,
 * and terminals facing up or down hang under or over it in between. So on each net:
 * right-facing < up/down-facing < left-facing along x, and down-facing (over the rail)
 * < right/left-facing (on it) < up-facing (under it) along y. Terminals facing the same
 * way on one net are siblings: parallel branches spread along the rail, fan-out stacks.
 */
function relations(project: Project, ids: Set<string>) {
  const x: Order[] = [],
    y: Order[] = [];
  const pairs: Pair[] = [];
  const siblings: { axis: 'x' | 'y'; blocks: string[] }[] = [];
  for (const component of netComponents(project)) {
    const terminals: Terminal[] = [];
    for (const key of component) {
      if (key.startsWith('j:')) continue;
      const dot = key.lastIndexOf('.');
      const block = key.slice(0, dot),
        port = key.slice(dot + 1);
      if (!ids.has(block)) continue;
      const b = project.blocks.find((q) => q.id === block);
      const point = b && portPoint(b, port);
      const def = b?.definition.ports.find((q) => q.id === port);
      if (!point || !def) continue;
      terminals.push({
        block,
        port,
        side: point.side,
        signal: def.direction !== 'physical',
      });
    }
    if (terminals.length < 2) continue;
    const signal = terminals.some((t) => t.signal);
    const weight = signal ? 3 : 2;
    const of = (side: Side) => terminals.filter((t) => t.side === side);
    const R = of('right'),
      L = of('left'),
      U = of('top'),
      D = of('bottom');
    const add = (list: Order[], a: Terminal[], b: Terminal[], w: number) => {
      for (const p of a)
        for (const q of b)
          if (p.block !== q.block)
            list.push({ a: p.block, b: q.block, weight: w });
    };
    add(x, R, [...U, ...D, ...L], weight);
    add(x, [...U, ...D], L, weight);
    add(y, D, [...R, ...L, ...U], weight);
    add(y, [...R, ...L], U, weight);
    // Siblings: branches along the rail side by side, fan-out one under another.
    // Their order is settled later, once the stronger orders are known.
    for (const [group, axis] of [
      [U, 'x'],
      [D, 'x'],
      [R, 'y'],
      [L, 'y'],
    ] as const) {
      const blocksOf = [...new Set(group.map((t) => t.block))];
      if (blocksOf.length > 1) siblings.push({ axis, blocks: blocksOf });
    }
    for (const p of R)
      for (const q of L)
        if (p.block !== q.block)
          pairs.push({
            a: p.block,
            portA: p.port,
            b: q.block,
            portB: q.port,
            axis: 'y',
            weight,
          });
    for (const p of D)
      for (const q of U)
        if (p.block !== q.block)
          pairs.push({
            a: p.block,
            portA: p.port,
            b: q.block,
            portB: q.port,
            axis: 'x',
            weight,
          });
  }
  return { x, y, pairs, siblings };
}

/**
 * Order the blocks along one axis: every link says "a before b" (or after), and cycles
 * are broken by dropping the lightest links that point against the current drawing.
 * Returns each block's rank (its column or row) by longest path over the kept links.
 */
function ranks(
  ids: string[],
  before: [string, string, number][],
  current: Map<string, number>,
): { rank: Map<string, number>; kept: Set<number> } {
  const byCurrent = [...ids].sort(
    (a, b) => current.get(a)! - current.get(b)! || a.localeCompare(b),
  );
  // Greedy feedback-arc removal (Eades, Lin, Smyth), ties by current position.
  const out = new Map(ids.map((id) => [id, new Map<string, number>()]));
  const inn = new Map(ids.map((id) => [id, new Map<string, number>()]));
  before.forEach(([a, b, w]) => {
    if (a === b) return;
    out.get(a)!.set(b, (out.get(a)!.get(b) ?? 0) + w);
    inn.get(b)!.set(a, (inn.get(b)!.get(a) ?? 0) + w);
  });
  const alive = new Set(ids);
  const left: string[] = [],
    right: string[] = [];
  const weight = (m: Map<string, number>) => {
    let t = 0;
    for (const [k, v] of m) if (alive.has(k)) t += v;
    return t;
  };
  while (alive.size) {
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of byCurrent)
        if (alive.has(id) && weight(out.get(id)!) === 0) {
          right.unshift(id);
          alive.delete(id);
          progress = true;
        }
      for (const id of byCurrent)
        if (alive.has(id) && weight(inn.get(id)!) === 0) {
          left.push(id);
          alive.delete(id);
          progress = true;
        }
    }
    if (!alive.size) break;
    let pick: string | undefined,
      best = -Infinity;
    for (const id of byCurrent) {
      if (!alive.has(id)) continue;
      const score = weight(out.get(id)!) - weight(inn.get(id)!);
      if (score > best) {
        best = score;
        pick = id;
      }
    }
    left.push(pick!);
    alive.delete(pick!);
  }
  const order = new Map([...left, ...right].map((id, i) => [id, i]));
  const kept = new Set<number>();
  before.forEach(([a, b], i) => {
    if (order.get(a)! < order.get(b)!) kept.add(i);
  });
  const rank = new Map(ids.map((id) => [id, 0]));
  for (const id of [...left, ...right])
    before.forEach(([a, b], i) => {
      if (kept.has(i) && a === id)
        rank.set(b, Math.max(rank.get(b)!, rank.get(a)! + 1));
    });
  return { rank, kept };
}

const snap = (v: number) => Math.round(v / GRID) * GRID;

type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect, margin = 0) =>
  a.x < b.x + b.width + margin &&
  b.x < a.x + a.width + margin &&
  a.y < b.y + b.height + margin &&
  b.y < a.y + a.height + margin;

/** The area a block claims: its body and its name. */
function claim(block: Block): Rect {
  const body = { ...block.position, ...blockSize(block) };
  const label = labelOf(block);
  const x = Math.min(body.x, label.x),
    y = Math.min(body.y, label.y);
  return {
    x,
    y,
    width: Math.max(body.x + body.width, label.x + label.width) - x,
    height: Math.max(body.y + body.height, label.y + label.height) - y,
  };
}

/** Place `ids` in columns and rows derived from their terminals. Positions only. */
function place(
  project: Project,
  ids: string[],
): Map<string, Block['position']> {
  const set = new Set(ids);
  const blocks = new Map(
    project.blocks.filter((b) => set.has(b.id)).map((b) => [b.id, b]),
  );
  const centers = new Map(
    ids.map((id) => {
      const b = blocks.get(id)!;
      const s = blockSize(b);
      return [
        id,
        { x: b.position.x + s.width / 2, y: b.position.y + s.height / 2 },
      ];
    }),
  );
  const relation = relations(project, set);
  const { pairs } = relation;
  const cx = new Map(ids.map((id) => [id, centers.get(id)!.x]));
  const cy = new Map(ids.map((id) => [id, centers.get(id)!.y]));
  // Where a block sits in the flow, independent of where it is drawn now: its
  // distance from a block nothing feeds. The current drawing only breaks ties.
  const depth = (orders: Order[], current: Map<string, number>) => {
    const into = new Map(ids.map((id) => [id, 0]));
    for (const o of orders) into.set(o.b, into.get(o.b)! + 1);
    const d = new Map<string, number>();
    const queue = ids.filter((id) => !into.get(id));
    queue.forEach((id) => d.set(id, 0));
    for (let i = 0; i < queue.length; i++)
      for (const o of orders)
        if (o.a === queue[i] && !d.has(o.b)) {
          d.set(o.b, d.get(o.a)! + 1);
          queue.push(o.b);
        }
    const spread = Math.max(1, ...[...current.values()].map(Math.abs)) * 4;
    return new Map(
      ids.map((id) => [
        id,
        (d.get(id) ?? ids.length) * spread + current.get(id)!,
      ]),
    );
  };
  /** Orders on one axis: the terminals' orders, then siblings in flow order. */
  const settle = (axis: 'x' | 'y', current: Map<string, number>) => {
    const strong = relation[axis];
    const key = depth(strong, current);
    const first = ranks(
      ids,
      strong.map((o) => [o.a, o.b, o.weight]),
      key,
    ).rank;
    const orders = [...strong];
    for (const group of relation.siblings.filter((g) => g.axis === axis)) {
      const sorted = [...group.blocks].sort(
        (a, b) =>
          first.get(a)! - first.get(b)! ||
          key.get(a)! - key.get(b)! ||
          a.localeCompare(b),
      );
      for (let i = 1; i < sorted.length; i++)
        orders.push({ a: sorted[i - 1], b: sorted[i], weight: 1 });
    }
    return { orders, key };
  };
  const xs = settle('x', cx);
  const x = xs.orders;
  const y = settle('y', cy).orders;
  const cols = ranks(
    ids,
    x.map((o) => [o.a, o.b, o.weight]),
    xs.key,
  ).rank;
  console.log(JSON.stringify([...cols].sort((a, b) => a[1] - b[1])));
  // Blocks that nothing orders along x take the column of what they hang from.
  const xTied = new Set(x.flatMap((o) => [o.a, o.b]));
  for (const id of ids) {
    if (xTied.has(id)) continue;
    const partners = pairs
      .filter((p) => p.axis === 'x' && (p.a === id || p.b === id))
      .map((p) => (p.a === id ? p.b : p.a))
      .filter((q) => xTied.has(q));
    if (partners.length)
      cols.set(
        id,
        Math.round(
          partners.reduce((t, q) => t + cols.get(q)!, 0) / partners.length,
        ),
      );
  }
  // Columns sized to the real blocks and their names.
  const colIds = [...new Set(cols.values())].sort((a, b) => a - b);
  const colX = new Map<number, number>();
  const colW = new Map<number, number>();
  let left = ORIGIN.x;
  for (const c of colIds) {
    const members = ids.filter((id) => cols.get(id) === c);
    const w = Math.max(
      ...members.map((id) => blockSize(blocks.get(id)!).width),
    );
    const named = Math.max(
      ...members.map((id) => claim(blocks.get(id)!).width),
    );
    colX.set(c, left + Math.max(0, (named - w) / 2));
    colW.set(c, w);
    left += snap(Math.max(w + GAP, named + 2 * GRID));
  }
  const size = new Map(ids.map((id) => [id, blockSize(blocks.get(id)!)]));
  const xOf = (id: string) =>
    colX.get(cols.get(id)!)! +
    (colW.get(cols.get(id)!)! - size.get(id)!.width) / 2;
  // Each column is a stack. Within it, the terminals decide who is above whom
  // (y orders between members), and the rest follows the connections.
  const above = new Map<string, Set<string>>();
  for (const o of y)
    if (cols.get(o.a) === cols.get(o.b) && o.a !== o.b) {
      const set = above.get(o.b) ?? new Set<string>();
      set.add(o.a);
      above.set(o.b, set);
    }
  const members = new Map<number, string[]>();
  for (const id of ids) {
    const c = cols.get(id)!;
    members.set(c, [...(members.get(c) ?? []), id]);
  }
  /** Order a stack by key, never putting a block above one the terminals put over it. */
  const orderStack = (list: string[], key: (id: string) => number) => {
    const rest = [...list].sort(
      (a, b) => key(a) - key(b) || a.localeCompare(b),
    );
    const out: string[] = [];
    while (rest.length) {
      let i = rest.findIndex((id) =>
        [...(above.get(id) ?? [])].every((o) => !rest.includes(o)),
      );
      if (i < 0) i = 0; // a cycle among the stack: fall back to the key
      out.push(rest.splice(i, 1)[0]);
    }
    return out;
  };
  const initial = new Map(ids.map((id) => [id, blocks.get(id)!.position.y]));
  let top = new Map(initial);
  const pitch = (id: string) =>
    claim({ ...blocks.get(id)!, position: { x: 0, y: 0 } }).height +
    ROW_GAP / 2;
  const portAt = (id: string, port: string, yTop: number) =>
    portPoint({ ...blocks.get(id)!, position: { x: xOf(id), y: yTop } }, port)!;
  // Every connection, for ordering stacks so wires cross as little as possible.
  const links: { a: string; portA: string; b: string; portB: string }[] = [];
  for (const w of flattenWires(project))
    if (set.has(w.source) && set.has(w.target) && w.source !== w.target)
      links.push({
        a: w.source,
        portA: w.sourceHandle,
        b: w.target,
        portB: w.targetHandle,
      });
  const bary = (id: string, placed: (other: string) => boolean) => {
    let total = 0,
      count = 0;
    for (const l of links) {
      if (l.a !== id && l.b !== id) continue;
      const other = l.a === id ? l.b : l.a;
      if (!placed(other)) continue;
      const mine = l.a === id ? l.portA : l.portB;
      const theirs = l.a === id ? l.portB : l.portA;
      total +=
        portAt(other, theirs, top.get(other)!).y -
        (portAt(id, mine, top.get(id)!).y - top.get(id)!);
      count++;
    }
    return count ? total / count : undefined;
  };
  const solve = (backward: boolean) => {
    top = new Map(initial);
    // Start from the flow, not from the old drawing: stack each column in the order of
    // what feeds it (the old height only breaks ties), left to right.
    const seeded = new Set<string>();
    for (const c of backward ? [...colIds].reverse() : colIds) {
      const list = members.get(c)!;
      const key = new Map(
        list.map((id) => [id, bary(id, (o) => seeded.has(o)) ?? top.get(id)!]),
      );
      let y0 = ORIGIN.y;
      for (const id of orderStack(
        list,
        (id) => key.get(id)! + top.get(id)! / 1e6,
      )) {
        top.set(id, y0);
        y0 += pitch(id);
        seeded.add(id);
      }
    }
    const stacks = new Map(
      [...members].map(([c, list]) => [
        c,
        orderStack(list, (id) => top.get(id)!),
      ]),
    );
    for (let round = 0; round < 60; round++) {
      const before = new Map(top);
      const sweep = round % 2 === 0 ? colIds : [...colIds].reverse();
      for (const c of sweep) {
        const list = stacks.get(c)!;
        const want = new Map<string, { value: number; weight: number }>();
        for (const id of list) {
          let total = 0,
            weight = 0;
          for (const p of pairs) {
            if (p.a !== id && p.b !== id) continue;
            const mine = p.a === id ? p.portA : p.portB;
            const other = p.a === id ? p.b : p.a;
            const theirs = p.a === id ? p.portB : p.portA;
            if (p.axis === 'y') {
              // Put my terminal on the line of the one I connect to.
              const here = portAt(id, mine, top.get(id)!).y - top.get(id)!;
              const there = portAt(other, theirs, top.get(other)!).y;
              const near = Math.abs(cols.get(other)! - c) <= 1 ? 2 : 1;
              total += (there - here) * p.weight * near;
              weight += p.weight * near;
            } else {
              // Over or under what I connect to: right next to it in my own stack,
              // clear of it (one row down or up) when it stands in another column.
              const under = p.b === id;
              const target = under
                ? top.get(other)! + pitch(other)
                : top.get(other)! - pitch(id);
              const w = cols.get(other) === c ? 1 : 0.5;
              total += target * w;
              weight += w;
            }
          }
          want.set(id, {
            value: weight ? total / weight : top.get(id)!,
            weight: weight || 0.25,
          });
        }
        const ordered = orderStack(
          list,
          (id) => bary(id, () => true) ?? want.get(id)!.value,
        );
        stacks.set(c, ordered);
        // Pack the stack: closest to what each block wants, in order, never overlapping
        // (pool-adjacent-violators on weighted least squares).
        type Pool = {
          start: number;
          end: number;
          sum: number;
          weight: number;
          offset: number[];
        };
        const pools: Pool[] = [];
        let offset = 0;
        const offsets = ordered.map((id) => {
          const o = offset;
          offset += pitch(id);
          return o;
        });
        ordered.forEach((id, i) => {
          const w = want.get(id)!;
          pools.push({
            start: i,
            end: i,
            sum: (w.value - offsets[i]) * w.weight,
            weight: w.weight,
            offset: [],
          });
          while (pools.length > 1) {
            const b = pools[pools.length - 1],
              a = pools[pools.length - 2];
            if (a.sum / a.weight <= b.sum / b.weight) break;
            pools.splice(pools.length - 2, 2, {
              start: a.start,
              end: b.end,
              sum: a.sum + b.sum,
              weight: a.weight + b.weight,
              offset: [],
            });
          }
        });
        for (const pool of pools)
          for (let i = pool.start; i <= pool.end; i++)
            top.set(ordered[i], pool.sum / pool.weight + offsets[i]);
      }
      // Settled: nothing moves by more than a fraction of a unit.
      if (
        round % 2 === 1 &&
        ids.every((id) => Math.abs(top.get(id)! - before.get(id)!) < 0.05)
      )
        break;
    }
    return top;
  };
  // Two starts (seeded from the sources, and from the sinks); keep the one whose
  // connections cross least and run straightest.
  const cost = (t: Map<string, number>) => {
    const ends = links.map((l) => ({
      a: portAt(l.a, l.portA, t.get(l.a)!),
      b: portAt(l.b, l.portB, t.get(l.b)!),
    }));
    let total = 0;
    for (const e of ends) total += Math.abs(e.a.y - e.b.y);
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        const p = ends[i],
          q = ends[j];
        const [p0, p1] = p.a.x <= p.b.x ? [p.a, p.b] : [p.b, p.a];
        const [q0, q1] = q.a.x <= q.b.x ? [q.a, q.b] : [q.b, q.a];
        const lo = Math.max(p0.x, q0.x),
          hi = Math.min(p1.x, q1.x);
        if (hi <= lo) continue;
        const at = (a: Pt, b: Pt, x: number) =>
          b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
        if (
          (at(p0, p1, lo) - at(q0, q1, lo)) *
            (at(p0, p1, hi) - at(q0, q1, hi)) <
          0
        )
          total += 200;
      }
    return total;
  };
  const forward = solve(false);
  const forwardCost = cost(forward);
  const backward = solve(true);
  top = cost(backward) < forwardCost ? backward : forward;
  const position = new Map<string, Block['position']>();
  for (const id of ids)
    position.set(id, { x: xOf(id), y: Math.round(top.get(id)!) });
  // Straighten: put connected terminals on one line, strongest first, closest first.
  const clear = (id: string, at: Block['position']) => {
    const moved = claim({ ...blocks.get(id)!, position: at });
    for (const other of ids)
      if (
        other !== id &&
        overlaps(
          moved,
          claim({ ...blocks.get(other)!, position: position.get(other)! }),
          8,
        )
      )
        return false;
    return true;
  };
  const apart = (p: Pair) =>
    Math.abs(cols.get(p.a)! - cols.get(p.b)!) * 1000 +
    Math.abs(position.get(p.a)!.y - position.get(p.b)!.y);
  const straight = [...pairs].sort(
    (p, q) =>
      q.weight - p.weight ||
      apart(p) - apart(q) ||
      p.a.localeCompare(q.a) ||
      p.b.localeCompare(q.b) ||
      p.portA.localeCompare(q.portA),
  );
  const held = new Map<string, Set<'x' | 'y'>>();
  const hold = (id: string, axis: 'x' | 'y') =>
    held.set(id, new Set([...(held.get(id) ?? []), axis]));
  for (const p of straight) {
    const at = (id: string, port: string) =>
      portPoint({ ...blocks.get(id)!, position: position.get(id)! }, port)!;
    const pa = at(p.a, p.portA),
      pb = at(p.b, p.portB);
    const axis = p.axis;
    if (Math.abs(pa[axis] - pb[axis]) < 0.001) {
      hold(p.a, axis);
      hold(p.b, axis);
      continue;
    }
    // Move whichever end is still free on this axis; the downstream end first.
    for (const [id, delta] of [
      [p.b, pa[axis] - pb[axis]],
      [p.a, pb[axis] - pa[axis]],
    ] as const) {
      if (held.get(id)?.has(axis)) continue;
      const from = position.get(id)!;
      const next = { ...from, [axis]: from[axis] + delta };
      if (!clear(id, next)) continue;
      position.set(id, next);
      hold(p.a, axis);
      hold(p.b, axis);
      break;
    }
  }
  return position;
}

/**
 * Section notes follow the block they were written next to. After a whole-sheet
 * arrangement they become headings in a band above the drawing, left to right in the
 * order of their blocks; for a selection, a note moves with its block.
 */
function placeAnnotations(
  before: Project,
  blocks: Block[],
  set: Set<string>,
  whole: boolean,
): Project['annotations'] {
  const notes = before.annotations;
  if (!notes?.length || !before.blocks.length) return notes;
  const distance = (p: Pt, b: Block) => {
    const r = { ...b.position, ...blockSize(b) };
    const dx = Math.max(r.x - p.x, 0, p.x - r.x - r.width);
    const dy = Math.max(r.y - p.y, 0, p.y - r.y - r.height);
    return Math.hypot(dx, dy);
  };
  const anchors = notes.map(
    (n) =>
      [...before.blocks].sort(
        (a, b) => distance(n, a) - distance(n, b) || a.id.localeCompare(b.id),
      )[0],
  );
  const after = new Map(blocks.map((b) => [b.id, b]));
  if (!whole)
    return notes.map((n, i) => {
      const anchor = anchors[i];
      if (!set.has(anchor.id)) return n;
      const moved = after.get(anchor.id)!.position;
      return {
        ...n,
        x: n.x + moved.x - anchor.position.x,
        y: n.y + moved.y - anchor.position.y,
      };
    });
  const top = Math.min(...blocks.map((b) => b.position.y)) - 120;
  const order = notes
    .map((n, i) => ({ n, x: after.get(anchors[i].id)!.position.x, i }))
    .sort((a, b) => a.x - b.x || a.i - b.i);
  const out = [...notes];
  let right = -Infinity;
  for (const { n, x, i } of order) {
    const width = Math.max(n.text.length, n.detail?.length ?? 0) * 8 + 40;
    const at = Math.max(x, right);
    out[i] = { ...n, x: at, y: top };
    right = at + width;
  }
  return out;
}

/** Wires that the arrangement redraws: every wire touching a moved block. */
function freeWires(project: Project, moved: Set<string>): Wire[] {
  return project.wires.map((w) => {
    if (!moved.has(w.source) && !moved.has(w.target)) return w;
    const { waypoints: _drop, junctions: _j, ...rest } = w;
    return rest;
  });
}

/**
 * Nets with three or more terminals, all among the arranged blocks, are drawn again:
 * their old dots and runs belonged to the old drawing. A signal goes from its source to
 * each input; a physical net becomes the shortest tree over its terminals' new places.
 * The saved-document boundary (normalizeProject) then turns the runs the router shares
 * into trunks and dots.
 */
function redrawInternalNets(project: Project, ids: Set<string>): Project {
  const keyOf = (id: string, handle: string) =>
    isTap(project, id) ? `j:${id}` : `${id}.${handle}`;
  const component = new Map<string, number>();
  const components = netComponents(project);
  components.forEach((keys, i) => keys.forEach((k) => component.set(k, i)));
  const redraw = new Set<number>();
  components.forEach((keys, i) => {
    const terminals = keys.filter((k) => !k.startsWith('j:'));
    const dots = keys.length - terminals.length;
    if (terminals.length < 2 || (terminals.length < 3 && !dots)) return;
    if (terminals.every((k) => ids.has(k.slice(0, k.lastIndexOf('.')))))
      redraw.add(i);
  });
  if (!redraw.size) return project;
  const inRedraw = (w: Wire) =>
    redraw.has(component.get(keyOf(w.source, w.sourceHandle)) ?? -1);
  const removed = project.wires.filter(inRedraw);
  const dots = new Set(
    removed.flatMap((w) =>
      [w.source, w.target].filter((id) => isTap(project, id)),
    ),
  );
  const at = (id: string, handle: string) =>
    portPoint(
      project.blocks.find((b) => b.id === id)!,
      handle,
    )!;
  const direct: Wire[] = [];
  const flat = flattenWires({ ...project, wires: removed });
  const groups = new Map<string, Wire[]>();
  for (const w of flat) {
    const key = `${w.source}.${w.sourceHandle}`;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  for (const group of groups.values()) {
    const signal =
      project.blocks
        .find((b) => b.id === group[0].source)
        ?.definition.ports.find((p) => p.id === group[0].sourceHandle)
        ?.direction === 'output';
    const terminals = [
      { id: group[0].source, handle: group[0].sourceHandle },
      ...group.map((w) => ({ id: w.target, handle: w.targetHandle })),
    ];
    const edges: [number, number][] = [];
    if (signal) terminals.slice(1).forEach((_, i) => edges.push([0, i + 1]));
    else {
      // Prim's tree on Manhattan distance between the terminals.
      const inTree = new Set([0]);
      while (inTree.size < terminals.length) {
        let best: [number, number, number] | undefined;
        for (const i of inTree)
          for (let j = 0; j < terminals.length; j++) {
            if (inTree.has(j)) continue;
            const a = at(terminals[i].id, terminals[i].handle),
              b = at(terminals[j].id, terminals[j].handle);
            const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
            if (!best || d < best[2]) best = [i, j, d];
          }
        inTree.add(best![1]);
        edges.push([best![0], best![1]]);
      }
    }
    for (const [i, j] of edges) {
      const a = terminals[i],
        b = terminals[j];
      direct.push({
        id: `w_${a.id}_${a.handle}_${b.id}_${b.handle}`
          .replace(/[^A-Za-z0-9_]/g, '_')
          .slice(0, 80),
        source: a.id,
        sourceHandle: a.handle,
        target: b.id,
        targetHandle: b.handle,
      });
    }
  }
  return {
    ...project,
    junctions: (project.junctions ?? []).filter((j) => !dots.has(j.id)),
    wires: [...project.wires.filter((w) => !inRedraw(w)), ...direct],
  };
}

/**
 * Arrange `selection` (or, when empty, every block on the sheet). Blocks outside the
 * selection stay where they are; an arranged selection keeps its top-left corner and
 * steps clear of the others.
 */
export function arrangeBlocks(
  project: Project,
  selection: string[] = [],
): Project {
  const ids = (
    selection.length ? selection : project.blocks.map((b) => b.id)
  ).filter((id) => project.blocks.some((b) => b.id === id));
  if (!ids.length) return project;
  const set = new Set(ids);
  // Names go back under their blocks: offsets chosen for the old drawing do not fit.
  project = {
    ...project,
    blocks: project.blocks.map((b) => {
      if (!set.has(b.id) || !b.labelOffset) return b;
      const { labelOffset: _drop, ...rest } = b;
      return rest;
    }),
  };
  const position = place(project, ids);
  // Keep the arrangement where the blocks were: its top-left stays at theirs.
  const before = project.blocks.filter((b) => set.has(b.id));
  const origin = {
    x: Math.min(...before.map((b) => b.position.x)),
    y: Math.min(...before.map((b) => b.position.y)),
  };
  const laid = [...position.values()];
  const shift = {
    x: snap(origin.x - Math.min(...laid.map((p) => p.x))),
    y: snap(origin.y - Math.min(...laid.map((p) => p.y))),
  };
  const whole = ids.length === project.blocks.length;
  if (whole) {
    shift.x = snap(ORIGIN.x - Math.min(...laid.map((p) => p.x)));
    shift.y = snap(ORIGIN.y - Math.min(...laid.map((p) => p.y)));
  }
  let blocks = project.blocks.map((b) =>
    set.has(b.id)
      ? {
          ...b,
          position: {
            x: position.get(b.id)!.x + shift.x,
            y: position.get(b.id)!.y + shift.y,
          },
        }
      : b,
  );
  if (!whole) {
    // Step the arranged group right until it clears every block that stays.
    const others = blocks.filter((b) => !set.has(b.id)).map(claim);
    for (let i = 0; i < 60; i++) {
      const hit = blocks
        .filter((b) => set.has(b.id))
        .some((b) => others.some((o) => overlaps(claim(b), o, GRID)));
      if (!hit) break;
      blocks = blocks.map((b) =>
        set.has(b.id)
          ? { ...b, position: { x: b.position.x + GRID * 2, y: b.position.y } }
          : b,
      );
    }
  }
  const next = {
    ...project,
    blocks,
    wires: freeWires({ ...project, blocks }, set),
    annotations: placeAnnotations(project, blocks, set, whole),
  };
  return redrawInternalNets(next, set);
}
