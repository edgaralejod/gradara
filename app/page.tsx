'use client';
import {
  defaultBlockSize,
  snapBlockPosition,
} from '@/lib/gradara/block-design';
import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  ReactFlowProvider,
  Background,
  ViewportPortal,
  Controls,
  SelectionMode,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Activity,
  Play,
  Sparkles,
  Undo2,
  Redo2,
  ChevronRight,
  BookOpen,
  AlertCircle,
  RotateCw,
  Settings2,
  Code2,
  ArrowUpRight,
  FolderOpen,
  FilePlus2,
  Square,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Copy,
  Clipboard,
  ClipboardPaste,
  Trash2,
  Maximize,
  Keyboard,
  Check,
  LoaderCircle,
  X,
  MousePointer2,
  Hand,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import ModelCanvas from '@/components/gradara/model-canvas';
import { normalizeProject } from '@/lib/gradara/normalize-project';
import { describeNets, renameNet } from '@/lib/gradara/net-registry';
import { setNetLabel } from '@/lib/gradara/net-label';
import {
  IdentityField,
  ModelExplorer,
  NetProperties,
} from '@/components/gradara/model-inspector';
import {
  emptySelection,
  extractSelection,
  layoutSelection,
  pasteSelection,
  type ModelFragment,
  type ModelSelection,
} from '@/lib/gradara/selection';
import {
  blockSize,
  minimumBlockSize,
  type BlockLayout,
} from '@/lib/gradara/canvas';
import NumberField from '@/components/gradara/number-field';
import NameField from '@/components/gradara/name-field';
import Results from '@/components/gradara/results';
import ModelBrowser, {
  type BrowserSection,
} from '@/components/gradara/model-browser';
import SaveCopyDialog from '@/components/gradara/save-copy-dialog';
import AboutDialog from '@/components/gradara/about-dialog';
import {
  DocumentStore,
  draftKey,
  type Draft,
  type SavedDocument,
} from '@/lib/gradara/document-store';
import { blankProject, type TemplateId } from '@/lib/gradara/workspace';
import LibraryNavigator from '@/components/gradara/library-navigator';
import BlockInserter, {
  type InsertContext,
} from '@/components/gradara/block-inserter';
import AgentComposer, {
  type ComposerContext,
} from '@/components/gradara/agent-composer';
import EquationEditor from '@/components/gradara/equation-editor';
import ExportDialog from '@/components/gradara/export-dialog';
import {
  library,
  domainColors,
  type Project,
  type Definition,
  compatible,
  portOf,
} from '@/lib/gradara/model';
import { matchingPort } from '@/lib/gradara/catalog';
import { placeAligned, placeAtDrop } from '@/lib/gradara/placement';
import { resetWireRoute } from '@/lib/gradara/wires';
import NetLayer from '@/components/gradara/net-layer';
import {
  api,
  waitForJob,
  type SimulationResult,
  type Job,
} from '@/lib/gradara/api';
import {
  semanticSignature,
  setLabelOffset,
  addWire,
  removeSelection,
  replaceDefinition,
  duplicateBlocks,
} from '@/lib/gradara/project';
function IconButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            disabled={disabled}
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
function Workbench() {
  const [project, setProject] = useState<Project>(blankProject);
  const projectRef = useRef(project);
  projectRef.current = project;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [selectedJunctions, setSelectedJunctions] = useState<string[]>([]);
  const [groupSelection, setGroupSelection] = useState(false);
  const clipboard = useRef<ModelFragment | null>(null);
  const [canPaste, setCanPaste] = useState(false);
  const pasteCount = useRef(0);
  const selection = useMemo<ModelSelection>(
    () => ({
      blockIds: selectedIds,
      wireIds: selectedEdges,
      junctionIds: selectedJunctions,
    }),
    [selectedIds, selectedEdges, selectedJunctions],
  );
  const selectionRef = useRef(selection);
  useLayoutEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  const select = useCallback((next: ModelSelection) => {
    setSelectedIds(next.blockIds);
    setSelectedEdges(next.wireIds);
    setSelectedJunctions(next.junctionIds);
    setGroupSelection(next.blockIds.length > 1 || next.wireIds.length > 1);
  }, []);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [browserSection, setBrowserSection] = useState<BrowserSection | null>(
    null,
  );
  const [copyOpen, setCopyOpen] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveError, setSaveError] = useState('');
  const switchingRef = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState('Loading');
  const [health, setHealth] = useState({
    engineReady: false,
    agentReady: false,
    engine: 'OpenModelica 1.27.0',
  });
  const [history, setHistory] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const [canvasTool, setCanvasTool] = useState<'select' | 'pan'>('select');
  const [composer, setComposer] = useState<ComposerContext | null>(null);
  const [inserter, setInserter] = useState<InsertContext | null>(null);
  const [equationBlock, setEquationBlock] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [libraryOpen, updateLibraryOpen] = useState(true);
  const [inspectorOpen, updateInspectorOpen] = useState(true);
  const setLibraryOpen = useCallback((open: boolean) => {
    if (open && window.innerWidth < 1100) updateInspectorOpen(false);
    updateLibraryOpen(open);
  }, []);
  const setInspectorOpen = useCallback((open: boolean) => {
    if (open && window.innerWidth < 1100) updateLibraryOpen(false);
    updateInspectorOpen(open);
  }, []);
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth < 1100 && libraryOpen && inspectorOpen)
        updateLibraryOpen(false);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [libraryOpen, inspectorOpen]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [resultSignature, setResultSignature] = useState('');
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runController = useRef<AbortController | null>(null);
  const runId = useRef('');
  const documents = useRef<DocumentStore | null>(null);
  if (!documents.current)
    documents.current = new DocumentStore((project, expectedVersion) =>
      api<SavedDocument>(`/models/${project.modelId}`, {
        method: 'PUT',
        body: JSON.stringify({ project, expectedVersion }),
      }),
    );
  const store = documents.current;
  const persistProject = useCallback(
    async (body: string) => {
      const snapshot = JSON.parse(body) as Project;
      try {
        sessionStorage.setItem(
          draftKey(snapshot.modelId!),
          JSON.stringify(store.draft(snapshot)),
        );
      } catch {
        /* Server save still works if browser storage is full. */
      }
      await store.save(snapshot);
      try {
        const draft = JSON.parse(
          sessionStorage.getItem(draftKey(snapshot.modelId!)) ?? 'null',
        ) as Draft | null;
        if (draft && JSON.stringify(draft.project) === body)
          sessionStorage.removeItem(draftKey(snapshot.modelId!));
      } catch {
        /* A browser cache failure must not turn a completed disk save into an error. */
      }
    },
    [store],
  );
  const importRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const notify = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 5500);
  }, []);
  const commit = useCallback((update: Project | ((p: Project) => Project)) => {
    if (switchingRef.current) return;
    const previous = projectRef.current;
    const next = normalizeProject(
      typeof update === 'function' ? update(previous) : update,
      previous,
    );
    if (next === previous) return;
    setHistory((h) => [...h.slice(-49), structuredClone(previous)]);
    setFuture([]);
    const changed = { ...next, revision: previous.revision + 1 };
    projectRef.current = changed;
    setProject(changed);
  }, []);
  const undo = useCallback(() => {
    if (!history.length) return;
    const previous = history[history.length - 1];
    const current = structuredClone(projectRef.current);
    setFuture((f) => [...f, current]);
    setHistory((h) => h.slice(0, -1));
    const restored = { ...previous, revision: projectRef.current.revision + 1 };
    projectRef.current = restored;
    setProject(restored);
  }, [history]);
  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[future.length - 1];
    const current = structuredClone(projectRef.current);
    setHistory((h) => [...h, current]);
    setFuture((f) => f.slice(0, -1));
    const restored = { ...next, revision: projectRef.current.revision + 1 };
    projectRef.current = restored;
    setProject(restored);
  }, [future]);
  const active = project.blocks.find((b) => b.id === selectedIds[0]);
  const nets = useMemo(() => describeNets(project), [project]);
  const activeNet = nets.find(({ net }) =>
    net.wireIds.includes(selectedEdges[0]),
  );
  const inspectBlock = (id: string) => {
    select({ ...emptySelection(), blockIds: [id] });
  };
  const inspectNet = (id: string) => {
    const entry = nets.find(({ net }) => net.id === id);
    if (entry) select({ ...emptySelection(), wireIds: entry.net.wireIds });
  };
  const focusNet = (id: string) => {
    const entry = nets.find(({ net }) => net.id === id);
    if (!entry) return;
    inspectNet(id);
    void flow.fitView({
      nodes: [...new Set(entry.ports.map((p) => p.blockId))].map((id) => ({
        id,
      })),
      padding: 0.6,
      maxZoom: 1.5,
      duration: 200,
    });
  };
  const signature = useMemo(() => semanticSignature(project), [project]);
  const restoreDocument = (loaded: SavedDocument, recover = true) => {
    store.remember(loaded);
    let next = loaded.project;
    if (recover) {
      try {
        const draft = JSON.parse(
          sessionStorage.getItem(draftKey(next.modelId!)) ?? 'null',
        ) as Draft | null;
        if (
          draft &&
          draft.project.modelId === next.modelId &&
          JSON.stringify(draft.project) !== JSON.stringify(next)
        ) {
          next = draft.project;
          store.recover(draft);
          notify('Recovered unsaved edits from this browser.');
        }
      } catch {
        /* Ignore an unreadable browser draft; the disk document remains authoritative. */
      }
    }
    return normalizeProject(next);
  };
  useEffect(() => {
    let disposed = false;
    async function load() {
      setStartupError('');
      try {
        let tabModel: string | null = null;
        try {
          tabModel = sessionStorage.getItem('gradara-active-model');
        } catch {
          /* Browser storage is optional. */
        }
        let loaded = await api<{
          project: Project | null;
          saveVersion: string | null;
        }>(tabModel ? `/models/${tabModel}` : '/project').catch(
          async (error) => {
            if (tabModel && error.status === 404)
              return api<{
                project: Project | null;
                saveVersion: string | null;
              }>('/project');
            throw error;
          },
        );
        if (disposed) return;
        if (!loaded.project)
          loaded = await api<SavedDocument>('/models', {
            method: 'POST',
            body: JSON.stringify({ name: 'Untitled model', template: 'blank' }),
          });
        if (disposed) return;
        if (!loaded.saveVersion)
          throw new Error(
            'Restart the Gradara service to enable the updated model-saving system.',
          );
        const next = restoreDocument(loaded as SavedDocument);
        try {
          sessionStorage.setItem('gradara-active-model', next.modelId!);
        } catch {
          /* The service still remembers the active document. */
        }
        projectRef.current = next;
        setProject(next);
        setReady(true);
        const latest = await api<{ result: SimulationResult | null }>(
          `/results/latest?model=${next.modelId}`,
        ).catch(() => ({ result: null }));
        if (
          !disposed &&
          projectRef.current.modelId === next.modelId &&
          latest.result
        ) {
          setResult(latest.result);
          if (latest.result.snapshot)
            setResultSignature(semanticSignature(latest.result.snapshot));
        }
      } catch (e) {
        if (!disposed) {
          setStartupError((e as Error).message);
          setSaving('Not connected');
        }
      }
    }
    void load();
    if (window.innerWidth < 1100) setInspectorOpen(false);
    if (window.innerWidth < 800) setLibraryOpen(false);
    return () => {
      disposed = true;
      runController.current?.abort();
    };
  }, [loadAttempt]);
  useEffect(() => {
    let alive = true;
    const update = () =>
      api<typeof health>('/health')
        .then((h) => {
          if (alive) setHealth(h);
        })
        .catch(() => {
          if (alive)
            setHealth((h) => ({ ...h, engineReady: false, agentReady: false }));
        });
    void update();
    const timer = setInterval(update, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const saveCurrent = async () => {
    const snapshot = projectRef.current;
    setSaving('Saving');
    try {
      await persistProject(JSON.stringify(snapshot));
      if (projectRef.current.modelId === snapshot.modelId) {
        setSaveError('');
        setSaving(
          store.isSaved(projectRef.current) ? 'Saved' : 'Unsaved changes',
        );
      }
    } catch (e) {
      if (projectRef.current.modelId === snapshot.modelId) {
        setSaving('Not saved');
        setSaveError((e as Error).message);
      }
      throw e;
    }
  };
  const saveNowRef = useRef(saveCurrent);
  saveNowRef.current = saveCurrent;
  useEffect(() => {
    if (!ready || switching) return;
    if (store.isSaved(project)) {
      setSaving('Saved');
      return;
    }
    setSaving('Unsaved changes');
    try {
      sessionStorage.setItem(
        draftKey(project.modelId!),
        JSON.stringify(store.draft(project)),
      );
    } catch {
      /* Saving to disk remains available. */
    }
    autosaveTimer.current = setTimeout(() => {
      void saveNowRef.current().catch(() => {});
    }, 550);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [project, ready, switching, store]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (ready && !store.isSaved(projectRef.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [ready, store]);
  const activateModel = (next: Project) => {
    try {
      sessionStorage.setItem('gradara-active-model', next.modelId!);
    } catch {
      /* The service still remembers the active document. */
    }
    projectRef.current = next;
    setProject(next);
    setHistory([]);
    setFuture([]);
    select(emptySelection());
    setComposer(null);
    setInserter(null);
    setEquationBlock(null);
    setInspectorOpen(false);
    setRunError('');
    setSaveError('');
    setResult(null);
    setResultSignature('');
    setSaving(store.isSaved(next) ? 'Saved' : 'Unsaved changes');
  };
  const beginTransition = () => {
    if (switchingRef.current || running || !ready) return false;
    switchingRef.current = true;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setSwitching(true);
    return true;
  };
  const endTransition = () => {
    switchingRef.current = false;
    setSwitching(false);
  };
  const createModel = async (
    name = 'Untitled model',
    template: TemplateId = 'blank',
  ) => {
    if (!beginTransition()) return;
    try {
      await saveCurrent();
      const created = await api<SavedDocument>('/models', {
        method: 'POST',
        body: JSON.stringify({ name, template }),
      });
      activateModel(restoreDocument(created, false));
      setBrowserSection(null);
      setLibraryOpen(template === 'blank');
    } finally {
      endTransition();
    }
  };
  const openBrowser = async (section: BrowserSection) => {
    await saveCurrent().catch(() => {});
    setBrowserSection(section);
  };
  const openModel = async (id: string) => {
    if (id === projectRef.current.modelId) return;
    if (!beginTransition()) return;
    try {
      await saveCurrent();
      const loaded = await api<SavedDocument>(`/models/${id}/activate`, {
        method: 'POST',
      });
      const next = restoreDocument(loaded);
      activateModel(next);
      const latest = await api<{ result: SimulationResult | null }>(
        `/results/latest?model=${next.modelId}`,
      ).catch(() => ({ result: null }));
      if (projectRef.current.modelId === next.modelId) {
        setResult(latest.result);
        if (latest.result?.snapshot)
          setResultSignature(semanticSignature(latest.result.snapshot));
      }
    } finally {
      endTransition();
    }
  };
  const saveCopy = async (name: string) => {
    if (!beginTransition()) return;
    try {
      // Preserve the current edits even when saving the original is blocked by a conflict.
      const originalId = projectRef.current.modelId!;
      const copied = await api<SavedDocument>('/models/copy', {
        method: 'POST',
        body: JSON.stringify({ name, project: projectRef.current }),
      });
      try {
        sessionStorage.removeItem(draftKey(originalId));
      } catch {
        /* The copy is already on disk. */
      }
      activateModel(restoreDocument(copied, false));
      setBrowserSection(null);
      notify('Copy saved as a separate model.');
    } finally {
      endTransition();
    }
  };
  const reloadSaved = async () => {
    if (!beginTransition()) return;
    try {
      const id = projectRef.current.modelId!;
      const loaded = await api<SavedDocument>(`/models/${id}`);
      try {
        sessionStorage.removeItem(draftKey(id));
      } catch {
        /* Keep the saved document usable if browser storage is unavailable. */
      }
      activateModel(restoreDocument(loaded, false));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      endTransition();
    }
  };
  const updateLayout = useCallback(
    (layouts: BlockLayout[]) => {
      commit((p) => layoutSelection(p, layouts, selectionRef.current));
    },
    [commit],
  );
  const newPosition = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return flow.screenToFlowPosition({
      x: (bounds?.left ?? 0) + (bounds?.width ?? 700) / 2 - 70,
      y: (bounds?.top ?? 0) + (bounds?.height ?? 400) / 2 - 50,
    });
  }, [flow]);
  const addComponent = useCallback(
    (
      definition: Definition,
      position?: { x: number; y: number },
      connection?: { blockId: string; portId: string },
    ) => {
      const id = `b_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const current = projectRef.current;
      const selected = current.blocks.find((b) => b.id === selectedIds[0]);
      const origin = connection
        ? current.blocks.find((b) => b.id === connection.blockId)
        : selected;
      const fromPort = connection
        ? portOf(current, connection.blockId, connection.portId)
        : (origin?.definition.ports.find((x) => x.direction === 'output') ??
          origin?.definition.ports.find((x) => x.direction === 'physical'));
      const toPort = matchingPort(fromPort, definition);
      const placed =
        connection && position
          ? placeAtDrop(position, definition, toPort, fromPort?.direction)
          : position
            ? snapBlockPosition(position, defaultBlockSize(definition))
            : origin && fromPort && toPort
              ? placeAligned(origin, fromPort, definition, toPort)
              : snapBlockPosition(newPosition(), defaultBlockSize(definition));
      commit((p) => {
        let next = {
          ...p,
          blocks: [
            ...p.blocks,
            {
              id,
              definition: structuredClone(definition),
              size: defaultBlockSize(definition),
              position: placed,
            },
          ],
        };
        const wire =
          connection ||
          (!position && selected
            ? {
                blockId: selected.id,
                portId:
                  selected.definition.ports.find(
                    (x) => x.direction === 'output',
                  )?.id ?? '',
              }
            : undefined);
        if (!wire?.portId) return next;
        const linkFrom = portOf(p, wire.blockId, wire.portId);
        const linkTo = matchingPort(linkFrom, definition);
        if (!linkFrom || !linkTo) return next;
        const forward = linkFrom.direction !== 'input';
        try {
          next = addWire(next, {
            id: crypto.randomUUID(),
            source: forward ? wire.blockId : id,
            sourceHandle: forward ? wire.portId : linkTo.id,
            target: forward ? id : wire.blockId,
            targetHandle: forward ? linkTo.id : wire.portId,
          });
        } catch {
          /* occupancy or domain — the block still lands */
        }
        return next;
      });
      setSelectedIds([id]);
      setInspectorOpen(true);
      return id;
    },
    [commit, newPosition, selectedIds],
  );
  const deleteSelected = useCallback(() => {
    const s = selectionRef.current;
    if (!s.blockIds.length && !s.wireIds.length && !s.junctionIds.length)
      return;
    commit((p) =>
      removeSelection(p, [...s.blockIds, ...s.junctionIds], s.wireIds),
    );
    select(emptySelection());
  }, [commit, select]);
  const duplicate = useCallback(() => {
    const d = duplicateBlocks(projectRef.current, selectedIds);
    if (!d.ids.length) return;
    commit(d.project);
    select(d.selection);
  }, [commit, selectedIds, select]);
  const copySelection = useCallback(
    (cut = false) => {
      const fragment = extractSelection(
        projectRef.current,
        selectionRef.current,
      );
      if (!fragment.blocks.length) return;
      clipboard.current = fragment;
      setCanPaste(true);
      pasteCount.current = 0;
      if (cut) deleteSelected();
      notify(
        `${cut ? 'Cut' : 'Copied'} ${fragment.blocks.length} block${fragment.blocks.length === 1 ? '' : 's'} with internal connections.`,
      );
    },
    [deleteSelected, notify],
  );
  const paste = useCallback(() => {
    if (!clipboard.current) return;
    const step = ++pasteCount.current * 40;
    const result = pasteSelection(projectRef.current, clipboard.current, {
      x: step,
      y: step,
    });
    commit(result.project);
    select(result.selection);
  }, [commit, select]);
  const startComposer = useCallback(
    () => setComposer({ position: newPosition() }),
    [newPosition],
  );
  async function runSimulation() {
    if (runController.current || switching || !ready) return;
    if (!projectRef.current.blocks.length) {
      notify('Add a block from the library or ask the agent to create one.');
      return;
    }
    const controller = new AbortController();
    runController.current = controller;
    setRunning(true);
    setRunError('');
    setResult(null);
    setResultSignature('');
    const snapshot = structuredClone(projectRef.current);
    const currentSignature = semanticSignature(snapshot);
    try {
      // Always receive the job ID, so cancellation during submission can stop the engine too.
      const job = await api<Job<SimulationResult>>('/runs', {
        method: 'POST',
        body: JSON.stringify(snapshot),
      });
      if (controller.signal.aborted) {
        await api(`/jobs/${job.id}`, { method: 'DELETE' });
        return;
      }
      runId.current = job.id;
      const r = await waitForJob<SimulationResult>(job.id, controller.signal);
      if (
        runController.current !== controller ||
        controller.signal.aborted ||
        projectRef.current.modelId !== snapshot.modelId
      )
        return;
      setResult(r);
      setResultSignature(currentSignature);
    } catch (e) {
      if (
        runController.current === controller &&
        !controller.signal.aborted &&
        (e as Error).name !== 'AbortError'
      )
        setRunError((e as Error).message);
    } finally {
      if (runController.current === controller) {
        runController.current = null;
        setRunning(false);
        runId.current = '';
      }
    }
  }
  async function cancelRun() {
    runController.current?.abort();
    runController.current = null;
    const id = runId.current;
    runId.current = '';
    setRunning(false);
    if (id) {
      try {
        await api(`/jobs/${id}`, { method: 'DELETE' });
      } catch (e) {
        notify((e as Error).message);
        return;
      }
    }
    notify('Simulation cancelled.');
  }
  const runRef = useRef(runSimulation);
  runRef.current = runSimulation;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const input = (e.target as HTMLElement)?.closest(
        'input,textarea,[contenteditable=true],.monaco-editor,[role=dialog]',
      );
      if (input || e.defaultPrevented) return;
      const command = e.metaKey || e.ctrlKey;
      if (command && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (command && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
      } else if (command && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        select({
          blockIds: projectRef.current.blocks.map((b) => b.id),
          wireIds: projectRef.current.wires.map((w) => w.id),
          junctionIds: (projectRef.current.junctions ?? []).map((j) => j.id),
        });
      } else if (command && ['c', 'x'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        copySelection(e.key.toLowerCase() === 'x');
      } else if (command && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        paste();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (command && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNowRef
          .current()
          .then(() => notify('Model saved.'))
          .catch(() => {});
      } else if (command && e.key === 'Enter') {
        e.preventDefault();
        void runRef.current();
      } else if (e.key.toLowerCase() === 'a' && !command && !composer) {
        e.preventDefault();
        startComposer();
      } else if (e.key.toLowerCase() === 'v' && !command) {
        setCanvasTool('select');
      } else if (e.key.toLowerCase() === 'h' && !command) {
        setCanvasTool('pan');
      } else if (e.key.toLowerCase() === 'f' && !command) {
        e.preventDefault();
        void flow.fitView({ padding: 0.2, duration: 250 });
      } else if (e.key === '/' && !command) {
        e.preventDefault();
        setLibraryOpen(true);
        document.getElementById('library-search')?.focus();
      } else if (
        e.key.toLowerCase() === 'r' &&
        !command &&
        selectedEdges.length
      ) {
        e.preventDefault();
        commit((p) =>
          selectedEdges.reduce((next, id) => resetWireRoute(next, id), p),
        );
      } else if (e.key === 'Escape') {
        setComposer(null);
        setInserter(null);
        select(emptySelection());
      } else if (e.key === '?' && !command) setHelpOpen(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [
    undo,
    redo,
    duplicate,
    copySelection,
    paste,
    deleteSelected,
    select,
    notify,
    composer,
    startComposer,
    flow,
    selectedEdges,
    commit,
  ]);
  const insertGenerated = (definition: Definition) => {
    if (!composer) return;
    const ctx = composer;
    let dropped = 0;
    let id = ctx.existing?.id;
    commit((p) => {
      if (ctx.existing) {
        const next = replaceDefinition(p, ctx.existing.id, definition);
        dropped = p.wires.length - next.wires.length;
        return next;
      }
      id = `b_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      let next = {
        ...p,
        blocks: [
          ...p.blocks,
          {
            id,
            definition,
            position: snapBlockPosition(
              ctx.position,
              defaultBlockSize(definition),
            ),
            size: defaultBlockSize(definition),
          },
        ],
      };
      if (ctx.connection) {
        const from = portOf(p, ctx.connection.blockId, ctx.connection.portId);
        const to = definition.ports.find((port) => compatible(from, port));
        if (to)
          next = addWire(next, {
            id: crypto.randomUUID(),
            source: ctx.connection.blockId,
            sourceHandle: ctx.connection.portId,
            target: id,
            targetHandle: to.id,
          });
      }
      return next;
    });
    if (id) setSelectedIds([id]);
    setInspectorOpen(true);
    setComposer(null);
    notify(
      dropped
        ? `Component updated. ${dropped} incompatible connection(s) removed; undo is available.`
        : ctx.existing
          ? 'Component updated. Connections preserved.'
          : `${definition.name} added to the model.`,
    );
  };
  async function importProject(file: File) {
    if (!beginTransition()) return;
    try {
      const imported = JSON.parse(await file.text()) as Project;
      await api('/source', { method: 'POST', body: JSON.stringify(imported) });
      await saveCurrent();
      const copied = await api<SavedDocument>('/models/copy', {
        method: 'POST',
        body: JSON.stringify({ name: imported.name, project: imported }),
      });
      activateModel(restoreDocument(copied, false));
      setBrowserSection(null);
      notify(`${copied.project.name} imported as a separate model.`);
    } catch (e) {
      notify('Could not import this model. ' + (e as Error).message);
    } finally {
      endTransition();
    }
  }
  const actionsRef = useRef({ commit, runSimulation, addComponent });
  actionsRef.current = { commit, runSimulation, addComponent };
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: unknown) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: 'read_gradara_model',
      description:
        'Read the current Gradara diagram, parameters, and connections.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => structuredClone(projectRef.current),
    });
    register({
      name: 'set_gradara_parameter',
      description:
        'Change a component parameter in the visible Gradara model. The change can be undone.',
      inputSchema: {
        type: 'object',
        properties: {
          blockId: { type: 'string' },
          parameterId: { type: 'string' },
          value: { type: 'number' },
        },
        required: ['blockId', 'parameterId', 'value'],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { blockId, parameterId, value } = input as {
          blockId: string;
          parameterId: string;
          value: number;
        };
        const b = projectRef.current.blocks.find((b) => b.id === blockId);
        const parameter = b?.definition.parameters.find(
          (p) => p.id === parameterId,
        );
        if (
          !parameter ||
          !Number.isFinite(value) ||
          (parameter.min !== undefined && value < parameter.min) ||
          (parameter.max !== undefined && value > parameter.max)
        )
          throw new Error('Unknown parameter or invalid value.');
        actionsRef.current.commit((p) => ({
          ...p,
          blocks: p.blocks.map((b) =>
            b.id === blockId
              ? {
                  ...b,
                  definition: {
                    ...b.definition,
                    parameters: b.definition.parameters.map((v) =>
                      v.id === parameterId ? { ...v, value } : v,
                    ),
                  },
                }
              : b,
          ),
        }));
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return { blockId, parameterId, value };
      },
    });
    return () => lifecycle.abort();
  }, []);
  return (
    <TooltipProvider delay={450}>
      <main className="workbench">
        <header className="app-header">
          <AboutDialog />
          <div className="project-breadcrumb">
            <button
              className="models-button"
              aria-label="Open model browser"
              disabled={!ready || switching || running}
              onClick={() => void openBrowser('models')}
            >
              <FolderOpen size={16} />
              <span>Models</span>
            </button>
            <ChevronRight size={14} />
            <div className="model-title-field" title="Click to rename model">
              <NameField
                label="Model name"
                value={project.name}
                onCommit={(name) => {
                  commit((p) => ({ ...p, name }));
                }}
              />
            </div>
          </div>
          <div className="header-right">
            <Button
              className="new-model-button"
              variant="outline"
              disabled={!ready || switching || running}
              onClick={() => void createModel().catch((e) => notify(e.message))}
            >
              <FilePlus2 size={15} />
              New model
            </Button>
            <Button
              className="examples-button"
              variant="ghost"
              disabled={!ready || switching || running}
              onClick={() => void openBrowser('examples')}
            >
              <BookOpen size={15} />
              Examples
            </Button>
            <Button variant="outline" onClick={() => setExportOpen(true)}>
              <ArrowUpRight />
              Export
            </Button>
          </div>
        </header>
        {startupError && (
          <div className="model-save-banner" role="alert">
            <AlertCircle size={16} />
            <span>{startupError}</span>
            <Button
              variant="outline"
              onClick={() => setLoadAttempt((n) => n + 1)}
            >
              Reconnect
            </Button>
          </div>
        )}
        {saveError && (
          <div className="model-save-banner" role="alert">
            <AlertCircle size={16} />
            <span>
              <strong>Changes are not saved.</strong> {saveError}
            </span>
            <Button
              variant="outline"
              disabled={switching}
              onClick={() => void saveCurrent().catch(() => {})}
            >
              <RotateCw size={14} />
              Retry
            </Button>
            <Button variant="outline" onClick={() => setCopyOpen(true)}>
              Save a copy…
            </Button>
            <Button
              variant="ghost"
              disabled={switching}
              onClick={() => void reloadSaved()}
            >
              Reload saved version
            </Button>
          </div>
        )}
        {switching && (
          <div className="document-transition" role="status">
            <LoaderCircle className="spin" size={20} />
            Opening model…
          </div>
        )}
        <div
          className={`main-layout ${!libraryOpen ? 'library-hidden' : ''} ${!inspectorOpen ? 'inspector-hidden' : ''}`}
        >
          <div className="model-toolbar">
            <div className="toolbar-left">
              <IconButton
                label={libraryOpen ? 'Hide components' : 'Show components'}
                onClick={() => setLibraryOpen(!libraryOpen)}
              >
                {libraryOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
              </IconButton>
              <div
                className="canvas-tools"
                role="group"
                aria-label="Canvas tools"
              >
                <button
                  aria-label="Select tool"
                  aria-pressed={canvasTool === 'select'}
                  title="Select · V"
                  onClick={() => setCanvasTool('select')}
                >
                  <MousePointer2 size={15} />
                </button>
                <button
                  aria-label="Pan tool"
                  aria-pressed={canvasTool === 'pan'}
                  title="Pan · H"
                  onClick={() => setCanvasTool('pan')}
                >
                  <Hand size={15} />
                </button>
              </div>
              <div className="model-tab">
                <Activity size={15} />
                <span>{project.name}</span>
                <span className="tab-dot" />
              </div>
            </div>
            <div className="toolbar-actions">
              <IconButton
                label="Copy selection · ⌘C"
                onClick={() => copySelection()}
                disabled={!selectedIds.length}
              >
                <Clipboard />
              </IconButton>
              <IconButton
                label="Paste selection · ⌘V"
                onClick={paste}
                disabled={!canPaste}
              >
                <ClipboardPaste />
              </IconButton>
              <IconButton
                label="Undo · ⌘Z"
                onClick={undo}
                disabled={!history.length}
              >
                <Undo2 />
              </IconButton>
              <IconButton
                label="Redo · ⇧⌘Z"
                onClick={redo}
                disabled={!future.length}
              >
                <Redo2 />
              </IconButton>
              <span className="toolbar-divider" />
              <label>
                Stop time{' '}
                <NumberField
                  value={project.duration}
                  onChange={(duration) => commit((p) => ({ ...p, duration }))}
                  min={0.000001}
                  max={60}
                  ariaLabel="Simulation stop time"
                />
                <span>s</span>
              </label>
              <Button
                className={`run-button ${running ? 'running' : ''}`}
                onClick={() => void (running ? cancelRun() : runSimulation())}
                disabled={
                  (!health.engineReady ||
                    !ready ||
                    switching ||
                    !project.blocks.length) &&
                  !running
                }
              >
                {running ? (
                  <>
                    <Square size={12} fill="currentColor" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play fill="currentColor" />
                    Run<span className="run-shortcut">⌘↵</span>
                  </>
                )}
              </Button>
              <IconButton
                label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
                onClick={() => setInspectorOpen(!inspectorOpen)}
              >
                {inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
              </IconButton>
            </div>
          </div>
          <aside className="library-panel">
            <LibraryNavigator
              onAdd={(definition) => addComponent(definition)}
              onAskAgent={startComposer}
            />
          </aside>
          <section className="center-panel">
            <div
              ref={canvasRef}
              className={`canvas-wrap tool-${canvasTool}`}
              onDoubleClick={(e) => {
                if (e.defaultPrevented) return;
                if (!(e.target as HTMLElement).closest('.react-flow__pane'))
                  return;
                const bounds = canvasRef.current?.getBoundingClientRect();
                setComposer(null);
                setInserter({
                  position: flow.screenToFlowPosition({
                    x: e.clientX,
                    y: e.clientY,
                  }),
                  screen: {
                    x: Math.max(
                      12,
                      Math.min(
                        e.clientX - (bounds?.left ?? 0),
                        (bounds?.width ?? 400) - 312,
                      ),
                    ),
                    y: Math.max(
                      12,
                      Math.min(
                        e.clientY - (bounds?.top ?? 0),
                        (bounds?.height ?? 300) - 80,
                      ),
                    ),
                  },
                });
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                e.preventDefault();
                const kind =
                  e.dataTransfer.getData('application/gradara-component') ||
                  e.dataTransfer.getData('application/flux-component');
                const d = library.find((d) => d.kind === kind);
                if (d)
                  addComponent(
                    d,
                    flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
                  );
              }}
            >
              {ready &&
                project.blocks.length === 0 &&
                !composer &&
                !inserter && (
                  <div
                    className="empty-model"
                    role="region"
                    aria-label="Empty model"
                  >
                    <span className="empty-model-icon">
                      <FilePlus2 size={28} />
                    </span>
                    <h1>Build your first connection</h1>
                    <p>
                      Add a source, an operation, or a physical component.
                      <br />
                      Connect its ports, then run your model.
                    </p>
                    <div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setLibraryOpen(true);
                          requestAnimationFrame(() =>
                            document.getElementById('library-search')?.focus(),
                          );
                        }}
                      >
                        <FolderOpen size={15} />
                        Browse blocks
                      </Button>
                      <Button variant="outline" onClick={startComposer}>
                        <Sparkles size={15} />
                        Ask agent
                      </Button>
                    </div>
                    <button
                      className="empty-model-examples"
                      onClick={() => void openBrowser('examples')}
                    >
                      Or start from an example
                    </button>
                  </div>
                )}
              {ready && (
                <ModelCanvas
                  key={project.modelId ?? 'workspace'}
                  blocks={project.blocks}
                  project={project}
                  selection={selection}
                  onCopyDrop={({ project: next, selection: selected }) => {
                    commit(next);
                    select(selected);
                  }}
                  selectedIds={selectedIds}
                  onSelectedIdsChange={(ids) =>
                    setSelectedIds((prev) =>
                      prev.length === ids.length &&
                      prev.every((id, i) => id === ids[i])
                        ? prev
                        : ids,
                    )
                  }
                  onLayout={updateLayout}
                  onLabelOffset={(id, offset) =>
                    commit((p) => setLabelOffset(p, id, offset))
                  }
                  onLabelSelect={(id) => {
                    select({ ...emptySelection(), blockIds: [id] });
                  }}
                  edges={[]}
                  nodesConnectable={false}
                  onNodeClick={(event, node) => {
                    if (event.shiftKey || event.metaKey || event.ctrlKey) {
                      // Apply the click's intent idempotently: React Flow may
                      // already have delivered its own selection change.
                      setSelectedIds(
                        node.selected
                          ? selectedIds.filter((id) => id !== node.id)
                          : [...new Set([...selectedIds, node.id])],
                      );
                    } else {
                      select({ ...emptySelection(), blockIds: [node.id] });
                      setInspectorOpen(true);
                    }
                  }}
                  onNodeDoubleClick={(_, n) => {
                    if (n.type === 'tap') return;
                    setEquationBlock(n.id);
                  }}
                  onPaneClick={() => {
                    setInserter(null);
                    select(emptySelection());
                  }}
                  onBeforeDelete={async ({ nodes, edges }) => {
                    commit((p) =>
                      removeSelection(
                        p,
                        nodes.map((n) => n.id),
                        edges.map((e) => e.id),
                      ),
                    );
                    setSelectedIds([]);
                    setSelectedEdges([]);
                    return false;
                  }}
                  fitViewOptions={{ padding: 0.16, maxZoom: 1.15 }}
                  minZoom={0.25}
                  maxZoom={2}
                  deleteKeyCode={null}
                  zoomOnDoubleClick={false}
                  selectionMode={SelectionMode.Partial}
                  selectionOnDrag={canvasTool === 'select'}
                  panOnDrag={canvasTool === 'pan' ? [0, 1, 2] : [1, 2]}
                  panOnScroll
                  zoomOnScroll={false}
                  nodeDragThreshold={2}
                  panActivationKeyCode="Space"
                  multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
                >
                  <Background gap={20} size={0.7} color="#dde3e8" />
                  <ViewportPortal>
                    {project.annotations?.map((a, i) => (
                      <div
                        key={i}
                        className="diagram-annotation"
                        style={{ transform: `translate(${a.x}px, ${a.y}px)` }}
                      >
                        <strong>{a.text}</strong>
                        {a.detail && <span>{a.detail}</span>}
                      </div>
                    ))}
                  </ViewportPortal>
                  <NetLayer
                    project={project}
                    selected={selectedEdges}
                    selection={selection}
                    groupSelection={groupSelection || selectedIds.length > 1}
                    onRegionSelect={(next) => {
                      select(next);
                      setGroupSelection(true);
                    }}
                    onSelect={(ids, additive) => {
                      select({
                        ...emptySelection(),
                        blockIds: additive ? selectedIds : [],
                        wireIds: ids,
                      });
                    }}
                    onDeleteSelection={deleteSelected}
                    onCommit={commit}
                  />
                  <Controls showInteractive={false} />
                </ModelCanvas>
              )}
              {selectedIds.length === 0 && (
                <div className="canvas-hint">
                  <MousePointer2 size={11} />
                  {canvasTool === 'select' ? 'Drag to select' : 'Drag to pan'}
                  <span>·</span>Drag a wire to branch
                  <span>·</span>/ to search
                </div>
              )}
              <div className="canvas-agent-shortcut">
                <Button variant="outline" onClick={startComposer}>
                  <Sparkles size={14} />
                  Ask agent<kbd>A</kbd>
                </Button>
              </div>
              {inserter && (
                <BlockInserter
                  context={inserter}
                  compatibleWith={
                    inserter.connection
                      ? portOf(
                          project,
                          inserter.connection.blockId,
                          inserter.connection.portId,
                        )
                      : undefined
                  }
                  onClose={() => setInserter(null)}
                  onAskAgent={() => {
                    const ctx = inserter;
                    setInserter(null);
                    setComposer({
                      position: ctx.position,
                      connection: ctx.connection,
                    });
                  }}
                  onAdd={(definition) => {
                    addComponent(
                      definition,
                      inserter.position,
                      inserter.connection,
                    );
                    setInserter(null);
                  }}
                />
              )}
              {composer && (
                <AgentComposer
                  key={
                    composer.existing?.id ?? JSON.stringify(composer.position)
                  }
                  context={composer}
                  onClose={() => setComposer(null)}
                  onInsert={insertGenerated}
                />
              )}
            </div>
            <Results
              key={project.modelId ?? 'workspace'}
              result={result}
              running={running}
              error={runError}
              stale={!!result && signature !== resultSignature}
              empty={!project.blocks.length}
            />
          </section>
          <aside className="inspector-panel">
            <div className="panel-heading">
              <Settings2 size={16} />
              <h2>Model inspector</h2>
              {active && (
                <div className="inspector-actions">
                  <IconButton label="Duplicate · ⌘D" onClick={duplicate}>
                    <Copy />
                  </IconButton>
                  <IconButton label="Delete selection" onClick={deleteSelected}>
                    <Trash2 />
                  </IconButton>
                </div>
              )}
              <IconButton
                label="Close inspector"
                onClick={() => setInspectorOpen(false)}
              >
                <X />
              </IconButton>
            </div>
            <ModelExplorer
              project={project}
              nets={nets}
              selection={selection}
              onBlock={inspectBlock}
              onNet={inspectNet}
              onModel={() => select(emptySelection())}
            />
            {activeNet && !active ? (
              <NetProperties
                description={activeNet}
                project={project}
                onRename={(name) =>
                  commit((p) => renameNet(p, activeNet.net.id, name))
                }
                onVisibility={(visible) =>
                  commit((p) => ({
                    ...p,
                    nets: p.nets?.map((n) =>
                      n.id === activeNet.net.id
                        ? { ...n, hidden: !visible }
                        : n,
                    ),
                  }))
                }
                onResetLabel={() =>
                  commit((p) => setNetLabel(p, activeNet.net.id, undefined))
                }
                onTrace={() => inspectNet(activeNet.net.id)}
                onFocus={() => focusNet(activeNet.net.id)}
                onBlock={inspectBlock}
              />
            ) : active ? (
              <>
                <div className="inspector-intro">
                  <span
                    className="component-category"
                    style={{ color: domainColors[active.definition.domain] }}
                  >
                    {active.definition.generated ? (
                      <>
                        <Sparkles size={11} />
                        AGENT COMPONENT
                      </>
                    ) : active.definition.controller ? (
                      'CONTROLLER'
                    ) : (
                      active.definition.domain.toUpperCase()
                    )}
                  </span>
                  <NameField
                    key={active.id}
                    value={active.definition.name}
                    onCommit={(name) => {
                      commit((p) => ({
                        ...p,
                        blocks: p.blocks.map((b) =>
                          b.id === active.id
                            ? { ...b, definition: { ...b.definition, name } }
                            : b,
                        ),
                      }));
                      return (
                        projectRef.current.blocks.find(
                          (b) => b.id === active.id,
                        )?.definition.name ?? name
                      );
                    }}
                  />
                  <IdentityField id={active.id} label="Block ID" />
                  <p>{active.definition.description}</p>
                  <Button
                    className="refine-button"
                    variant="outline"
                    disabled={active.definition.domain !== 'signal'}
                    onClick={() =>
                      setComposer({
                        position: active.position,
                        existing: {
                          id: active.id,
                          definition: active.definition,
                        },
                      })
                    }
                  >
                    <Sparkles size={13} />
                    Refine with agent
                  </Button>
                </div>
                <div className="inspector-section">
                  <div className="section-label">
                    Parameters<span>{active.definition.parameters.length}</span>
                  </div>
                  {active.definition.parameters.length ? (
                    active.definition.parameters.map((param) => (
                      <label
                        className="parameter"
                        key={`${active.id}-${param.id}`}
                      >
                        <span>{param.name}</span>
                        <div>
                          <NumberField
                            value={param.value}
                            min={param.min}
                            max={param.max}
                            ariaLabel={param.name}
                            onChange={(value) =>
                              commit((p) => ({
                                ...p,
                                blocks: p.blocks.map((b) =>
                                  b.id !== active.id
                                    ? b
                                    : {
                                        ...b,
                                        definition: {
                                          ...b.definition,
                                          parameters:
                                            b.definition.parameters.map((x) =>
                                              x.id === param.id
                                                ? { ...x, value }
                                                : x,
                                            ),
                                        },
                                      },
                                ),
                              }))
                            }
                          />
                          <span>{param.unit}</span>
                        </div>
                      </label>
                    ))
                  ) : (
                    <p className="no-parameters">
                      This component has no parameters.
                    </p>
                  )}
                </div>
                <div className="inspector-section block-layout-section">
                  <div className="section-label">
                    Block size <span className="subtle">px</span>
                  </div>
                  <div className="block-size-fields">
                    <label>
                      Width
                      <NumberField
                        key={`${active.id}-width`}
                        value={blockSize(active).width}
                        min={minimumBlockSize(active.definition).width}
                        max={1200}
                        ariaLabel="Block width"
                        onChange={(width) =>
                          updateLayout([
                            {
                              id: active.id,
                              position: active.position,
                              size: { ...blockSize(active), width },
                            },
                          ])
                        }
                      />
                    </label>
                    <label>
                      Height
                      <NumberField
                        key={`${active.id}-height`}
                        value={blockSize(active).height}
                        min={minimumBlockSize(active.definition).height}
                        max={1000}
                        ariaLabel="Block height"
                        onChange={(height) =>
                          updateLayout([
                            {
                              id: active.id,
                              position: active.position,
                              size: { ...blockSize(active), height },
                            },
                          ])
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="standard-block-size"
                    onClick={() =>
                      updateLayout([
                        {
                          id: active.id,
                          position: active.position,
                          size: defaultBlockSize(active.definition),
                        },
                      ])
                    }
                  >
                    Use standard size
                  </button>
                  <p className="size-hint">
                    Drag a corner or edge to resize. Text stays the same size.
                  </p>
                </div>
                <div className="inspector-section">
                  <div className="section-label">Interface</div>
                  {active.definition.ports.map((p) => (
                    <div key={p.id} className="interface-row">
                      <span
                        className="port-dot"
                        style={{ background: domainColors[p.domain] }}
                      />
                      <span>{p.name}</span>
                      <code>
                        {p.direction === 'physical' ? p.domain : p.direction}
                      </code>
                    </div>
                  ))}
                </div>
                <div className="inspector-section">
                  <div className="section-label">
                    <Code2 size={13} />
                    Equations
                    <button onClick={() => setEquationBlock(active.id)}>
                      Open
                      <ArrowUpRight size={11} />
                    </button>
                  </div>
                  <pre className="equation-preview">
                    {active.definition.equations}
                  </pre>
                </div>
                {active.definition.domain === 'signal' && (
                  <div className="inspector-section">
                    <div className="section-label">Implementation</div>
                    {active.definition.controller ? (
                      <div className="controller-badge">
                        <Check size={13} />
                        Controller export boundary
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        className="mark-controller"
                        onClick={() =>
                          commit((p) => ({
                            ...p,
                            blocks: p.blocks.map((b) =>
                              b.id === active.id
                                ? {
                                    ...b,
                                    definition: {
                                      ...b.definition,
                                      controller: true,
                                    },
                                  }
                                : b,
                            ),
                          }))
                        }
                      >
                        Mark as controller
                      </Button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="inspector-empty">
                <MousePointer2 size={25} />
                <NameField
                  label="Model name"
                  value={project.name}
                  onCommit={(name) => commit((p) => ({ ...p, name }))}
                />
                <label className="model-duration-field">
                  Stop time (seconds)
                  <NumberField
                    ariaLabel="Model stop time"
                    value={project.duration}
                    min={0.000001}
                    max={60}
                    onChange={(duration) => commit((p) => ({ ...p, duration }))}
                  />
                </label>
                <p>
                  {project.description ||
                    'Select a block or net above, or click it on the canvas to inspect its properties.'}
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    void flow.fitView({ padding: 0.2, duration: 200 })
                  }
                >
                  <Maximize size={13} />
                  Fit model to view
                </Button>
              </div>
            )}
          </aside>
        </div>
        <footer className="statusbar">
          <span>
            <span
              className={`status-dot ${health.engineReady ? '' : 'offline'}`}
            />
            {health.engineReady
              ? 'OpenModelica ready'
              : 'OpenModelica unavailable · Check the local service'}
          </span>
          <span>
            {project.blocks.length} components · {nets.length} nets
          </span>
          <span className="domain-legend" aria-label="Port domains">
            {[
              ...new Set(
                project.blocks.flatMap((b) =>
                  b.definition.ports.map((p) => p.domain),
                ),
              ),
            ]
              .sort()
              .map((domain) => (
                <span key={domain}>
                  <i
                    style={{
                      background: domainColors[domain],
                      borderRadius: domain === 'signal' ? '50%' : 1,
                    }}
                  />
                  {domain}
                </span>
              ))}
          </span>
          <span
            className={`save-indicator ${saveError ? 'save-failed' : ''}`}
            role="status"
          >
            {saving === 'Saving' ? (
              <LoaderCircle size={10} className="spin" />
            ) : saveError ? (
              <AlertCircle size={12} />
            ) : saving === 'Saved' ? (
              <Check size={10} />
            ) : (
              <span className="unsaved-dot" />
            )}{' '}
            {saving}
          </span>
          <button className="status-end" onClick={() => setHelpOpen(true)}>
            <Keyboard size={13} />
            Shortcuts
          </button>
        </footer>
        {notice && (
          <div className="workspace-notice" role="status">
            {notice}
            <button onClick={() => setNotice('')} aria-label="Dismiss message">
              <X size={13} />
            </button>
          </div>
        )}
        <input
          type="file"
          accept=".json"
          ref={importRef}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importProject(file);
            e.target.value = '';
          }}
        />
        {equationBlock &&
          project.blocks.find((b) => b.id === equationBlock) && (
            <EquationEditor
              definition={
                project.blocks.find((b) => b.id === equationBlock)!.definition
              }
              onClose={() => setEquationBlock(null)}
              onApply={(definition) => {
                commit((p) => replaceDefinition(p, equationBlock, definition));
                setEquationBlock(null);
                notify('Equations updated. Run the model to apply them.');
              }}
            />
          )}
        {browserSection && (
          <ModelBrowser
            section={browserSection}
            activeId={project.modelId}
            onClose={() => setBrowserSection(null)}
            onOpen={openModel}
            onCreate={createModel}
            onImport={() => importRef.current?.click()}
            onCopy={() => {
              setBrowserSection(null);
              setCopyOpen(true);
            }}
          />
        )}
        {copyOpen && (
          <SaveCopyDialog
            name={project.name}
            onClose={() => setCopyOpen(false)}
            onSave={saveCopy}
          />
        )}
        {exportOpen && (
          <ExportDialog
            project={project}
            selectedId={active?.id}
            onClose={() => setExportOpen(false)}
          />
        )}
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="shortcuts-dialog">
            <DialogTitle>Make yourself at home</DialogTitle>
            <DialogDescription>
              A few shortcuts for moving quickly through your model.
            </DialogDescription>
            <div className="shortcut-list">
              {[
                ['Search the library', '/'],
                ['Draw a connection', 'Drag or click two ports'],
                ['Branch from a wire', 'Alt + drag'],
                ['Move a wire segment', 'Select, then drag'],
                ['Reconnect a wire', 'Drag its round end'],
                ['Redraw a wire', 'Select + D'],
                ['Finish redrawing', 'Click destination / Enter'],
                ['Remove last bend / cancel', 'Backspace / Escape'],
                ['Restore auto route', 'R'],
                ['Name a signal / net', 'Double-click wire / F2'],
                ['Move a signal label', 'Drag along its net'],
                ['Create a component', 'A'],
                ['Run simulation', '⌘ / Ctrl + Enter'],
                ['Undo', '⌘ / Ctrl + Z'],
                ['Redo', '⌘ / Ctrl + Shift + Z'],
                ['Duplicate selection', '⌘ / Ctrl + D'],
                ['Drag a copy of a block or selection', 'Ctrl + drag'],
                ['Select all blocks and wires', '⌘ / Ctrl + A'],
                [
                  'Copy / cut selection (in this workspace)',
                  '⌘ / Ctrl + C / X',
                ],
                ['Paste selection', '⌘ / Ctrl + V'],
                ['Delete selection', 'Delete / Backspace'],
                ['Fit model to canvas', 'F'],
                ['Select several components', 'Shift + click / Drag'],
                ['Select / pan tools', 'V / H'],
                ['Pan canvas', 'Space + drag / Trackpad'],
                ['Resize a block', 'Drag a corner or edge'],
                ['Move a block name', 'Drag the label'],
                ['Reset label position', 'Double-click its label'],
                ['Nudge selected blocks', 'Arrow keys'],
                ['Inspect equations', 'Double-click a block'],
                ['Save', 'Automatic'],
              ].map(([label, key]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}
export default function Home() {
  return (
    <ReactFlowProvider>
      <Workbench />
    </ReactFlowProvider>
  );
}
