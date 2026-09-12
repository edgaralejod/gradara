'use client';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlowProvider,
  Background,
  ViewportPortal,
  MarkerType,
  Controls,
  ConnectionMode,
  ConnectionLineType,
  Position,
  SelectionMode,
  useReactFlow,
  type Connection,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Activity,
  Play,
  Sparkles,
  Undo2,
  Redo2,
  ChevronRight,
  Settings2,
  Code2,
  ArrowUpRight,
  FolderOpen,
  Square,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Copy,
  Trash2,
  Maximize,
  Keyboard,
  Upload,
  Check,
  LoaderCircle,
  X,
  RotateCcw,
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
import {
  applyLayout,
  blockSize,
  minimumBlockSize,
  type BlockLayout,
} from '@/lib/gradara/canvas';
import NumberField from '@/components/gradara/number-field';
import NameField from '@/components/gradara/name-field';
import Results from '@/components/gradara/results';
import { focProject } from '@/lib/gradara/foc';
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
  initialProject,
  library,
  domainColors,
  type Project,
  type Definition,
  compatible,
  portOf,
} from '@/lib/gradara/model';
import {
  endpointPoint,
  endpointPort,
  endpointsCompatible,
  isTap,
  tapOf,
} from '@/lib/gradara/net';
import { matchingPort } from '@/lib/gradara/catalog';
import {
  placeAligned,
  placeAtDrop,
  placeDownstream,
  snapMovedBlocks,
  snapPoint,
} from '@/lib/gradara/placement';
import { WiringPreview } from '@/components/gradara/signal-edge';
import {
  insertVertexOnWire,
  resetWireRoute,
  setWireWaypoints,
} from '@/lib/gradara/wires';
import { linkEnds } from '@/lib/gradara/project';
import { NetSession } from '@/lib/gradara/net-session';
import { committedPoints } from '@/lib/gradara/net-draw';
import NetLayer from '@/components/gradara/net-layer';
import { feedbackRailY, isReturnPath, pinRubberBand } from '@/lib/gradara/routing';
import { sideToPosition } from '@/lib/gradara/wires';
import { portPoint } from '@/lib/gradara/ports';
import {
  api,
  waitForJob,
  type SimulationResult,
  type Job,
} from '@/lib/gradara/api';
import {
  semanticSignature,
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
  const [project, setProject] = useState<Project>(initialProject);
  const savedBody = useRef('');
  const projectRef = useRef(project);
  projectRef.current = project;
  const [selectedIds, setSelectedIds] = useState<string[]>(['controller']);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);
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
  const sessionRef = useRef(new NetSession(projectRef.current));
  const [, setNetTick] = useState(0);
  const bumpNet = () => setNetTick((n) => n + 1);
  const [equationBlock, setEquationBlock] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [resultSignature, setResultSignature] = useState('');
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runController = useRef<AbortController | null>(null);
  const runId = useRef('');
  const importRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const notify = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 5500);
  }, []);
  const commit = useCallback((update: Project | ((p: Project) => Project)) => {
    const previous = projectRef.current;
    const next = typeof update === 'function' ? update(previous) : update;
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
  const activeWire = project.wires.find((w) => w.id === selectedEdges[0]);
  const signature = useMemo(() => semanticSignature(project), [project]);
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const loaded = await api<{ project: Project | null }>('/project');
        if (disposed) return;
        if (loaded.project) {
          if (loaded.project.exampleId === 'foc') {
            setInspectorOpen(false);
            setSelectedIds([]);
          }
          setProject(loaded.project);
          projectRef.current = loaded.project;
          savedBody.current = JSON.stringify(loaded.project);
        }
        const latest = await api<{ result: SimulationResult | null }>(
          `/results/latest?example=${loaded.project?.exampleId ?? 'dc'}`,
        );
        if (!disposed && latest.result) {
          setResult(latest.result);
          if (latest.result.snapshot)
            setResultSignature(semanticSignature(latest.result.snapshot));
        }
      } catch {
        const local =
          localStorage.getItem('gradara-workspace') ??
          localStorage.getItem('flux-workspace');
        if (local) {
          try {
            const p = JSON.parse(local);
            setProject(p);
            projectRef.current = p;
          } catch {}
        }
      } finally {
        if (!disposed) setReady(true);
      }
    }
    void load();
    if (window.innerWidth < 1100) setInspectorOpen(false);
    if (window.innerWidth < 800) setLibraryOpen(false);
    return () => {
      disposed = true;
      runController.current?.abort();
    };
  }, []);
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
  useEffect(() => {
    if (!ready || switching) return;
    const body = JSON.stringify(project);
    if (body === savedBody.current) {
      setSaving('Saved');
      return;
    }
    setSaving('Saving');
    const timer = setTimeout(() => {
      localStorage.setItem('gradara-workspace', JSON.stringify(project));
      localStorage.removeItem('flux-workspace');
      void api('/project', { method: 'PUT', body })
        .then(() => {
          savedBody.current = body;
          setSaving('Saved');
        })
        .catch((e) => {
          setSaving('Saved on device');
          notify((e as Error).message);
        });
    }, 550);
    return () => clearTimeout(timer);
  }, [project, ready, switching, notify]);
  const openExample = async (exampleId: string) => {
    if (
      switching ||
      running ||
      exampleId === (projectRef.current.exampleId ?? 'dc')
    )
      return;
    setSwitching(true);
    try {
      await api('/project', {
        method: 'PUT',
        body: JSON.stringify(projectRef.current),
      });
      const loaded = await api<{ project: Project }>(`/examples/${exampleId}`);
      const next = { ...loaded.project, exampleId };
      await api('/project', { method: 'PUT', body: JSON.stringify(next) });
      savedBody.current = JSON.stringify(next);
      projectRef.current = next;
      setProject(next);
      setHistory([]);
      setFuture([]);
      setSelectedIds([]);
      setSelectedEdges([]);
      setInspectorOpen(false);
      setRunError('');
      setResult(null);
      setResultSignature('');
      const latest = await api<{ result: SimulationResult | null }>(
        `/results/latest?example=${exampleId}`,
      );
      setResult(latest.result);
      if (latest.result?.snapshot)
        setResultSignature(semanticSignature(latest.result.snapshot));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSwitching(false);
    }
  };
  const updateLayout = useCallback(
    (layouts: BlockLayout[]) => {
      commit((p) =>
        snapMovedBlocks(
          applyLayout(p, layouts),
          layouts.map((l) => l.id).filter((id) => !id.startsWith('j_')),
        ),
      );
    },
    [commit],
  );
  const edges = useMemo(
    () =>
      project.wires.map((w) => {
        const sourcePort = endpointPort(
          project,
          w.source,
          w.sourceHandle,
          'source',
        );
        const domain = sourcePort?.domain ?? 'signal';
        const pts = committedPoints(
          project,
          w.source,
          w.sourceHandle,
          w.target,
          w.targetHandle,
          w.waypoints,
        );
        return {
          ...w,
          type: 'signal',
          data: {
            waypoints: pts.slice(1, -1),
            flow: sourcePort?.direction === 'physical' ? 'physical' : 'signal',
            onSelect: () => setSelectedEdges([w.id]),
            onVerticesCommit: (points: { x: number; y: number }[]) => {
              commit((p) => setWireWaypoints(p, w.id, points));
            },
            onInsertVertex: (point: { x: number; y: number }) => {
              commit((p) => insertVertexOnWire(p, w.id, point));
              setSelectedEdges([w.id]);
            },
            onBranchStart: (point: { x: number; y: number }) => {
              sessionRef.current.project = projectRef.current;
              sessionRef.current.pressSegment(point);
              bumpNet();
            },
          },
          markerEnd:
            domain === 'signal'
              ? {
                  type: MarkerType.ArrowClosed,
                  width: 10,
                  height: 10,
                  color: domainColors[domain],
                }
              : undefined,
          selected: selectedEdges.includes(w.id),
          style: { stroke: domainColors[domain], strokeWidth: 1.4 },
          pathOptions: { borderRadius: 5, offset: 28 },
          interactionWidth: 18,
        };
      }),
    [project.blocks, project.wires, selectedEdges],
  );
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const selections = changes.filter((c) => c.type === 'select');
    if (selections.length)
      setSelectedEdges((ids) => {
        let next = [...ids];
        for (const c of selections)
          if (c.type === 'select')
            next = c.selected
              ? [...new Set([...next, c.id])]
              : next.filter((id) => id !== c.id);
        return next;
      });
  }, []);
  const connect = useCallback(
    (c: Connection) => {
      if (!c.sourceHandle || !c.targetHandle) return;
      try {
        commit((p) =>
          linkEnds(
            p,
            { id: c.source, handle: c.sourceHandle! },
            { id: c.target, handle: c.targetHandle! },
          ),
        );
      } catch (e) {
        notify((e as Error).message);
      }
    },
    [commit, notify],
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
        : origin?.definition.ports.find((x) => x.direction === 'output') ??
          origin?.definition.ports.find((x) => x.direction === 'physical');
      const toPort = matchingPort(fromPort, definition);
      const placed =
        connection && position
          ? placeAtDrop(position, definition, toPort, fromPort?.direction)
          : position
            ? snapPoint(position)
            : origin && fromPort && toPort
              ? placeAligned(origin, fromPort, definition, toPort)
              : snapPoint(newPosition());
      commit((p) => {
        let next = {
          ...p,
          blocks: [
            ...p.blocks,
            {
              id,
              definition: structuredClone(definition),
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
                  selected.definition.ports.find((x) => x.direction === 'output')
                    ?.id ?? '',
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
    if (!selectedIds.length && !selectedEdges.length) return;
    commit((p) => removeSelection(p, selectedIds, selectedEdges));
    setSelectedIds([]);
    setSelectedEdges([]);
  }, [commit, selectedIds, selectedEdges]);
  const duplicate = useCallback(() => {
    const d = duplicateBlocks(projectRef.current, selectedIds);
    if (!d.ids.length) return;
    commit(d.project);
    setSelectedIds(d.ids);
  }, [commit, selectedIds]);
  const startComposer = useCallback(
    () => setComposer({ position: newPosition() }),
    [newPosition],
  );
  async function runSimulation() {
    if (running) return;
    setRunning(true);
    setRunError('');
    runController.current = new AbortController();
    const snapshot = structuredClone(projectRef.current);
    const currentSignature = semanticSignature(snapshot);
    try {
      const job = await api<Job<SimulationResult>>('/runs', {
        method: 'POST',
        body: JSON.stringify(snapshot),
        signal: runController.current.signal,
      });
      runId.current = job.id;
      const r = await waitForJob<SimulationResult>(
        job.id,
        runController.current.signal,
      );
      setResult(r);
      setResultSignature(currentSignature);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setRunError((e as Error).message);
    } finally {
      setRunning(false);
      runId.current = '';
    }
  }
  async function cancelRun() {
    runController.current?.abort();
    if (runId.current) {
      try {
        await api(`/jobs/${runId.current}`, { method: 'DELETE' });
      } catch (e) {
        notify((e as Error).message);
      }
    }
    setRunning(false);
    notify('Simulation cancelled.');
  }
  const runRef = useRef(runSimulation);
  runRef.current = runSimulation;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const input = (e.target as HTMLElement)?.closest(
        'input,textarea,[contenteditable=true],.monaco-editor,[role=dialog]',
      );
      if (input) return;
      const command = e.metaKey || e.ctrlKey;
      if (command && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (command && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
      } else if (command && e.key.toLowerCase() === 's') {
        e.preventDefault();
        notify('Your workspace saves automatically.');
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
      } else if (e.key.toLowerCase() === 'r' && !command && selectedEdges.length) {
        e.preventDefault();
        commit((p) =>
          selectedEdges.reduce((next, id) => resetWireRoute(next, id), p),
        );
      } else if (e.key === 'Backspace' && sessionRef.current.mode === 'drawing') {
        e.preventDefault();
        sessionRef.current.unpin();
        bumpNet();
      } else if (e.key === 'Escape') {
        setComposer(null);
        setInserter(null);
        sessionRef.current.cancel();
        commit(sessionRef.current.project);
        bumpNet();
        setSelectedIds([]);
        setSelectedEdges([]);
      } else if (e.key === '?' && !command) setHelpOpen(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [
    undo,
    redo,
    duplicate,
    notify,
    composer,
    startComposer,
    flow,
    selectedEdges,
    commit,
  ]);
  useEffect(() => {
    if (sessionRef.current.mode === 'idle')
      sessionRef.current.project = project;
  }, [project]);
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
        blocks: [...p.blocks, { id, definition, position: ctx.position }],
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
    try {
      const imported = JSON.parse(await file.text()) as Project;
      await api('/source', { method: 'POST', body: JSON.stringify(imported) });
      commit(imported);
      setSelectedIds([]);
      setResult(null);
      setTimeout(() => void flow.fitView({ padding: 0.2, duration: 200 }), 100);
      notify('Project opened.');
    } catch (e) {
      notify('Could not open this project. ' + (e as Error).message);
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
          <div className="brand">
            <span className="brand-icon">
              <Activity size={23} />
            </span>
            Gradara<span className="preview-tag">MODELING</span>
          </div>
          <div className="project-breadcrumb">
            <FolderOpen size={16} />
            <span>Examples</span>
            <ChevronRight size={14} />
            <select
              aria-label="Example model"
              value={project.exampleId ?? 'dc'}
              disabled={switching || running}
              onChange={(e) => void openExample(e.target.value)}
            >
              <option value="dc">DC motor · Speed control</option>
              <option value="foc">AC motor · Field-oriented control</option>
            </select>
            <span className="saved-dot" />
          </div>
          <div className="header-right">
            <span className="local-badge">
              <span />
              Local workspace
            </span>
            <IconButton
              label="Open a Gradara project"
              onClick={() => importRef.current?.click()}
            >
              <Upload size={15} />
            </IconButton>
            <Button variant="outline" onClick={() => setExportOpen(true)}>
              <ArrowUpRight />
              Export
            </Button>
          </div>
        </header>
        <div
          className={`main-layout ${!libraryOpen ? 'library-hidden' : ''} ${!inspectorOpen ? 'inspector-hidden' : ''}`}
        >
          <aside className="library-panel">
            <LibraryNavigator
              onAdd={(definition) => addComponent(definition)}
              onAskAgent={startComposer}
            />
          </aside>
          <section className="center-panel">
            <div className="model-toolbar">
              <div className="toolbar-left">
                <IconButton
                  label={libraryOpen ? 'Hide components' : 'Show components'}
                  onClick={() => setLibraryOpen((v) => !v)}
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
                  <span>
                    {project.exampleId === 'foc'
                      ? 'FOC controller + PMSM'
                      : 'DC motor control'}
                  </span>
                  <span className="tab-dot" />
                </div>
              </div>
              <div className="toolbar-actions">
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
                    min={0.05}
                    max={60}
                    ariaLabel="Simulation stop time"
                  />
                  <span>s</span>
                </label>
                <Button
                  className={`run-button ${running ? 'running' : ''}`}
                  onClick={() => void (running ? cancelRun() : runSimulation())}
                  disabled={!health.engineReady && !running}
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
                  onClick={() => setInspectorOpen((v) => !v)}
                >
                  {inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
                </IconButton>
              </div>
            </div>
            <div
              ref={canvasRef}
              className={`canvas-wrap tool-${canvasTool}`}
              onDoubleClick={(e) => {
                if (sessionRef.current.mode !== 'idle') return;
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
              {ready && (
                <ModelCanvas
                  key={project.exampleId ?? 'dc'}
                  blocks={project.blocks}
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
                  edges={edges}
                  onEdgesChange={onEdgesChange}
                  onNodeClick={(event, n) => {
                    if (event.shiftKey || event.metaKey || event.ctrlKey) {
                      setSelectedIds(
                        selectedIds.includes(n.id)
                          ? selectedIds.filter((id) => id !== n.id)
                          : [...selectedIds, n.id],
                      );
                    } else setSelectedIds([n.id]);
                    setInspectorOpen(true);
                  }}
                  onNodeDoubleClick={(_, n) => {
                    if (n.type === 'tap') return;
                    setEquationBlock(n.id);
                  }}
                  onConnect={connect}
                  onReconnect={(old, c) => {
                    if (!c.sourceHandle || !c.targetHandle) return;
                    try {
                      commit((p) =>
                        addWire(
                          {
                            ...p,
                            wires: p.wires.filter((w) => w.id !== old.id),
                          },
                          {
                            ...c,
                            id: old.id,
                            sourceHandle: c.sourceHandle!,
                            targetHandle: c.targetHandle!,
                          },
                        ),
                      );
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                  onConnectEnd={(event, state) => {
                    if (!state.fromNode || !state.fromHandle) return;
                    if (state.isValid && state.toNode) return;
                    const e =
                      'changedTouches' in event
                        ? event.changedTouches[0]
                        : event;
                    const cursor = flow.screenToFlowPosition({
                      x: e.clientX,
                      y: e.clientY,
                    });
                    const s = sessionRef.current;
                    s.project = projectRef.current;
                    if (isTap(s.project, state.fromNode.id))
                      s.pressJunction(state.fromNode.id, cursor);
                    else
                      s.pressPort(state.fromNode.id, state.fromHandle.id ?? '');
                    s.release(cursor);
                    if (s.mode === 'idle') commit(s.project);
                    bumpNet();
                  }}
                  onPointerMove={(e) => {
                    if (sessionRef.current.mode === 'idle') return;
                    const cursor = flow.screenToFlowPosition({
                      x: e.clientX,
                      y: e.clientY,
                    });
                    sessionRef.current.move(cursor.x, cursor.y);
                    bumpNet();
                  }}
                  onPointerUp={(e) => {
                    const s = sessionRef.current;
                    if (s.mode !== 'connecting') return;
                    const cursor = flow.screenToFlowPosition({
                      x: e.clientX,
                      y: e.clientY,
                    });
                    try {
                      s.release(cursor);
                      bumpNet();
                      if (sessionRef.current.mode === 'idle')
                        commit(sessionRef.current.project);
                    } catch (err) {
                      notify((err as Error).message);
                    }
                  }}
                  onPaneClick={(e) => {
                    const s = sessionRef.current;
                    if (s.mode !== 'idle') {
                      const cursor = flow.screenToFlowPosition({
                        x: e.clientX,
                        y: e.clientY,
                      });
                      try {
                        s.click(cursor);
                        bumpNet();
                        if (sessionRef.current.mode === 'idle')
                          commit(sessionRef.current.project);
                      } catch (err) {
                        notify((err as Error).message);
                      }
                      return;
                    }
                    setInserter(null);
                    setSelectedIds([]);
                    setSelectedEdges([]);
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
                  connectionMode={ConnectionMode.Loose}
                  connectionLineType={ConnectionLineType.SmoothStep}
                  connectionLineComponent={WiringPreview}
                  isValidConnection={(c) => {
                    if (!c.sourceHandle || !c.targetHandle) return false;
                    if (c.source === c.target) return false;
                    if (
                      isTap(project, c.source) ||
                      isTap(project, c.target)
                    )
                      return true;
                    return endpointsCompatible(
                      project,
                      c.source,
                      c.sourceHandle,
                      c.target,
                      c.targetHandle,
                    );
                  }}
                  fitViewOptions={{ padding: 0.16, maxZoom: 1.15 }}
                  minZoom={0.25}
                  maxZoom={2}
                  snapToGrid
                  snapGrid={[20, 20]}
                  deleteKeyCode={['Backspace', 'Delete']}
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
                    session={sessionRef.current}
                    onChange={bumpNet}
                    onCommit={() => commit(sessionRef.current.project)}
                  />
                  <Controls showInteractive={false} />
                </ModelCanvas>
              )}
              {sessionRef.current.mode !== 'idle' ? (
                <div className="canvas-hint">
                  Click pins this run · Port ends the wire · Esc cancel
                </div>
              ) : selectedIds.length === 0 && (
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
                  Create block<kbd>A</kbd>
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
              key={project.exampleId ?? 'dc'}
              result={result}
              running={running}
              error={runError}
              stale={!!result && signature !== resultSignature}
            />
          </section>
          <aside className="inspector-panel">
            <div className="panel-heading">
              <Settings2 size={16} />
              <h2>Inspector</h2>
              {selectedIds.length > 0 && (
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
            {activeWire && !active ? (
              <>
                <div className="inspector-intro">
                  <span className="component-category">CONNECTION</span>
                  <h3 className="component-name-input" style={{ fontSize: 18 }}>
                    Wire
                  </h3>
                  <p>
                    Drag the squares to redraw. Drag from the wire itself to
                    branch to another input. R restores the automatic route.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      commit((p) => resetWireRoute(p, activeWire.id))
                    }
                  >
                    Auto route
                  </Button>
                </div>
              </>
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
                    }}
                  />
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
                        min={minimumBlockSize(active.definition.kind).width}
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
                        min={minimumBlockSize(active.definition.kind).height}
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
                  <p className="size-hint">Drag a corner or edge to resize.</p>
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
                <strong>
                  {project.description ? project.name : 'Select a component'}
                </strong>
                <p>
                  {project.description ||
                    'Explore its parameters, interface, and equations here.'}
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
                <Button variant="ghost" onClick={() => setResetOpen(true)}>
                  <RotateCcw size={13} />
                  Reset example
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
              : 'Connecting to engine…'}
          </span>
          <span>
            {project.blocks.length} components · {project.wires.length}{' '}
            connections
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
          <span className="save-indicator">
            {saving === 'Saving' ? (
              <LoaderCircle size={10} className="spin" />
            ) : (
              <Check size={10} />
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
                ['Branch from a wire', 'Drag the wire'],
                ['Redraw a wire', 'Drag its squares'],
                ['Restore auto route', 'R'],
                ['Create a component', 'A'],
                ['Run simulation', '⌘ / Ctrl + Enter'],
                ['Undo', '⌘ / Ctrl + Z'],
                ['Redo', '⌘ / Ctrl + Shift + Z'],
                ['Duplicate selection', '⌘ / Ctrl + D'],
                ['Delete selection', 'Delete / Backspace'],
                ['Fit model to canvas', 'F'],
                ['Select several components', 'Shift + click / Drag'],
                ['Select / pan tools', 'V / H'],
                ['Pan canvas', 'Space + drag / Trackpad'],
                ['Resize a block', 'Drag a corner or edge'],
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
        <Dialog open={resetOpen} onOpenChange={setResetOpen}>
          <DialogContent>
            <DialogTitle>Restore the motor example?</DialogTitle>
            <DialogDescription>
              Your current diagram will be replaced. You can undo this change.
            </DialogDescription>
            <div className="dialog-actions">
              <Button variant="outline" onClick={() => setResetOpen(false)}>
                Keep working
              </Button>
              <Button
                onClick={() => {
                  commit(
                    project.exampleId === 'foc'
                      ? focProject()
                      : initialProject(),
                  );
                  setSelectedIds(
                    project.exampleId === 'foc' ? [] : ['controller'],
                  );
                  setResetOpen(false);
                  setRunError('');
                  setTimeout(
                    () => void flow.fitView({ padding: 0.2, duration: 200 }),
                    100,
                  );
                }}
              >
                Restore example
              </Button>
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
