import { settleTerminators } from './terminators';
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
import { dropOrphanWires, pruneJunctions } from './project';
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

type Sheet = Project | NonNullable<Project['subsystems']>[number];

/** `step` on the top sheet and every subsystem sheet, keeping objects that did not change. */
function everySheet(project: Project, step: <T extends Sheet>(sheet: T) => T) {
  let next = step(project);
  const subsystems = next.subsystems?.map((s) => step(s));
  if (subsystems && subsystems.some((s, i) => s !== next.subsystems![i]))
    next = { ...next, subsystems };
  return next;
}

/**
 * Junction hygiene on every sheet: wires that end on nothing are dropped, and a dot
 * with fewer than three wires is removed or becomes a bend (pruneJunctions), so no edit
 * can leave a stray dot or a wire to a deleted dot in a saved document.
 */
function tidyJunctions(project: Project, orphans: boolean) {
  return everySheet(project, (sheet) => {
    const kept = orphans ? dropOrphanWires(sheet) : sheet;
    // A subsystem sheet is pruned in a view that has the document's subsystems, so
    // nested instances resolve; only its own blocks, wires and dots change.
    const view = { ...project, ...kept } as Project;
    const pruned = kept.junctions?.length ? pruneJunctions(view) : view;
    if (pruned === view && kept === sheet) return sheet;
    const next = { ...kept, wires: pruned.wires, junctions: pruned.junctions };
    // The top sheet's nets are reconciled at the end of normalizeProject; a subsystem
    // sheet's nets follow its wires here.
    if (sheet === project || !sheet.nets) return next;
    return {
      ...next,
      nets: reconcileNets(
        { ...project, ...next } as Project,
        { ...project, ...sheet } as Project,
      ).nets,
    };
  });
}

/** The saved document boundary: instance names, geometry, then net identity. */
export function normalizeProject(
  project: Project,
  previous: Project = project,
) {
  if (!project.modelId) project = { ...project, modelId: crypto.randomUUID() };
  project = onGrid(realizePlaceholders(project));
  return settleTerminators(
    reconcileNets(
      settleRoutes(
        normalizeJunctions(
          tidyJunctions(
            materializeBranches(
              normalizeBlockNames(tidyJunctions(project, true), previous),
            ),
            false,
          ),
        ),
      ),
      previous,
    ),
  );
}
