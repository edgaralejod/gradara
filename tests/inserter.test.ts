import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_INSERT_BLOCKERS,
  clampPopoverPosition,
  isCanvasInsertDoubleClick,
} from '../lib/gradara/inserter';

const hit = (...matches: string[]) => ({
  closest: (selector: string) => {
    const parts = selector.split(',').map((part) => part.trim());
    return parts.some((part) => matches.includes(part)) ? {} : null;
  },
});

void test('double-click on empty pane opens the inserter', () => {
  assert.equal(isCanvasInsertDoubleClick(hit('.react-flow__pane')), true);
  assert.equal(
    isCanvasInsertDoubleClick(hit('.react-flow__pane', '.react-flow__background')),
    true,
  );
});

void test('double-click on a block, port, wire, or chrome does not open the inserter', () => {
  assert.equal(isCanvasInsertDoubleClick(null), false);
  assert.equal(isCanvasInsertDoubleClick(hit('.react-flow__node')), false);
  for (const blocker of CANVAS_INSERT_BLOCKERS.split(',')) {
    assert.equal(
      isCanvasInsertDoubleClick(hit('.react-flow__pane', blocker)),
      false,
      blocker,
    );
  }
});

void test('inserter stays fully on the sheet when the click is near the bottom or side', () => {
  assert.deepEqual(
    clampPopoverPosition({ x: 20, y: 20 }, { width: 800, height: 600 }),
    { x: 20, y: 20 },
  );
  assert.deepEqual(
    clampPopoverPosition({ x: 790, y: 590 }, { width: 800, height: 600 }),
    { x: 488, y: 68 },
  );
  assert.deepEqual(
    clampPopoverPosition(
      { x: 400, y: 500 },
      { width: 400, height: 240 },
      { width: 300, height: 520 },
    ),
    { x: 88, y: 12 },
  );
});
