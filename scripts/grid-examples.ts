/**
 * Put the shipped example models on the sheet grid (lib/gradara/grid.ts).
 *
 * The example builders lay models out in their own coordinates; this pass moves
 * block corners, sizes, pinned bends, and junctions onto the grid the workbench
 * uses, then lines up wires the move left one step out of line. Run it after any
 * builder: `npx tsx scripts/grid-examples.ts`.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { Block, Project } from '../lib/gradara/model';
import { gridSheet } from '../lib/gradara/grid';
import { straightenNearRuns } from '../lib/gradara/grid-migrate';
import { blockSize, minimumBlockSize } from '../lib/gradara/canvas';
import { defaultBlockSize } from '../lib/gradara/block-design';

const size = (b: Block) => blockSize(b);
const min = (b: Block) => minimumBlockSize(b.definition, b.rotation);

for (const folder of ['models/examples', 'tests/fixtures']) {
  for (const file of readdirSync(folder).filter((f) => f.endsWith('.json'))) {
    const path = `${folder}/${file}`;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(raw.blocks) || !Array.isArray(raw.wires)) continue;
    // Examples use standard bodies: an old standard size becomes the new standard.
    const standard = (b: Block) => {
      const d = defaultBlockSize(b.definition);
      return b.rotation && b.rotation % 180
        ? { width: d.height, height: d.width }
        : d;
    };
    const restandard = <T extends { blocks: Block[] }>(sheet: T): T => ({
      ...sheet,
      // About the center, so a block's ports stay on the rows its wires use.
      blocks: sheet.blocks.map((b) => {
        if (folder !== 'models/examples' || !b.size) return b;
        const size = standard(b);
        const position = {
          x: b.position.x + (b.size.width - size.width) / 2,
          y: b.position.y + (b.size.height - size.height) / 2,
        };
        return { ...b, position, size };
      }),
    });
    const onGrid = <
      T extends Project | NonNullable<Project['subsystems']>[number],
    >(
      sheet: T,
    ) => straightenNearRuns(gridSheet(restandard(sheet), size, min));
    let doc = onGrid(raw as Project);
    if (doc.subsystems)
      doc = { ...doc, subsystems: doc.subsystems.map(onGrid) };
    const text = JSON.stringify(doc, null, 2) + '\n';
    if (text !== readFileSync(path, 'utf8')) {
      writeFileSync(path, text);
      console.log('gridded', path);
    }
  }
}
