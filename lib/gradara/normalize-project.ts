import type { Project } from './model';
import { normalizeBlockNames } from './names';
import { normalizeJunctions } from './net-layout';
import { reconcileNets } from './net-registry';

/** The saved document boundary: instance names, geometry, then net identity. */
export function normalizeProject(
  project: Project,
  previous: Project = project,
) {
  if (!project.modelId) project = { ...project, modelId: crypto.randomUUID() };
  return reconcileNets(
    normalizeJunctions(normalizeBlockNames(project, previous)),
    previous,
  );
}
