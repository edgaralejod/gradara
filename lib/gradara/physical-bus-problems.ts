// SPDX-License-Identifier: Apache-2.0
import type { Diagnostic } from './api';
import type { Project } from './model';
import { findSubsystem, scopeView } from './hierarchy';
import { physicalBusIssues } from './physical-bus';

/**
 * The physical bus problems a run would refuse (server/physical_buses.py
 * `physical_bus_problems`) on the sheet open at `path`: a bus block whose element
 * names are missing, invalid or repeated, and one element name carried as two types
 * on one bus line, reading through subsystem bus ports.
 */
export function physicalBusProblems(
  project: Project,
  path: string[],
): Diagnostic[] {
  const view = scopeView(project, path);
  const insideOf = (b: Project['blocks'][number]) => {
    const ref = b.definition.subsystem?.ref;
    return ref ? findSubsystem(project, ref) : undefined;
  };
  return physicalBusIssues(view, insideOf).map((issue, i) => ({
    id: `v-pbus-${i}-${issue.blockIds.join('-')}`,
    severity: 'error',
    source: 'validation',
    message: issue.message,
    detail: '',
    blockIds: issue.blockIds,
    ports: [],
    netIds: [],
    wireIds: [],
    hint: issue.hint,
  }));
}
