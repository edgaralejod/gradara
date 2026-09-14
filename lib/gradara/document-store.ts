import type { Project } from './model';

export type SavedDocument = { project: Project; saveVersion: string };
export type ModelSummary = {
  id: string;
  name: string;
  blocks: number;
  exampleId?: string;
  updatedAt: string;
};
export type Draft = { project: Project; saveVersion: string | null };

/** Serialize document writes without letting autosave change the active model. */
export class DocumentStore {
  private queue: Promise<unknown> = Promise.resolve();
  private versions = new Map<string, string | null>();
  private bodies = new Map<string, string>();

  constructor(
    private write: (
      project: Project,
      expectedVersion: string | null,
    ) => Promise<SavedDocument>,
  ) {}

  remember(document: SavedDocument) {
    this.versions.set(document.project.modelId!, document.saveVersion);
    this.bodies.set(
      document.project.modelId!,
      JSON.stringify(document.project),
    );
  }

  recover(draft: Draft) {
    this.versions.set(draft.project.modelId!, draft.saveVersion);
    this.bodies.delete(draft.project.modelId!);
  }

  draft(project: Project): Draft {
    return {
      project,
      saveVersion: this.versions.get(project.modelId!) ?? null,
    };
  }

  isSaved(project: Project) {
    return this.bodies.get(project.modelId!) === JSON.stringify(project);
  }

  save(project: Project) {
    const snapshot = structuredClone(project);
    const body = JSON.stringify(snapshot);
    const id = snapshot.modelId!;
    const pending = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.bodies.get(id) === body) return;
        const saved = await this.write(snapshot, this.versions.get(id) ?? null);
        this.versions.set(id, saved.saveVersion);
        // Remember the submitted representation; server defaults need not cause another save.
        this.bodies.set(id, body);
      });
    this.queue = pending;
    return pending;
  }
}

export const draftKey = (id: string) => `gradara-draft:${id}`;
