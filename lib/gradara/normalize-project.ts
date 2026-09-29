import type { Project } from './model';
import { normalizeBlockNames } from './names';
import { materializeBranches } from './net-branches';
import { normalizeJunctions } from './net-layout';
import { reconcileNets } from './net-registry';
import { realizePlaceholders } from './hierarchy';
import { settleRoutes } from './router';
import { gridSheet } from './grid';
import { straightenNearRuns } from './grid-migrate';
import { blockSize, minimumBlockSize } from './canvas';
import type { Block } from './model';

const size = (b: Block) => blockSize(b);
const min = (b: Block) => minimumBlockSize(b.definition, b.rotation);

/**
 * A sheet on the sheet grid (see grid.ts). When that moved anything (an older
 * document, or blocks placed by an API client), wires it left a step out of line
 * are lined up again.
 */
function sheetOnGrid<
  T extends Project | NonNullable<Project['subsystems']>[number],
>(sheet: T): T {
  const gridded = gridSheet(sheet, size, min);
  return gridded === sheet ? sheet : straightenNearRuns(gridded);
}

/** Every sheet of the document on the sheet grid. */
function onGrid(project: Project): Project {
  let next = sheetOnGrid(project);
  const subsystems = next.subsystems?.map((s) => sheetOnGrid(s));
  if (subsystems && subsystems.some((s, i) => s !== next.subsystems![i]))
    next = { ...next, subsystems };
  return next;
}

/** The saved document boundary: instance names, geometry, then net identity. */
export function normalizeProject(
  project: Project,
  previous: Project = project,
) {
  if (!project.modelId) project = { ...project, modelId: crypto.randomUUID() };
  project = onGrid(realizePlaceholders(project));
  return reconcileNets(
    settleRoutes(
      normalizeJunctions(
        materializeBranches(normalizeBlockNames(project, previous)),
      ),
    ),
    previous,
  );
}
