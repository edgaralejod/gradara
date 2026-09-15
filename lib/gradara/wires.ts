import type { Project } from './model';
import type { Pt } from './routing';

export function setWireWaypoints(
  project: Project,
  id: string,
  waypoints: Pt[],
) {
  return {
    ...project,
    wires: project.wires.map((w) => (w.id === id ? { ...w, waypoints } : w)),
  };
}

export function resetWireRoute(project: Project, id: string): Project {
  return {
    ...project,
    wires: project.wires.map((w) =>
      w.id === id ? { ...w, waypoints: undefined } : w,
    ),
  };
}
