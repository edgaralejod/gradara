import type { Project } from './model';
import { normalizeBlockNames } from './names';
import { materializeBranches } from './net-branches';
import { normalizeJunctions } from './net-layout';
import { reconcileNets } from './net-registry';
import { realizePlaceholders } from './hierarchy';

/** The saved document boundary: instance names, geometry, then net identity. */
export function normalizeProject(
  project: Project,
  previous: Project = project,
) {
  if (!project.modelId) project = { ...project, modelId: crypto.randomUUID() };
  project = realizePlaceholders(project);
  return reconcileNets(
    normalizeJunctions(
      materializeBranches(normalizeBlockNames(project, previous)),
    ),
    previous,
  );
}
