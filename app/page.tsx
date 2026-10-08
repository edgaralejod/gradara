'use client';
import { rotateBlocks } from '@/lib/gradara/rotation';
import { arrangeIfBetter } from '@/lib/gradara/arrange';
import GridBackground from '@/components/gradara/grid-background';
import NoteLayer from '@/components/gradara/note-layer';
import SimulationSettingsPanel from '@/components/gradara/simulation-settings';
import RunProgress from '@/components/gradara/run-progress';
import { advance, startTrack, statusText, type RunTrack } from '@/lib/gradara/run-progress';
import SolverHelpDialog from '@/components/gradara/solver-help-dialog';
import BlockHelpDialog, {
  OPEN_EXAMPLE_EVENT,
  type OpenExampleDetail,
} from '@/components/gradara/block-help-dialog';
import { useStored } from '@/components/gradara/use-stored';
import {
  PaneResizer,
  RESET_LAYOUT_EVENT,
  resetLayout,
  useColumns,
  useSize,
} from '@/components/gradara/resizable-columns';
import CanvasMenu, {
  type CanvasMenuItem,
} from '@/components/gradara/canvas-menu';
import SelectionActions from '@/components/gradara/selection-actions';
import { addPort, editPort, kindFor } from '@/lib/gradara/subsystem-ports';
import { GRID, snap as snapGrid, snapLength } from '@/lib/gradara/grid';
import PortDialog from '@/components/gradara/port-dialog';
import { boundaryFor } from '@/lib/gradara/port-blocks';
import HierarchyBar from '@/components/gradara/hierarchy-bar';
import {
  InstancePortsPanel,
  PortPillPanel,
} from '@/components/gradara/subsystem-ports-panel';
import { useGeneratedLibrary } from '@/lib/gradara/generated-library';
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
  Controls,
  ControlButton,
  SelectionMode,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Activity,
  ListTree,
  Play,
  Sparkles,
  Stethoscope,
  Undo2,
  Redo2,
  ChevronRight,
  BookOpen,
  Settings as SettingsIcon,
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
  StickyNote,
  Trash2,
  Maximize,
  LayoutGrid,
  Grid3x3,
  CircleHelp,
  PanelsTopLeft,
  Group,
  Ungroup,
  Unplug,
  Scissors,
  Plus,
  CopyPlus,
  CornerLeftUp,
  SquareDashedMousePointer,
  LogIn,
  LogOut,
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
import ModelCanvas, { FIT_VIEW_EVENT } from '@/components/gradara/model-canvas';

const GRID_VISIBLE_KEY = 'gradara:grid-visible';
import { normalizeProject } from '@/lib/gradara/normalize-project';
import { describeNets, renameNet } from '@/lib/gradara/net-registry';
import { setNetLabel, setNetLabelShown } from '@/lib/gradara/net-label';
import {
  IdentityField,
  ModelExplorer,
  NetProperties,
} from '@/components/gradara/model-inspector';
import {
  emptySelection,
  extractSelection,
  layoutSelection,
  translateSelection,
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
import { STOP_TIME, rangeText } from '@/lib/gradara/number-input';
import NameField from '@/components/gradara/name-field';
import Results from '@/components/gradara/results';
import {
  openOutputs,
  removeTerminators,
  terminateOpenOutputs,
} from '@/lib/gradara/terminators';
import ModelBrowser, {
  type BrowserSection,
  type ImportError,
} from '@/components/gradara/model-browser';
import ModelComposer from '@/components/gradara/model-composer';
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
import {
  clampPopoverPosition,
  isCanvasInsertDoubleClick,
} from '@/lib/gradara/inserter';
import AgentComposer, {
  type ComposerContext,
} from '@/components/gradara/agent-composer';
import BlockDialog, {
  type BlockDialogTab,
} from '@/components/gradara/block-dialog';
import ParameterList from '@/components/gradara/parameter-list';
import ExportDialog from '@/components/gradara/export-dialog';
import VariantPanel from '@/components/gradara/variant-panel';
import { BusSignalsPanel } from '@/components/gradara/bus-signals-panel';
import { isBusBlock, propagateBuses } from '@/lib/gradara/buses';
import { useVariantChecks } from '@/components/gradara/use-variant-checks';
import { SubsystemLookupContext } from '@/components/gradara/subsystem-preview';
import ExplorerWorkspace, {
  type ExplorerTarget,
} from '@/components/gradara/model-explorer';
import { explorerIndex } from '@/lib/gradara/explorer';
import ConfigurationMenu from '@/components/gradara/configuration-menu';
import { mergeRuns, type ComparisonRun } from '@/lib/gradara/compare';
import {
  applyConfiguration,
  removeConfiguration,
  saveConfiguration,
  switchVariant,
  variantProblems,
} from '@/lib/gradara/variants';
import { VariantSwitchContext } from '@/components/gradara/variant-switch-context';
import SettingsDialog, {
  type SettingsTab,
} from '@/components/gradara/settings-dialog';
import {
  library,
  domainColors,
  type Project,
  type Definition,
  type SubsystemDefinition,
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
  JobFailure,
  type Diagnostic,
  type RunFailure,
  type SimulationResult,
  type Job,
} from '@/lib/gradara/api';
import {
  countBySeverity,
  validateProject,
} from '@/lib/gradara/validate-project';
import DiagnosticsDock, {
  useDockState,
} from '@/components/gradara/diagnostics-dock';
import ProblemsPanel, {
  type ProblemSection,
} from '@/components/gradara/problems-panel';
import AssistantPanel, {
  useAssistant,
  type Revision,
} from '@/components/gradara/assistant-panel';
import { mergeProposal, type EditProposal } from '@/lib/gradara/proposal';
import {
  findSubsystem,
  groupIntoSubsystem,
  isBoundary,
  makeUnique,
  scopeView,
  ungroupSubsystem,
  usageCount,
  subsystemClosure,
  refsOf,
  syncInstances,
  validPath,
  withPastedSubsystems,
  writeScope,
  subsystemAt,
  promoteParameter,
  demoteParameter,
  promotedTargets,
} from '@/lib/gradara/hierarchy';
import { useAiLabel } from '@/lib/gradara/ai';
import UpdateIndicator from '@/components/gradara/update-indicator';
import {
  semanticSignature,
  setLabelOffset,
  addWire,
  removeSelection,
  replaceDefinition,
  applyBlockEdits,
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
  const { entries: generatedEntries } = useGeneratedLibrary();
  // The saved document, and the sheet being edited: the top level or the inside of a subsystem.
  const [doc, setDoc] = useState<Project>(blankProject);
  const docRef = useRef(doc);
  docRef.current = doc;
  const [scope, setScopeState] = useState<string[]>([]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const project = useMemo(() => scopeView(doc, scope), [doc, scope]);
  const currentSubsystem = useMemo(() => subsystemAt(doc, scope), [doc, scope]);
  const projectRef = useRef(project);
  projectRef.current = project;
  const setProject = useCallback((next: Project) => {
    docRef.current = next;
    projectRef.current = scopeView(next, scopeRef.current);
    setDoc(next);
  }, []);
  /** Open a sheet: [] is the top level, otherwise a path of subsystem instance IDs. */
  const enterScope = useCallback((path: string[], clear = true) => {
    scopeRef.current = path;
    projectRef.current = scopeView(docRef.current, path);
    setScopeState(path);
    if (clear) {
      setSelectedIds([]);
      setSelectedEdges([]);
      setSelectedJunctions([]);
    }
  }, []);
  /** Levels visited, for the hierarchy bar's back and forward buttons. */
  const [nav, setNav] = useState<{ back: string[][]; forward: string[][] }>({
    back: [],
    forward: [],
  });
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  }, [nav]);
  /** Go to another level; going up selects the subsystem you came out of, as in Simulink. */
  const navigate = useCallback(
    (path: string[], history: 'record' | 'back' | 'forward' = 'record') => {
      const current = scopeRef.current;
      if (
        path.length === current.length &&
        path.every((id, i) => id === current[i])
      )
        return;
      const { back, forward } = navRef.current;
      const next =
        history === 'back'
          ? { back: back.slice(0, -1), forward: [current, ...forward] }
          : history === 'forward'
            ? { back: [...back, current], forward: forward.slice(1) }
            : { back: [...back.slice(-49), current], forward: [] };
      navRef.current = next;
      setNav(next);
      enterScope(path);
      const upward =
        path.length < current.length &&
        path.every((id, i) => id === current[i]);
      if (upward) setSelectedIds([current[path.length]]);
    },
    [enterScope],
  );
  const goBack = useCallback(() => {
    const target = navRef.current.back.at(-1);
    if (target) navigate(validPath(docRef.current, target), 'back');
  }, [navigate]);
  const goForward = useCallback(() => {
    const target = navRef.current.forward[0];
    if (target) navigate(validPath(docRef.current, target), 'forward');
  }, [navigate]);
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
  const [health, setHealth] = useState<{
    engineReady: boolean;
    agentReady: boolean;
    engine: string;
    provider?: string;
    version?: string;
    projectDirectory?: string;
  }>({
    engineReady: false,
    agentReady: false,
    engine: 'OpenModelica 1.27.0',
  });
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [history, setHistory] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const [canvasTool, setCanvasTool] = useState<'select' | 'pan'>('select');
  const [composer, setComposer] = useState<ComposerContext | null>(null);
  const [inserter, setInserter] = useState<InsertContext | null>(null);
  /** The subsystem port whose properties dialog is open. */
  const [portDialog, setPortDialog] = useState<string | null>(null);
  const [equationBlock, setEquationBlock] = useState<{
    id: string;
    tab: BlockDialogTab;
  } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [libraryOpen, updateLibraryOpen] = useState(true);
  const [inspectorOpen, updateInspectorOpen] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState<
    'diagram' | 'results' | 'explorer'
  >('diagram');
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
  // Side panel widths, remembered per browser; the canvas takes the rest.
  const sidePanes = useColumns('workbench', [272, 270], 180);
  const { attach: attachTree, ...treePane } = useSize('inspector-tree', 200, 80);
  const sideStart = useRef<number[]>([]);
  const [widePanes, setWidePanes] = useState(true);
  useEffect(() => {
    // Below 1100 px the panels take turns, and their widths come from the stylesheet.
    const query = window.matchMedia('(min-width: 1101px)');
    const sync = () => setWidePanes(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const resizeSide = (index: 0 | 1, delta: number, start: boolean) => {
    if (start) sideStart.current = [...sidePanes.current.current];
    const other = sideStart.current[1 - index];
    const widest = Math.max(180, window.innerWidth - other - 360);
    const [low, high] = index ? [220, 560] : [180, 520];
    sidePanes.resize(
      index,
      Math.min(
        high,
        widest,
        Math.max(low, sideStart.current[index] + (index ? -delta : delta)),
      ),
    );
  };
  useEffect(() => {
    const reset = () => {
      updateLibraryOpen(true);
      updateInspectorOpen(window.innerWidth >= 1100);
    };
    window.addEventListener(RESET_LAYOUT_EVENT, reset);
    return () => window.removeEventListener(RESET_LAYOUT_EVENT, reset);
  }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  // The block reference page (Help), for a library entry or a placed block.
  const [helpDefinition, setHelpDefinition] = useState<Definition | null>(null);
  const openBlockHelp = useCallback(() => {
    const ids = selectionRef.current.blockIds;
    const block =
      ids.length === 1
        ? projectRef.current.blocks.find((b) => b.id === ids[0])
        : undefined;
    if (block) setHelpDefinition(block.definition);
  }, []);
  /** The canvas right-click menu: where it opened, on screen and on the sheet. */
  // The visible sheet grid is a personal view preference, kept per browser.
  const [gridSetting, writeGridSetting] = useStored(GRID_VISIBLE_KEY);
  const showGrid = gridSetting === '1';
  const showGridRef = useRef(showGrid);
  useEffect(() => {
    showGridRef.current = showGrid;
  }, [showGrid]);
  const toggleGrid = useCallback(
    () => writeGridSetting(showGridRef.current ? '0' : '1'),
    [writeGridSetting],
  );
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<{
    at: { x: number; y: number };
    point: { x: number; y: number };
    bounds: { width: number; height: number };
    /** Built when the menu opens, from the selection and clipboard at that moment. */
    items: CanvasMenuItem[];
  } | null>(null);
  const [running, setRunning] = useState(false);
  // How far the running simulation has got (components/gradara/run-progress.tsx).
  const [runTrack, setRunTrack] = useState<RunTrack | null>(null);
  const followRun = useCallback(
    (_message: string, job: Job<SimulationResult>) => {
      const stage = job.stage;
      if (stage) setRunTrack((t) => (t ? advance(t, stage) : t));
    },
    [],
  );
  // Stop-time fields whose text is not a usable value (B01): the toolbar's and
  // the model inspector's. While any is set, Run is held and the field explains.
  const [badStopTime, setBadStopTime] = useState<{ toolbar?: boolean; inspector?: boolean }>({});
  const stopTimeInvalid = !!(badStopTime.toolbar || badStopTime.inspector);
  const stopTimeRefs = useRef<{ toolbar: HTMLInputElement | null; inspector: HTMLInputElement | null }>({ toolbar: null, inspector: null });
  const STOP_TIME_MESSAGE = `Stop time must be a number ${rangeText(STOP_TIME.min, STOP_TIME.max)} seconds.`;
  // The Simulation settings in the inspector: a field holds text that is not a value, or the values cannot run.
  const [settingsInvalid, setSettingsInvalid] = useState(false);
  const SETTINGS_MESSAGE = 'Fix the simulation settings in the model inspector before running.';
  // The simulation settings guide, open at a symptom when a problem points there.
  const [solverHelp, setSolverHelp] = useState<{ topic?: string } | null>(null);
  const [runError, setRunError] = useState('');
  const [runFailure, setRunFailure] = useState<RunFailure | null>(null);
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
  const [importError, setImportError] = useState<ImportError | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const notify = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 5500);
  }, []);
  const commit = useCallback(
    (
      update: Project | ((p: Project) => Project),
      options?: { mergeHistory?: boolean },
    ) => {
      if (switchingRef.current) return;
      const previous = projectRef.current;
      const next = normalizeProject(
        typeof update === 'function' ? update(previous) : update,
        previous,
      );
      if (next === previous) return;
      const previousDoc = docRef.current;
      if (!options?.mergeHistory)
        setHistory((h) => [...h.slice(-49), structuredClone(previousDoc)]);
      setFuture([]);
      const written = writeScope(previousDoc, scopeRef.current, next);
      const changed = { ...written, revision: previousDoc.revision + 1 };
      docRef.current = changed;
      projectRef.current = scopeView(changed, scopeRef.current);
      setDoc(changed);
    },
    [],
  );
  /** A document-wide edit (configurations, variants on other sheets) as one undo step. */
  const commitDoc = useCallback((update: (doc: Project) => Project) => {
    if (switchingRef.current) return;
    const previousDoc = docRef.current;
    const next = update(previousDoc);
    if (next === previousDoc) return;
    setHistory((h) => [...h.slice(-49), structuredClone(previousDoc)]);
    setFuture([]);
    const changed = {
      ...syncInstances(next),
      revision: previousDoc.revision + 1,
    };
    docRef.current = changed;
    projectRef.current = scopeView(changed, scopeRef.current);
    setDoc(changed);
  }, []);
  const [searchSignal, setSearchSignal] = useState(0);
  const lookupSubsystem = useCallback(
    (ref: string) => findSubsystem(doc, ref),
    [doc],
  );
  const switchVariantOnSheet = useCallback(
    (blockId: string, variantId: string) =>
      commit((p) => switchVariant(p, blockId, variantId)),
    [commit],
  );
  const undo = useCallback(() => {
    if (!history.length) return;
    const previous = history[history.length - 1];
    const current = structuredClone(docRef.current);
    setFuture((f) => [...f, current]);
    setHistory((h) => h.slice(0, -1));
    const restored = { ...previous, revision: docRef.current.revision + 1 };
    enterScope(validPath(restored, scopeRef.current), false);
    setProject(restored);
  }, [history]);
  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[future.length - 1];
    const current = structuredClone(docRef.current);
    setHistory((h) => [...h, current]);
    setFuture((f) => f.slice(0, -1));
    const restored = { ...next, revision: docRef.current.revision + 1 };
    enterScope(validPath(restored, scopeRef.current), false);
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
  const signature = useMemo(() => semanticSignature(doc), [doc]);
  const [dock, updateDock] = useDockState();
  const [liveProblems, setLiveProblems] = useState<Diagnostic[]>([]);
  useEffect(() => {
    // Recheck after edits settle, not on every pointer move.
    const timer = setTimeout(
      () =>
        setLiveProblems([
          ...validateProject(projectRef.current),
          // Every variant, active or not, so a broken alternative shows before anyone switches to it.
          ...variantProblems(docRef.current),
        ]),
      300,
    );
    return () => clearTimeout(timer);
  }, [signature, scope]);
  const variantChecks = useVariantChecks({
    doc,
    signature,
    engineReady: health.engineReady,
    busy: running,
  });
  const problemSections = useMemo<ProblemSection[]>(() => {
    const sections: ProblemSection[] = [
      { id: 'live', title: 'Model checks', items: liveProblems },
    ];
    if (runFailure && runFailure.modelId === project.modelId) {
      const stale = runFailure.signature !== signature;
      const live = new Set(liveProblems.map((d) => d.message));
      const items = runFailure.diagnostics.length
        ? runFailure.diagnostics.filter(
            (d) => !(d.source === 'validation' && live.has(d.message)),
          )
        : [
            {
              id: 'run',
              severity: 'error' as const,
              source: 'runtime' as const,
              message: runFailure.message.split('\n')[0],
              detail: runFailure.message,
              blockIds: [],
              ports: [],
              netIds: [],
              wireIds: [],
            },
          ];
      sections.push({
        id: 'run',
        title: 'Last run',
        note: stale
          ? 'stale · model changed since this run'
          : 'from the last run',
        stale,
        items,
      });
    }
    if (result?.problems?.length) {
      const stale = signature !== resultSignature;
      sections.push({
        id: 'warnings',
        title: 'Run warnings',
        note: stale ? 'stale · model changed since this run' : undefined,
        stale,
        items: result.problems,
      });
    }
    if (variantChecks.problems.length)
      sections.push({
        id: 'variants',
        title: 'Inactive variants',
        note: 'compiled in the background',
        items: variantChecks.problems,
      });
    return sections;
  }, [
    variantChecks.problems,
    liveProblems,
    runFailure,
    result,
    signature,
    resultSignature,
    project.modelId,
  ]);
  const problemCounts = useMemo(
    () =>
      countBySeverity(
        problemSections.filter((s) => !s.stale).flatMap((s) => s.items),
      ),
    [problemSections],
  );
  /** Open a place the Explorer points at: its sheet in the Diagram, then the block or net. */
  const revealTarget = (target: ExplorerTarget) => {
    const sheet = explorerIndex(docRef.current).sheets.find(
      (s) => s.id === target.sheetId,
    );
    if (!sheet?.path) {
      notify('That inside belongs to an inactive variant. Switch to it first.');
      return;
    }
    navigate(sheet.path);
    setWorkspaceMode('diagram');
    setTimeout(() => {
      if (target.blockId) selectBlocks([target.blockId]);
      else if (target.netId) focusNet(target.netId);
    }, 60);
  };
  const selectProblem = (d: Diagnostic, only?: string[]) =>
    selectBlocks(only ?? d.blockIds, only ? [] : d.wireIds);
  const selectBlocks = (ids: string[], wires: string[] = []) => {
    const current = projectRef.current;
    const blockIds = ids.filter((id) =>
      current.blocks.some((b) => b.id === id),
    );
    const wireIds = wires.filter((id) =>
      current.wires.some((w) => w.id === id),
    );
    if (!blockIds.length && !wireIds.length) return;
    if (workspaceMode !== 'diagram') setWorkspaceMode('diagram');
    select({ ...emptySelection(), blockIds, wireIds });
    if (blockIds.length)
      requestAnimationFrame(() => {
        void flow.fitView({
          nodes: blockIds.map((id) => ({ id })),
          padding: 0.6,
          maxZoom: 1.5,
          duration: 250,
        });
      });
  };
  const copyProblems = () => {
    const text = problemSections
      .filter((s) => s.items.length)
      .map(
        (s) =>
          `${s.title}${s.note ? ` (${s.note})` : ''}\n` +
          s.items
            .map(
              (d) =>
                `- [${d.severity}] ${d.message}${d.hint ? `\n  Hint: ${d.hint}` : ''}`,
            )
            .join('\n'),
      )
      .join('\n\n');
    void navigator.clipboard
      .writeText(text || 'No problems.')
      .then(() => notify('Problems copied.'));
  };
  const getProject = useCallback(() => projectRef.current, []);
  const assistant = useAssistant(project.modelId, getProject);
  const requestEdit = (
    prompt: string,
    blockIds: string[],
    revision?: Revision,
  ) => {
    if (scopeRef.current.length) {
      notify(
        'The assistant edits the top level for now. Press ⌘↑ to go up, then ask again.',
      );
      return;
    }
    const current = projectRef.current;
    const names = blockIds
      .map((id) => current.blocks.find((b) => b.id === id)?.definition.name)
      .filter(Boolean);
    const scope = names.length
      ? `Selection · ${names.join(', ')}`
      : 'Whole model';
    void assistant.edit(
      prompt,
      { project: current, catalog: library, selection: blockIds },
      revision ? `Revision · ${scope}` : scope,
      revision,
    );
  };
  const explainLabel = useAiLabel('diagnose');
  const fixLabel = useAiLabel('fix');
  const askableProblems = problemSections
    .filter((s) => !s.stale)
    .flatMap((s) => s.items)
    .filter((d) => d.severity !== 'info');
  const askAi = (diagnostics: Diagnostic[], proposeFix: boolean) => {
    if (!diagnostics.length || assistant.busy) return;
    if (scopeRef.current.length) {
      notify(
        'The assistant works on the top level for now. Press ⌘↑ to go up, then ask again.',
      );
      return;
    }
    const current = projectRef.current;
    const runId =
      runFailure &&
      runFailure.modelId === current.modelId &&
      runFailure.signature === semanticSignature(current)
        ? runFailure.runId
        : undefined;
    updateDock({ open: true, tab: 'assistant' });
    void assistant.diagnose(
      {
        project: current,
        diagnostics: diagnostics.slice(0, 50),
        runId,
        catalog: library,
        proposeFix,
      },
      diagnostics.length === 1
        ? `${proposeFix ? 'Fix' : 'Explain'}: ${diagnostics[0].message}`
        : proposeFix
          ? `Fix ${diagnostics.length} problems`
          : `Explain ${diagnostics.length} problems`,
      proposeFix ? 'Fix with AI' : 'Explain',
    );
  };
  const applyProposal = (proposal: EditProposal, baseRevision: number) => {
    const current = projectRef.current;
    if (current.revision !== baseRevision) {
      notify('The model changed since this proposal. Ask again.');
      return false;
    }
    const {
      project: next,
      added,
      changed,
    } = mergeProposal(current, proposal.project);
    commit(next);
    const touched = [...added, ...changed].filter((id) =>
      projectRef.current.blocks.some((b) => b.id === id),
    );
    if (touched.length) select({ ...emptySelection(), blockIds: touched });
    notify(
      `Applied ${proposal.changes.length} ${proposal.changes.length === 1 ? 'change' : 'changes'}. Undo with ⌘Z.`,
    );
    return true;
  };
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
    // Bus widths are derived: bring them up to date with the wiring on load.
    return propagateBuses(normalizeProject(next));
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
        enterScope([]);
        setNav({ back: [], forward: [] });
        setProject(next);
        setReady(true);
        const latest = await api<{ result: SimulationResult | null }>(
          `/results/latest?model=${next.modelId}`,
        ).catch(() => ({ result: null }));
        if (
          !disposed &&
          docRef.current.modelId === next.modelId &&
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
          if (alive) {
            setHealth(h);
            setHealthChecked(true);
          }
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
  const refreshHealth = useCallback(() => {
    api<typeof health>('/health')
      .then(setHealth)
      .catch(() => {});
  }, []);
  // First run: open engine setup once per session when simulation is not ready.
  useEffect(() => {
    if (!healthChecked || health.engineReady) return;
    try {
      if (sessionStorage.getItem('gradara.setupShown')) return;
      sessionStorage.setItem('gradara.setupShown', '1');
    } catch {
      /* storage unavailable: still show setup once */
    }
    setSettingsTab('engine');
  }, [healthChecked, health.engineReady]);
  const saveCurrent = async () => {
    const snapshot = docRef.current;
    setSaving('Saving');
    try {
      await persistProject(JSON.stringify(snapshot));
      if (docRef.current.modelId === snapshot.modelId) {
        setSaveError('');
        setSaving(store.isSaved(docRef.current) ? 'Saved' : 'Unsaved changes');
      }
    } catch (e) {
      if (docRef.current.modelId === snapshot.modelId) {
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
    if (store.isSaved(doc)) {
      setSaving('Saved');
      return;
    }
    setSaving('Unsaved changes');
    try {
      sessionStorage.setItem(
        draftKey(doc.modelId!),
        JSON.stringify(store.draft(doc)),
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
  }, [doc, ready, switching, store]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (ready && !store.isSaved(docRef.current)) {
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
    enterScope([]);
    setNav({ back: [], forward: [] });
    setProject(next);
    setHistory([]);
    setFuture([]);
    select(emptySelection());
    setComposer(null);
    setInserter(null);
    setEquationBlock(null);
    setInspectorOpen(false);
    setRunError('');
    setRunFailure(null);
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
      showNewSheet();
    } finally {
      endTransition();
    }
  };
  // A model the user has not seen yet (new, an example's copy, an import) opens
  // on its diagram, fitted, whatever view was showing; a saved model reopens
  // wherever it was left.
  const showNewSheet = () => {
    setWorkspaceMode('diagram');
    setTimeout(() => window.dispatchEvent(new Event(FIT_VIEW_EVENT)), 80);
  };
  // Help → Open example: a copy of the example in My models, with the block selected.
  const openExampleRef = useRef<(detail: OpenExampleDetail) => Promise<void>>(
    async () => {},
  );
  openExampleRef.current = async ({ template, title, kind }) => {
    await createModel(`Example: ${title}`, template as TemplateId);
    const ids = projectRef.current.blocks
      .filter((b) => b.definition.kind === kind)
      .map((b) => b.id);
    if (ids.length) selectBlocks(ids);
    setLibraryOpen(false);
  };
  useEffect(() => {
    const open = (event: Event) =>
      void openExampleRef
        .current((event as CustomEvent<OpenExampleDetail>).detail)
        .catch((e) => notify((e as Error).message));
    window.addEventListener(OPEN_EXAMPLE_EVENT, open);
    return () => window.removeEventListener(OPEN_EXAMPLE_EVENT, open);
  }, []);
  const insertGeneratedModel = async (generated: Project) => {
    if (!beginTransition())
      throw new Error('Wait for the current operation to finish.');
    try {
      await saveCurrent();
      const saved = await api<SavedDocument>('/models/copy', {
        method: 'POST',
        body: JSON.stringify({ name: generated.name, project: generated }),
      });
      activateModel(restoreDocument(saved, false));
      setBrowserSection(null);
      notify(
        'Generated model saved. Run it to view its results in Data Inspector.',
      );
    } finally {
      endTransition();
    }
  };
  const openBrowser = async (section: BrowserSection) => {
    await saveCurrent().catch(() => {});
    setBrowserSection(section);
  };
  const openModel = async (id: string) => {
    if (id === docRef.current.modelId) return;
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
      if (docRef.current.modelId === next.modelId) {
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
      const originalId = docRef.current.modelId!;
      const copied = await api<SavedDocument>('/models/copy', {
        method: 'POST',
        body: JSON.stringify({ name, project: docRef.current }),
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
      const id = docRef.current.modelId!;
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
    (layouts: BlockLayout[], options?: { free?: boolean }) => {
      // A drag with Alt held places blocks exactly where they were dropped (on the grid).
      commit((p) =>
        layoutSelection(p, layouts, selectionRef.current, !options?.free),
      );
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
      if (definition.boundary && !scopeRef.current.length) {
        notify(
          'Subsystem ports go inside a subsystem. Open one, or select blocks and press ⌘G.',
        );
        return;
      }
      if (definition.boundary) {
        // Dropped from a wire, the port becomes the type that wire needs.
        if (connection)
          definition = boundaryFor(
            portOf(projectRef.current, connection.blockId, connection.portId),
            definition,
          );
        // A new port goes after the existing ones, named in1, out2, terminal1, …
        const pills = projectRef.current.blocks.filter(isBoundary);
        const names = new Set(pills.map((b) => b.definition.name));
        const base =
          definition.kind === 'inport'
            ? 'in'
            : definition.kind === 'outport'
              ? 'out'
              : 'terminal';
        let n =
          pills.filter((b) => b.definition.kind === definition.kind).length + 1;
        while (names.has(`${base}${n}`)) n++;
        definition = {
          ...definition,
          name: `${base}${n}`,
          ports: definition.ports.map((p) => ({ ...p, name: `${base}${n}` })),
          boundary: { ...definition.boundary, order: Number.MAX_SAFE_INTEGER },
        };
      }
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
    [commit, newPosition, selectedIds, notify],
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
  /**
   * Redraw the selection (two or more blocks) or the whole sheet in house style, but only
   * when that reads better; otherwise say the drawing is already as clean as it gets.
   */
  const arrange = useCallback(() => {
    const picked = selectionRef.current.blockIds;
    const ids = picked.length > 1 ? picked : [];
    if (!projectRef.current.blocks.length) return;
    const result = arrangeIfBetter(projectRef.current, ids);
    if (!result.improved) {
      notify(
        ids.length
          ? 'These blocks are already arranged as cleanly as Arrange can make them.'
          : 'This layout is already as clean as Arrange can make it.',
      );
      return;
    }
    commit(result.project);
    notify(
      ids.length
        ? `Arranged ${ids.length} blocks.`
        : 'Arranged the sheet. Undo restores the previous drawing.',
    );
    if (!ids.length)
      requestAnimationFrame(() =>
        window.dispatchEvent(new Event(FIT_VIEW_EVENT)),
      );
  }, [commit, notify]);
  /**
   * The canvas right-click menu. What is selected comes first, then what can be done
   * at the pointer, then the sheet and the model. Add new canvas commands here.
   */
  const canvasMenuItems = (menu: {
    at: { x: number; y: number };
    point: { x: number; y: number };
  }): CanvasMenuItem[] => {
    const blocks = selectionRef.current.blockIds;
    const anything =
      blocks.length > 0 ||
      selectionRef.current.wireIds.length > 0 ||
      selectionRef.current.junctionIds.length > 0;
    const subsystems = blocks.filter((id) =>
      projectRef.current.blocks.some(
        (b) => b.id === id && b.definition.subsystem,
      ),
    );
    const items: CanvasMenuItem[] = [];
    const picked = projectRef.current.blocks.filter((b) =>
      blocks.includes(b.id),
    );
    const canTerminate = picked.some(
      (b) =>
        openOutputs(projectRef.current, b).filter(
          (id) => !b.terminated?.includes(id),
        ).length > 0,
    );
    const terminated = picked.some((b) => b.terminated?.length);
    if (anything) {
      items.push(
        {
          id: 'selection',
          heading: blocks.length
            ? `${blocks.length} block${blocks.length === 1 ? '' : 's'} selected`
            : 'Selection',
        },
        {
          id: 'cut',
          label: 'Cut',
          icon: <Scissors size={13} />,
          shortcut: '⌘X',
          disabled: !blocks.length,
          run: () => copySelection(true),
        },
        {
          id: 'copy',
          label: 'Copy',
          icon: <Copy size={13} />,
          shortcut: '⌘C',
          disabled: !blocks.length,
          run: () => copySelection(false),
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          icon: <CopyPlus size={13} />,
          shortcut: '⌘D',
          disabled: !blocks.length,
          run: () => duplicate(),
        },
        {
          id: 'rotate',
          label: 'Rotate',
          icon: <RotateCw size={13} />,
          shortcut: 'R',
          disabled: !blocks.length,
          run: () =>
            commit((p) => rotateBlocks(p, selectionRef.current.blockIds)),
        },
        {
          id: 'terminate',
          label: 'Terminate unused outputs',
          icon: <Unplug size={13} />,
          disabled: !canTerminate,
          hint: 'No unconnected outputs in the selection',
          run: () =>
            commit((p) =>
              terminateOpenOutputs(p, selectionRef.current.blockIds),
            ),
        },
        ...(terminated
          ? [
              {
                id: 'unterminate',
                label: 'Remove terminators',
                icon: <Unplug size={13} />,
                run: () =>
                  commit((p) =>
                    removeTerminators(p, selectionRef.current.blockIds),
                  ),
              },
            ]
          : []),
        {
          id: 'help',
          label: 'Help',
          icon: <CircleHelp size={13} />,
          shortcut: 'F1',
          disabled: blocks.length !== 1,
          run: openBlockHelp,
        },
        {
          id: 'group',
          label: 'Make subsystem',
          icon: <Group size={13} />,
          shortcut: '⌘G',
          disabled: !blocks.length,
          run: () => groupSelected(),
        },
        ...(subsystems.length
          ? [
              {
                id: 'ungroup',
                label: 'Ungroup subsystem',
                icon: <Ungroup size={13} />,
                shortcut: '⌘⇧G',
                run: () => ungroupSelected(),
              },
            ]
          : []),
        {
          id: 'arrange-selection',
          label: 'Arrange selection',
          icon: <LayoutGrid size={13} />,
          disabled: blocks.length < 2,
          hint: 'Select two or more blocks',
          run: arrange,
        },
        {
          id: 'delete',
          label: 'Delete',
          icon: <Trash2 size={13} />,
          shortcut: '⌫',
          run: () => deleteSelected(),
        },
        { id: 'sep-selection', separator: true },
      );
    }
    const bounds = canvasRef.current?.getBoundingClientRect();
    items.push(
      { id: 'here', heading: 'Here' },
      {
        id: 'add',
        label: 'Add block…',
        icon: <Plus size={13} />,
        shortcut: 'Double-click',
        run: () =>
          setInserter({
            position: menu.point,
            screen: clampPopoverPosition(menu.at, {
              width: bounds?.width ?? 400,
              height: bounds?.height ?? 300,
            }),
          }),
      },
      {
        id: 'agent',
        label: 'Ask the agent to build here…',
        icon: <Sparkles size={13} />,
        shortcut: 'A',
        run: () => setComposer({ position: menu.point }),
      },
      {
        id: 'paste',
        label: 'Paste here',
        icon: <ClipboardPaste size={13} />,
        shortcut: '⌘V',
        disabled: !clipboard.current?.blocks.length,
        hint: 'Copy or cut blocks first',
        run: () => pasteAt(menu.point),
      },
      // Notes belong to the top-level sheet.
      ...(scopeRef.current.length
        ? []
        : [
            {
              id: 'note',
              label: 'Add note here',
              icon: <StickyNote size={13} />,
              run: () => {
                const index = projectRef.current.annotations?.length ?? 0;
                commit((p) => ({
                  ...p,
                  annotations: [
                    ...(p.annotations ?? []),
                    {
                      x: snapGrid(menu.point.x),
                      y: snapGrid(menu.point.y),
                      text: 'Note',
                      detail: '',
                    },
                  ],
                }));
                setEditingNote(index);
              },
            } satisfies CanvasMenuItem,
          ]),
      // Inside a subsystem, an input or output pill can go where you clicked; its
      // Type in the inspector sets what it carries.
      ...(scopeRef.current.length
        ? (['inport', 'outport'] as const).map((kind): CanvasMenuItem => ({
            id: `port-${kind}`,
            label:
              kind === 'inport'
                ? 'Add input port here'
                : 'Add output port here',
            icon:
              kind === 'inport' ? <LogIn size={13} /> : <LogOut size={13} />,
            run: () => {
              const id = `p_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
              commit((p) => addPort(p, { kind, position: menu.point }, id));
              select({ ...emptySelection(), blockIds: [id] });
            },
          }))
        : []),
      { id: 'sep-here', separator: true },
      { id: 'sheet', heading: 'Sheet' },
      {
        id: 'select-all',
        label: 'Select all',
        icon: <SquareDashedMousePointer size={13} />,
        shortcut: '⌘A',
        disabled: !projectRef.current.blocks.length,
        run: () =>
          select({
            blockIds: projectRef.current.blocks.map((b) => b.id),
            wireIds: projectRef.current.wires.map((w) => w.id),
            junctionIds: (projectRef.current.junctions ?? []).map((j) => j.id),
          }),
      },
      {
        id: 'arrange',
        label: 'Arrange sheet',
        icon: <LayoutGrid size={13} />,
        shortcut: '⌘⇧A',
        disabled: !projectRef.current.blocks.length,
        run: () => {
          select(emptySelection());
          selectionRef.current = emptySelection();
          arrange();
        },
      },
      {
        id: 'fit',
        label: 'Fit to view',
        icon: <Maximize size={13} />,
        shortcut: 'Space',
        run: () => window.dispatchEvent(new Event(FIT_VIEW_EVENT)),
      },
      {
        id: 'grid',
        label: showGridRef.current ? 'Hide grid' : 'Show grid',
        icon: <Grid3x3 size={13} />,
        shortcut: "⌘'",
        run: toggleGrid,
      },
      {
        id: 'reset-layout',
        label: 'Reset layout',
        icon: <PanelsTopLeft size={13} />,
        run: resetLayout,
      },
      ...(scopeRef.current.length
        ? [
            {
              id: 'leave',
              label: 'Leave subsystem',
              icon: <CornerLeftUp size={13} />,
              shortcut: '⌘↑',
              run: () => void leaveSubsystem(),
            },
          ]
        : []),
      { id: 'sep-sheet', separator: true },
      { id: 'model', heading: 'Model' },
      {
        id: 'run',
        label: running ? 'Running…' : 'Run simulation',
        icon: <Play size={13} />,
        shortcut: '⌘↵',
        disabled: running || !ready || switching,
        run: () => void runRef.current(),
      },
      {
        id: 'export',
        label: 'Export…',
        icon: <ArrowUpRight size={13} />,
        run: () => setExportOpen(true),
      },
      {
        id: 'solver-help',
        label: 'Simulation settings guide',
        icon: <CircleHelp size={13} />,
        run: () => setSolverHelp({}),
      },
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        icon: <Keyboard size={13} />,
        shortcut: '?',
        run: () => setHelpOpen(true),
      },
    );
    return items;
  };
  const groupSelected = useCallback(() => {
    const ids = selectionRef.current.blockIds;
    if (!ids.length) {
      notify('Select the blocks to group into a subsystem.');
      return;
    }
    let created: string | undefined;
    commit((p) => {
      const grouped = groupIntoSubsystem(p, ids);
      if (!grouped) return p;
      created = grouped.instanceId;
      return grouped.project;
    });
    if (created) {
      select({ ...emptySelection(), blockIds: [created] });
      notify('Made a subsystem. Double-click it to open; ⌘⇧G ungroups.');
    }
  }, [commit, select, notify]);
  const ungroupSelected = useCallback(() => {
    const ids = selectionRef.current.blockIds.filter((id) =>
      projectRef.current.blocks.some(
        (b) => b.id === id && b.definition.subsystem,
      ),
    );
    if (!ids.length) return;
    let restored: string[] = [];
    commit((p) =>
      ids.reduce((next, id) => {
        const out = ungroupSubsystem(next, id);
        if (!out) return next;
        restored = [...restored, ...out.blockIds];
        return out.project;
      }, p),
    );
    select({ ...emptySelection(), blockIds: restored });
  }, [commit, select]);
  const openSubsystem = useCallback(
    (id: string) => {
      const block = projectRef.current.blocks.find((b) => b.id === id);
      if (!block?.definition.subsystem) return false;
      // The canvas fits each sheet as it opens.
      navigate([...scopeRef.current, id]);
      return true;
    },
    [navigate],
  );
  const leaveSubsystem = useCallback(() => {
    if (!scopeRef.current.length) return false;
    const from = scopeRef.current[scopeRef.current.length - 1];
    navigate(scopeRef.current.slice(0, -1));
    select({ ...emptySelection(), blockIds: [from] });
    return true;
  }, [navigate, select]);
  const copySelection = useCallback(
    (cut = false) => {
      const fragment = extractSelection(
        projectRef.current,
        selectionRef.current,
      );
      if (!fragment.blocks.length) return;
      // Subsystem definitions travel with their instances, so a copy pastes into another model.
      clipboard.current = {
        ...fragment,
        subsystems: subsystemClosure(
          docRef.current,
          fragment.blocks.flatMap((b) => refsOf(b.definition)),
        ),
      } as ModelFragment;
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
    const target = withPastedSubsystems(
      projectRef.current,
      scopeRef.current,
      clipboard.current as ModelFragment & {
        subsystems?: SubsystemDefinition[];
      },
    );
    if (target === 'recursive') {
      notify('A subsystem cannot be pasted inside itself.');
      return;
    }
    const result = pasteSelection(target, clipboard.current, {
      x: step,
      y: step,
    });
    commit(result.project);
    select(result.selection);
  }, [commit, select, notify]);
  /** Paste so the copied group's top-left corner lands at `point` on the sheet. */
  const pasteAt = useCallback(
    (point: { x: number; y: number }) => {
      const fragment = clipboard.current;
      if (!fragment?.blocks.length) return;
      const left = Math.min(...fragment.blocks.map((b) => b.position.x));
      const top = Math.min(...fragment.blocks.map((b) => b.position.y));
      const target = withPastedSubsystems(
        projectRef.current,
        scopeRef.current,
        fragment as ModelFragment & { subsystems?: SubsystemDefinition[] },
      );
      if (target === 'recursive') {
        notify('A subsystem cannot be pasted inside itself.');
        return;
      }
      const result = pasteSelection(target, fragment, {
        x: snapGrid(point.x - left),
        y: snapGrid(point.y - top),
      });
      commit(result.project);
      select(result.selection);
    },
    [commit, select, notify],
  );
  const startComposer = useCallback(
    () => setComposer({ position: newPosition() }),
    [newPosition],
  );
  async function runSimulation() {
    if (runController.current || switching || !ready) return;
    if (stopTimeInvalid) {
      notify(STOP_TIME_MESSAGE);
      (badStopTime.toolbar ? stopTimeRefs.current.toolbar : stopTimeRefs.current.inspector)?.focus();
      return;
    }
    if (settingsInvalid) {
      notify(SETTINGS_MESSAGE);
      return;
    }
    if (!docRef.current.blocks.length) {
      notify('Add a block from the library or ask the agent to create one.');
      return;
    }
    const controller = new AbortController();
    runController.current = controller;
    setRunning(true);
    setRunError('');
    setRunFailure(null);
    setResult(null);
    setResultSignature('');
    const snapshot = structuredClone(docRef.current);
    const currentSignature = semanticSignature(snapshot);
    setRunTrack(startTrack(snapshot.duration));
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
      const r = await waitForJob<SimulationResult>(job.id, controller.signal, followRun, 400);
      if (
        runController.current !== controller ||
        controller.signal.aborted ||
        docRef.current.modelId !== snapshot.modelId
      )
        return;
      setResult(r);
      setResultSignature(currentSignature);
      setWorkspaceMode('results');
    } catch (e) {
      if (
        runController.current === controller &&
        !controller.signal.aborted &&
        (e as Error).name !== 'AbortError'
      ) {
        setRunError((e as Error).message);
        if (e instanceof JobFailure)
          setRunFailure({
            runId: e.jobId,
            modelId: snapshot.modelId,
            signature: currentSignature,
            message: e.message,
            diagnostics: e.diagnostics,
          });
        updateDock({ open: true, tab: 'problems' });
      }
    } finally {
      if (runController.current === controller) {
        runController.current = null;
        setRunning(false);
        setRunTrack(null);
        runId.current = '';
      }
    }
  }
  /** Run every configuration in turn and overlay their results, labelled by configuration. */
  async function runAllConfigurations() {
    const configurations = docRef.current.configurations ?? [];
    if (
      runController.current ||
      switching ||
      !ready ||
      configurations.length < 2
    )
      return;
    if (stopTimeInvalid) {
      notify(STOP_TIME_MESSAGE);
      (badStopTime.toolbar ? stopTimeRefs.current.toolbar : stopTimeRefs.current.inspector)?.focus();
      return;
    }
    if (settingsInvalid) {
      notify(SETTINGS_MESSAGE);
      return;
    }
    const controller = new AbortController();
    runController.current = controller;
    setRunning(true);
    setRunError('');
    setRunFailure(null);
    setResult(null);
    setResultSignature('');
    const base = structuredClone(docRef.current);
    const currentSignature = semanticSignature(base);
    const runs: ComparisonRun[] = [];
    let label = '';
    try {
      for (const [i, configuration] of configurations.entries()) {
        label = configuration.name;
        notify(`Running ${label} (${i + 1} of ${configurations.length})…`);
        const snapshot = applyConfiguration(base, configuration);
        setRunTrack(startTrack(snapshot.duration, `${label} · ${i + 1} of ${configurations.length}`));
        const job = await api<Job<SimulationResult>>('/runs', {
          method: 'POST',
          body: JSON.stringify(snapshot),
        });
        if (controller.signal.aborted) {
          await api(`/jobs/${job.id}`, { method: 'DELETE' });
          return;
        }
        runId.current = job.id;
        await waitForJob<SimulationResult>(job.id, controller.signal, followRun, 400);
        const full = await api<SimulationResult>(`/results/${job.id}/data`, {
          signal: controller.signal,
        });
        runs.push({ name: configuration.name, result: full });
      }
      if (
        runController.current !== controller ||
        controller.signal.aborted ||
        docRef.current.modelId !== base.modelId
      )
        return;
      setResult(mergeRuns(runs));
      setResultSignature(currentSignature);
      setWorkspaceMode('results');
    } catch (e) {
      if (
        runController.current === controller &&
        !controller.signal.aborted &&
        (e as Error).name !== 'AbortError'
      ) {
        setRunError(`${label}: ${(e as Error).message}`);
        if (e instanceof JobFailure)
          setRunFailure({
            runId: e.jobId,
            modelId: base.modelId,
            signature: currentSignature,
            message: `${label}: ${e.message}`,
            diagnostics: e.diagnostics,
          });
        updateDock({ open: true, tab: 'problems' });
      }
    } finally {
      if (runController.current === controller) {
        runController.current = null;
        setRunning(false);
        setRunTrack(null);
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
    setRunTrack(null);
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
  // Capture before React Flow's own arrow handler, so a selection moves exactly once.
  useEffect(() => {
    let held: string | null = null;
    let pointerDown = false;
    const directions: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const keydown = (event: KeyboardEvent) => {
      const direction = directions[event.key];
      if (!direction) {
        held = null;
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const editing = target?.closest(
        'input,textarea,select,[contenteditable=true],.monaco-editor,[role=dialog],[role=menu],[role=listbox],.library-panel,.data-inspector,.model-toolbar',
      );
      const otherButton =
        target?.closest('button') &&
        !target.closest('.explorer-row,.explorer-root,.react-flow__node');
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        workspaceMode !== 'diagram' ||
        composer ||
        inserter ||
        pointerDown ||
        editing ||
        otherButton ||
        document.querySelector('[role=dialog],.net-live')
      ) {
        held = null;
        return;
      }
      const selection = selectionRef.current;
      if (
        !selection.blockIds.length &&
        !selection.wireIds.length &&
        !selection.junctionIds.length
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const signature = JSON.stringify([
        projectRef.current.modelId,
        selection,
        event.key,
        event.shiftKey,
      ]);
      const mergeHistory = event.repeat && held === signature;
      held = signature;
      // One grid step, or five with Shift: a nudge keeps the selection on the grid.
      const step = event.shiftKey ? 5 * GRID : GRID;
      commit(
        (project) =>
          translateSelection(project, selection, {
            x: direction.x * step,
            y: direction.y * step,
          }),
        { mergeHistory },
      );
    };
    const release = () => {
      held = null;
    };
    const down = () => {
      pointerDown = true;
      release();
    };
    const up = () => {
      pointerDown = false;
    };
    const blur = () => {
      pointerDown = false;
      release();
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', release);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', release);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', blur);
    };
  }, [commit, workspaceMode, composer, inserter]);
  const runRef = useRef(runSimulation);
  runRef.current = runSimulation;
  const toggleDockRef = useRef(() => {});
  toggleDockRef.current = () => updateDock({ open: !dock.open });
  useEffect(() => {
    // A tap on Space fits the view (as in Simulink); holding Space and dragging still pans.
    let spaceDown = 0;
    let spacePanned = false;
    const spaceTarget = (t: EventTarget | null) =>
      !(t as HTMLElement)?.closest?.(
        'input,textarea,select,button,a,[contenteditable=true],.monaco-editor,[role=dialog]',
      );
    const spacePress = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || !spaceTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      spaceDown = performance.now();
      spacePanned = false;
    };
    const spacePointer = () => {
      if (spaceDown) spacePanned = true;
    };
    const spaceRelease = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceDown) return;
      const tap = performance.now() - spaceDown < 350 && !spacePanned;
      spaceDown = 0;
      if (tap && workspaceMode === 'diagram')
        window.dispatchEvent(new Event(FIT_VIEW_EVENT));
    };
    window.addEventListener('keydown', spacePress);
    window.addEventListener('keyup', spaceRelease);
    window.addEventListener('pointerdown', spacePointer);
    const key = (e: KeyboardEvent) => {
      const input = (e.target as HTMLElement)?.closest(
        'input,textarea,select,[contenteditable=true],.monaco-editor,[role=dialog]',
      );
      if (input || e.defaultPrevented) return;
      const command = e.metaKey || e.ctrlKey;
      if (command && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (command && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
      } else if (command && e.key === 'ArrowUp') {
        e.preventDefault();
        leaveSubsystem();
      } else if (command && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
      } else if (command && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        if (!e.repeat) arrange();
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
      } else if (command && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleDockRef.current();
      } else if (
        e.key.toLowerCase() === 'r' &&
        !command &&
        !e.altKey &&
        selectionRef.current.blockIds.length
      ) {
        e.preventDefault();
        if (!e.repeat)
          commit((p) => rotateBlocks(p, selectionRef.current.blockIds));
      } else if (e.key.toLowerCase() === 'a' && !command && !composer) {
        e.preventDefault();
        startComposer();
      } else if (e.key.toLowerCase() === 'v' && !command) {
        setCanvasTool('select');
      } else if (e.key.toLowerCase() === 'h' && !command) {
        setCanvasTool('pan');
      } else if (e.key.toLowerCase() === 'f' && !command) {
        e.preventDefault();
        window.dispatchEvent(new Event(FIT_VIEW_EVENT));
      } else if (e.key === 'F1') {
        e.preventDefault();
        openBlockHelp();
      } else if (e.key === "'" && command) {
        e.preventDefault();
        toggleGrid();
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
        const nothingSelected =
          !selectionRef.current.blockIds.length &&
          !selectionRef.current.wireIds.length &&
          !selectionRef.current.junctionIds.length;
        setComposer(null);
        setInserter(null);
        if (!(nothingSelected && !composer && !inserter && leaveSubsystem()))
          select(emptySelection());
      } else if (e.key === '1' && command) {
        e.preventDefault();
        setWorkspaceMode('diagram');
      } else if (e.key === '2' && command) {
        e.preventDefault();
        setWorkspaceMode('results');
      } else if (e.key === '3' && command) {
        e.preventDefault();
        setWorkspaceMode('explorer');
      } else if (e.key.toLowerCase() === 'k' && command) {
        e.preventDefault();
        setWorkspaceMode('explorer');
        setSearchSignal((n) => n + 1);
      } else if (e.key === '?' && !command) setHelpOpen(true);
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keydown', spacePress);
      window.removeEventListener('keyup', spaceRelease);
      window.removeEventListener('pointerdown', spacePointer);
    };
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
    groupSelected,
    arrange,
    ungroupSelected,
    leaveSubsystem,
    inserter,
    workspaceMode,
    toggleGrid,
    openBlockHelp,
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
    setImportError(null);
    let stage = 'read';
    try {
      const text = await file.text();
      stage = 'parse';
      const imported = JSON.parse(text) as Project;
      stage = 'check';
      await api('/source', { method: 'POST', body: JSON.stringify(imported) });
      stage = 'save';
      await saveCurrent();
      const copied = await api<SavedDocument>('/models/copy', {
        method: 'POST',
        body: JSON.stringify({ name: imported.name, project: imported }),
      });
      activateModel(restoreDocument(copied, false));
      setBrowserSection(null);
      showNewSheet();
      notify(`${copied.project.name} imported as a separate model.`);
    } catch (e) {
      // The browser stays open, so the explanation goes there (QA B04), not into a toast.
      const detail = (e as Error).message;
      setImportError({
        file: file.name,
        message:
          stage === 'parse'
            ? 'the file is not valid JSON. A Gradara model is the .gradara.json file that Export writes.'
            : stage === 'check'
              ? 'it is not a Gradara model, or was made by a newer version.'
              : stage === 'read'
                ? 'the file could not be read.'
                : 'it could not be saved as a new model.',
        detail,
      });
      setBrowserSection((s) => s ?? 'models');
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
      execute: () => structuredClone(docRef.current),
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
          <AboutDialog
            version={health.version}
            engine={health.engine}
            engineReady={health.engineReady}
          />
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
            <UpdateIndicator onOpenSettings={() => setSettingsTab('updates')} />
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
            <Button
              variant="ghost"
              aria-label="Settings"
              title="Settings"
              onClick={() => setSettingsTab('engine')}
            >
              <SettingsIcon size={15} />
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
          style={
            widePanes
              ? {
                  gridTemplateColumns: `${libraryOpen ? sidePanes.widths[0] : 0}px minmax(350px, 1fr) ${inspectorOpen ? sidePanes.widths[1] : 0}px`,
                }
              : undefined
          }
        >
          {widePanes && libraryOpen && (
            <PaneResizer
              className="workbench-resizer"
              style={{ left: sidePanes.widths[0] - 3 }}
              label="Resize the component library"
              onReset={sidePanes.reset}
              onResize={(delta, start) => resizeSide(0, delta, start)}
            />
          )}
          {widePanes && inspectorOpen && (
            <PaneResizer
              className="workbench-resizer"
              style={{ right: sidePanes.widths[1] - 3 }}
              label="Resize the inspector"
              onReset={sidePanes.reset}
              onResize={(delta, start) => resizeSide(1, delta, start)}
            />
          )}
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
              <div className="workspace-tabs" role="tablist">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        role="tab"
                        aria-selected={workspaceMode === 'diagram'}
                        aria-label="Diagram view"
                        onClick={() => setWorkspaceMode('diagram')}
                      >
                        <Activity size={15} />
                        <span>Diagram</span>
                      </button>
                    }
                  >
                    <span />
                  </TooltipTrigger>
                  <TooltipContent>Diagram view · ⌘1</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        role="tab"
                        aria-selected={workspaceMode === 'results'}
                        aria-label="Results view"
                        onClick={() => setWorkspaceMode('results')}
                      >
                        <Activity size={15} />
                        <span>Results</span>
                      </button>
                    }
                  >
                    <span />
                  </TooltipTrigger>
                  <TooltipContent>Results view · ⌘2</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        role="tab"
                        aria-selected={workspaceMode === 'explorer'}
                        aria-label="Explorer view"
                        onClick={() => setWorkspaceMode('explorer')}
                      >
                        <ListTree size={15} />
                        <span>Explorer</span>
                      </button>
                    }
                  >
                    <span />
                  </TooltipTrigger>
                  <TooltipContent>
                    Model Explorer · ⌘3 · search ⌘K
                  </TooltipContent>
                </Tooltip>
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
                  min={STOP_TIME.min}
                  max={STOP_TIME.max}
                  ariaLabel="Simulation stop time"
                  inputRef={(el) => {
                    stopTimeRefs.current.toolbar = el;
                  }}
                  onValidity={(valid) =>
                    setBadStopTime((b) => (b.toolbar === !valid ? b : { ...b, toolbar: !valid }))
                  }
                />
                <span>s</span>
                {badStopTime.toolbar && (
                  <span role="alert" className="field-error">
                    {STOP_TIME.min} to {STOP_TIME.max}
                  </span>
                )}
              </label>
              <ConfigurationMenu
                doc={doc}
                disabled={running || switching}
                onApply={(c) => commitDoc((d) => applyConfiguration(d, c))}
                onSave={(name) =>
                  commitDoc((d) => saveConfiguration(d, name).project)
                }
                onRemove={(c) => commitDoc((d) => removeConfiguration(d, c.id))}
                onRunAll={() => void runAllConfigurations()}
              />
              <Button
                className={`run-button ${running ? 'running' : ''}`}
                onClick={() => void (running ? cancelRun() : runSimulation())}
                style={
                  running && runTrack?.stage.phase === 'simulating'
                    ? ({
                        '--run-progress': `${Math.floor((runTrack.stage.fraction ?? 0) * 100)}%`,
                      } as React.CSSProperties)
                    : undefined
                }
                title={
                  running
                    ? runTrack
                      ? `${statusText(runTrack)} · click to stop`
                      : undefined
                    : stopTimeInvalid
                      ? STOP_TIME_MESSAGE
                      : settingsInvalid
                        ? SETTINGS_MESSAGE
                        : undefined
                }
                disabled={
                  (!health.engineReady ||
                    !ready ||
                    switching ||
                    stopTimeInvalid ||
                    settingsInvalid ||
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
              onHelp={setHelpDefinition}
            />
          </aside>
          <section className="center-panel">
            {workspaceMode === 'diagram' ? (
              <div
                ref={canvasRef}
                className={`canvas-wrap tool-${canvasTool}`}
                onContextMenu={(e) => {
                  // Right-clicking a block acts on it: it becomes the selection unless it is already in it.
                  const node =
                    e.target instanceof Element
                      ? e.target.closest<HTMLElement>(
                          '.react-flow__node-block[data-id]',
                        )
                      : null;
                  const blockId = node?.dataset.id;
                  if (!blockId && !isCanvasInsertDoubleClick(e.target)) return;
                  e.preventDefault();
                  if (
                    blockId &&
                    !selectionRef.current.blockIds.includes(blockId)
                  ) {
                    const only = { ...emptySelection(), blockIds: [blockId] };
                    selectionRef.current = only;
                    select(only);
                  }
                  const bounds = canvasRef.current?.getBoundingClientRect();
                  setInserter(null);
                  const menu = {
                    at: {
                      x: e.clientX - (bounds?.left ?? 0),
                      y: e.clientY - (bounds?.top ?? 0),
                    },
                    point: flow.screenToFlowPosition({
                      x: e.clientX,
                      y: e.clientY,
                    }),
                    bounds: {
                      width: bounds?.width ?? 800,
                      height: bounds?.height ?? 600,
                    },
                  };
                  setCanvasMenu({ ...menu, items: canvasMenuItems(menu) });
                }}
                onDoubleClick={(e) => {
                  if (e.defaultPrevented) return;
                  if (!isCanvasInsertDoubleClick(e.target)) return;
                  const bounds = canvasRef.current?.getBoundingClientRect();
                  setComposer(null);
                  setInserter({
                    position: flow.screenToFlowPosition({
                      x: e.clientX,
                      y: e.clientY,
                    }),
                    screen: clampPopoverPosition(
                      {
                        x: e.clientX - (bounds?.left ?? 0),
                        y: e.clientY - (bounds?.top ?? 0),
                      },
                      {
                        width: bounds?.width ?? 400,
                        height: bounds?.height ?? 300,
                      },
                    ),
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
                  const d =
                    generatedEntries.find((entry) => entry.id === kind)
                      ?.definition ?? library.find((d) => d.kind === kind);
                  if (d)
                    addComponent(
                      d,
                      flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
                    );
                }}
              >
                {ready &&
                  project.blocks.length === 0 &&
                  scope.length > 0 &&
                  !composer &&
                  !inserter && (
                    <div className="empty-subsystem" role="note">
                      This subsystem is empty. Add blocks from the library, or
                      right-click to add input and output ports. Esc or ⌘↑ goes
                      back up.
                    </div>
                  )}
                {ready &&
                  project.blocks.length === 0 &&
                  scope.length === 0 &&
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
                              document
                                .getElementById('library-search')
                                ?.focus(),
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
                  <SubsystemLookupContext.Provider value={lookupSubsystem}>
                    <VariantSwitchContext.Provider value={switchVariantOnSheet}>
                      <ModelCanvas
                        sheet={scope.join('/')}
                        key={project.modelId ?? 'workspace'}
                        blocks={project.blocks}
                        project={project}
                        selection={selection}
                        onCopyDrop={({
                          project: next,
                          selection: selected,
                        }) => {
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
                        onLabelRename={(id, name) =>
                          commit((p) => ({
                            ...p,
                            blocks: p.blocks.map((b) =>
                              b.id === id
                                ? {
                                    ...b,
                                    definition: { ...b.definition, name },
                                  }
                                : b,
                            ),
                          }))
                        }
                        edges={[]}
                        nodesConnectable={false}
                        onNodeClick={(event, node) => {
                          if (
                            event.shiftKey ||
                            event.metaKey ||
                            event.ctrlKey
                          ) {
                            // Apply the click's intent idempotently: React Flow may
                            // already have delivered its own selection change.
                            setSelectedIds(
                              node.selected
                                ? selectedIds.filter((id) => id !== node.id)
                                : [...new Set([...selectedIds, node.id])],
                            );
                          } else {
                            select({
                              ...emptySelection(),
                              blockIds: [node.id],
                            });
                            setInspectorOpen(true);
                          }
                        }}
                        onNodeDoubleClick={(e, n) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (n.type === 'tap') return;
                          if (openSubsystem(n.id)) return;
                          // A port pill's properties are its port, not equations.
                          const block = projectRef.current.blocks.find(
                            (b) => b.id === n.id,
                          );
                          if (block && isBoundary(block)) {
                            setPortDialog(n.id);
                            return;
                          }
                          setEquationBlock({ id: n.id, tab: 'properties' });
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
                        <GridBackground visible={showGrid} />
                        <NoteLayer
                          notes={project.annotations ?? []}
                          editable={scope.length === 0}
                          editing={editingNote}
                          onEditingChange={setEditingNote}
                          onChange={(index, note) =>
                            commit((p) => ({
                              ...p,
                              annotations: (p.annotations ?? []).flatMap(
                                (a, i) =>
                                  i !== index ? [a] : note ? [note] : [],
                              ),
                            }))
                          }
                        />
                        <NetLayer
                          project={project}
                          selected={selectedEdges}
                          selection={selection}
                          groupSelection={
                            groupSelection || selectedIds.length > 1
                          }
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
                        <Controls showInteractive={false} showFitView={false}>
                          <ControlButton
                            className="react-flow__controls-fitview"
                            title="Fit view · Space"
                            aria-label="Fit view"
                            onClick={() =>
                              window.dispatchEvent(new Event(FIT_VIEW_EVENT))
                            }
                          >
                            <Maximize size={12} />
                          </ControlButton>
                          <ControlButton
                            title="Arrange · ⌘/Ctrl + Shift + A"
                            aria-label="Arrange blocks and wires"
                            onClick={arrange}
                          >
                            <LayoutGrid size={12} />
                          </ControlButton>
                        </Controls>
                        <SelectionActions
                          onGroup={groupSelected}
                          onArrange={arrange}
                        />
                      </ModelCanvas>
                    </VariantSwitchContext.Provider>
                  </SubsystemLookupContext.Provider>
                )}
                {runTrack && (
                  <RunProgress track={runTrack} variant="floating" onStop={() => void cancelRun()} />
                )}
                {selectedIds.length === 0 && (
                  <div className="canvas-hint">
                    <MousePointer2 size={11} />
                    {canvasTool === 'select' ? 'Drag to select' : 'Drag to pan'}
                    <span>·</span>Drag a wire to branch
                    <span>·</span>/ to search
                  </div>
                )}
                <HierarchyBar
                  doc={doc}
                  scope={scope}
                  canBack={nav.back.length > 0}
                  canForward={nav.forward.length > 0}
                  onBack={goBack}
                  onForward={goForward}
                  onNavigate={(path) => navigate(path)}
                />
                <div className="canvas-agent-shortcut">
                  <Button variant="outline" onClick={startComposer}>
                    <Sparkles size={14} />
                    Ask agent<kbd>A</kbd>
                  </Button>
                </div>
                {canvasMenu && (
                  <CanvasMenu
                    at={canvasMenu.at}
                    bounds={canvasMenu.bounds}
                    onClose={() => setCanvasMenu(null)}
                    items={canvasMenu.items}
                  />
                )}
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
                {composer?.mode === 'model' ? (
                  <ModelComposer
                    onClose={() => setComposer(null)}
                    onBlockMode={() =>
                      setComposer({ ...composer, mode: 'block' })
                    }
                    onInsert={insertGeneratedModel}
                  />
                ) : (
                  composer && (
                    <AgentComposer
                      key={
                        composer.existing?.id ??
                        JSON.stringify(composer.position)
                      }
                      context={composer}
                      onClose={() => setComposer(null)}
                      onInsert={insertGenerated}
                      onModelMode={() =>
                        setComposer({ ...composer, mode: 'model' })
                      }
                    />
                  )
                )}
              </div>
            ) : workspaceMode === 'explorer' ? (
              <ExplorerWorkspace
                doc={doc}
                result={result}
                problems={liveProblems}
                focusedBlock={
                  selectedIds[0]
                    ? {
                        sheetId: currentSubsystem ?? '',
                        blockId: selectedIds[0],
                      }
                    : undefined
                }
                searchSignal={searchSignal}
                onCommit={commitDoc}
                onReveal={revealTarget}
                onRunAll={() => void runAllConfigurations()}
                variantChecks={variantChecks}
                onOpenResults={() => setWorkspaceMode('results')}
              />
            ) : (
              <div className="results-view-wrap">
                <Results
                  key={project.modelId ?? 'workspace'}
                  modelId={project.modelId}
                  result={result}
                  running={running}
                  progress={runTrack}
                  onStop={() => void cancelRun()}
                  error={runError}
                  stale={!!result && signature !== resultSignature}
                  empty={!project.blocks.length}
                  dedicated
                />
              </div>
            )}
            <DiagnosticsDock
              state={dock}
              onChange={updateDock}
              counts={problemCounts}
              actions={
                dock.tab === 'problems' ? (
                  <>
                    {askableProblems.length > 0 && (
                      <>
                        <button
                          type="button"
                          disabled={!!assistant.busy}
                          title={explainLabel || 'Explain these problems'}
                          onClick={() => askAi(askableProblems, false)}
                        >
                          <Stethoscope size={12} />
                          Explain
                        </button>
                        <button
                          type="button"
                          className="is-primary"
                          disabled={!!assistant.busy}
                          title={fixLabel || 'Propose a checked fix'}
                          onClick={() => askAi(askableProblems, true)}
                        >
                          <Sparkles size={12} />
                          Fix with AI
                        </button>
                      </>
                    )}
                    <button type="button" onClick={copyProblems}>
                      <Copy size={12} />
                      Copy
                    </button>
                  </>
                ) : undefined
              }
              problems={
                <ProblemsPanel
                  project={project}
                  sections={problemSections}
                  onSelect={selectProblem}
                  onAsk={(d) => askAi([d], false)}
                  onSettingsHelp={(topic) => setSolverHelp({ topic })}
                  empty={
                    project.blocks.length
                      ? 'No problems. Run the model to check it in OpenModelica.'
                      : 'Add blocks from the library to start a model.'
                  }
                />
              }
              assistantActive={!!assistant.busy}
              assistant={
                <AssistantPanel
                  assistant={assistant}
                  project={project}
                  selectedIds={selectedIds}
                  onEdit={requestEdit}
                  onApply={applyProposal}
                  onSelect={(blockIds) => selectBlocks(blockIds)}
                  onOpenSettings={() => setSettingsTab('ai')}
                />
              }
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
              explorerRef={attachTree}
              style={treePane.stored ? { height: treePane.size } : undefined}
            />
            <PaneResizer
              axis="y"
              label="Resize the model tree"
              {...treePane.resizer(1)}
            />
            <div className="properties-heading">
              {active
                ? 'Component properties'
                : activeNet
                  ? 'Net properties'
                  : 'Model properties'}
              {active && (
                <button
                  type="button"
                  className="properties-help"
                  title="Block reference · F1"
                  aria-label={`Help for ${active.definition.name}`}
                  onClick={() => setHelpDefinition(active.definition)}
                >
                  <CircleHelp size={14} />
                </button>
              )}
            </div>
            <div className="inspector-properties">
              {selectedIds.length > 1 && (
                <div className="inspector-section group-bar">
                  <span>{selectedIds.length} blocks selected</span>
                  <Button variant="outline" size="sm" onClick={groupSelected}>
                    Make subsystem <kbd>⌘G</kbd>
                  </Button>
                </div>
              )}
              {activeNet && !active ? (
                <NetProperties
                  description={activeNet}
                  project={project}
                  onRename={(name) =>
                    commit((p) => renameNet(p, activeNet.net.id, name))
                  }
                  onVisibility={(visible) =>
                    commit((p) =>
                      setNetLabelShown(p, activeNet.net.id, visible),
                    )
                  }
                  onLogging={(logged) =>
                    commit((p) => ({
                      ...p,
                      nets: p.nets?.map((n) =>
                        n.id === activeNet.net.id ? { ...n, logged } : n,
                      ),
                    }))
                  }
                  onOpenData={() => setWorkspaceMode('results')}
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
                          Agent component
                        </>
                      ) : active.definition.controller ? (
                        'Controller'
                      ) : (
                        active.definition.domain
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
                    <details className="property-description">
                      <summary>Description</summary>
                      <p>{active.definition.description}</p>
                    </details>
                    {/* Only a signal block defined by equations can be refined. */}
                    {active.definition.domain === 'signal' &&
                      !active.definition.modelica &&
                      !active.definition.subsystem &&
                      !isBusBlock(active.definition) &&
                      !isBoundary(active) && (
                        <Button
                          className="refine-button"
                          variant="outline"
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
                      )}
                  </div>
                  {active.definition.subsystem && (
                    <div className="inspector-section subsystem-section">
                      <div className="section-label">
                        Subsystem
                        {usageCount(doc, active.definition.subsystem.ref) >
                          1 && (
                          <span title="Other instances share this inside; edits change all of them.">
                            Used{' '}
                            {usageCount(doc, active.definition.subsystem.ref)}×
                          </span>
                        )}
                      </div>
                      <p className="size-hint">
                        {findSubsystem(
                          doc,
                          active.definition.subsystem.ref,
                        )?.blocks.filter((b) => !isBoundary(b)).length ??
                          0}{' '}
                        blocks inside · {active.definition.ports.length} ports
                      </p>
                      <div className="subsystem-actions">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openSubsystem(active.id)}
                        >
                          Open
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={ungroupSelected}
                        >
                          Ungroup
                        </Button>
                        {usageCount(doc, active.definition.subsystem.ref) >
                          1 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              commit((p) => makeUnique(p, active.id))
                            }
                          >
                            Make unique
                          </Button>
                        )}
                      </div>
                      <InstancePortsPanel
                        view={project}
                        block={active}
                        onCommit={(change) => commit(change)}
                      />
                      <VariantPanel
                        doc={doc}
                        block={active}
                        onCommit={(change) => commit(change)}
                      />
                    </div>
                  )}
                  {isBusBlock(active.definition) && (
                    <BusSignalsPanel
                      block={active}
                      onCommit={(change) => commit(change)}
                    />
                  )}
                  {isBoundary(active) && (
                    <PortPillPanel
                      view={project}
                      block={active}
                      onCommit={(change) => commit(change)}
                    />
                  )}
                  {/* A port pill has no parameters or equations; a block with neither skips the section. */}
                  {/* A bus block's equations follow its Signals; there is nothing else to edit. */}
                  {!isBoundary(active) &&
                    !isBusBlock(active.definition) &&
                    (active.definition.parameters.length > 0 ||
                      !!active.definition.equations?.trim() ||
                      !!active.definition.declarations?.trim()) && (
                      <div className="inspector-section">
                        <div className="section-label">
                          Parameters
                          <span>{active.definition.parameters.length}</span>
                          <button
                            onClick={() =>
                              setEquationBlock({
                                id: active.id,
                                tab: 'properties',
                              })
                            }
                          >
                            Edit…
                          </button>
                        </div>
                        <ParameterList
                          blockId={active.id}
                          parameters={active.definition.parameters}
                          {...(currentSubsystem && !isBoundary(active)
                            ? {
                                promoted: promotedTargets(
                                  doc,
                                  currentSubsystem,
                                ).get(active.id),
                                onPromote: (id: string) =>
                                  commit((p) =>
                                    promoteParameter(
                                      p,
                                      currentSubsystem,
                                      active.id,
                                      id,
                                    ),
                                  ),
                                onDemote: (id: string) =>
                                  commit((p) =>
                                    demoteParameter(p, currentSubsystem, id),
                                  ),
                              }
                            : {})}
                          onChange={(id, value) =>
                            commit((p) =>
                              applyBlockEdits(p, active.id, {
                                parameters: { [id]: value },
                              }),
                            )
                          }
                        />
                      </div>
                    )}
                  <div className="inspector-section block-layout-section">
                    <div className="section-label">
                      Block size{' '}
                      <span className="subtle">px, steps of {2 * GRID}</span>
                    </div>
                    <div className="block-size-fields">
                      <label>
                        Width
                        <NumberField
                          key={`${active.id}-width`}
                          value={blockSize(active).width}
                          min={
                            minimumBlockSize(active.definition, active.rotation)
                              .width
                          }
                          max={1200}
                          ariaLabel="Block width"
                          onChange={(width) =>
                            updateLayout([
                              {
                                id: active.id,
                                position: active.position,
                                // Whole size steps, so the ports stay on the grid.
                                size: {
                                  ...blockSize(active),
                                  width: snapLength(
                                    width,
                                    minimumBlockSize(
                                      active.definition,
                                      active.rotation,
                                    ).width,
                                  ),
                                },
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
                          min={
                            minimumBlockSize(active.definition, active.rotation)
                              .height
                          }
                          max={1200}
                          ariaLabel="Block height"
                          onChange={(height) =>
                            updateLayout([
                              {
                                id: active.id,
                                position: active.position,
                                size: {
                                  ...blockSize(active),
                                  height: snapLength(
                                    height,
                                    minimumBlockSize(
                                      active.definition,
                                      active.rotation,
                                    ).height,
                                  ),
                                },
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
                            size:
                              active.rotation && active.rotation % 180
                                ? {
                                    width: defaultBlockSize(active.definition)
                                      .height,
                                    height: defaultBlockSize(active.definition)
                                      .width,
                                  }
                                : defaultBlockSize(active.definition),
                          },
                        ])
                      }
                    >
                      Use standard size
                    </button>
                    <button
                      type="button"
                      className="standard-block-size"
                      onClick={() =>
                        commit((p) => rotateBlocks(p, [active.id]))
                      }
                    >
                      Rotate 90° · R
                    </button>
                    <p className="size-hint">
                      Drag a corner or edge to resize. Press R to rotate.
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
                      <button
                        onClick={() =>
                          setEquationBlock({ id: active.id, tab: 'equations' })
                        }
                      >
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
                  <span className="property-field-label">Name</span>
                  <NameField
                    label="Model name"
                    value={project.name}
                    onCommit={(name) => commit((p) => ({ ...p, name }))}
                  />
                  <label className="model-duration-field">
                    <span>
                      Stop time <small>s</small>
                    </span>
                    <NumberField
                      ariaLabel="Model stop time"
                      value={project.duration}
                      min={STOP_TIME.min}
                      max={STOP_TIME.max}
                      onChange={(duration) =>
                        commit((p) => ({ ...p, duration }))
                      }
                      inputRef={(el) => {
                        stopTimeRefs.current.inspector = el;
                      }}
                      onValidity={(valid) =>
                        setBadStopTime((b) => (b.inspector === !valid ? b : { ...b, inspector: !valid }))
                      }
                    />
                  </label>
                  {badStopTime.inspector && (
                    <p role="alert" className="field-error">
                      {STOP_TIME_MESSAGE}
                    </p>
                  )}
                  <SimulationSettingsPanel
                    duration={project.duration}
                    settings={project.simulation}
                    onChange={(simulation) =>
                      commit((p) => {
                        const { simulation: _old, ...rest } = p;
                        return simulation ? { ...rest, simulation } : rest;
                      })
                    }
                    onValidity={(valid) => setSettingsInvalid(!valid)}
                    onGuide={(topic) => setSolverHelp({ topic })}
                  />
                  {project.description && (
                    <details className="property-description">
                      <summary>Description</summary>
                      <p>{project.description}</p>
                    </details>
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      window.dispatchEvent(new Event(FIT_VIEW_EVENT))
                    }
                  >
                    <Maximize size={13} />
                    Fit model to view
                  </Button>
                </div>
              )}
            </div>
          </aside>
        </div>
        <footer className="statusbar">
          <span>
            <span
              className={`status-dot ${health.engineReady ? '' : 'offline'}`}
            />
            {runTrack
              ? `${health.engine} · ${statusText(runTrack)}`
              : health.engineReady
                ? `${health.engine} ready`
                : 'Simulation engine not set up'}
            {!health.engineReady && (
              <button
                className="engine-setup-link"
                onClick={() => setSettingsTab('engine')}
              >
                Set up
              </button>
            )}
          </span>
          <button
            type="button"
            className="problems-summary"
            onClick={() => updateDock({ open: !dock.open, tab: 'problems' })}
            title="Toggle the Problems panel · ⌘J"
          >
            {problemCounts.error || problemCounts.warning ? (
              <>
                {problemCounts.error > 0 && (
                  <span className="is-error">
                    <AlertCircle size={11} /> {problemCounts.error}{' '}
                    {problemCounts.error === 1 ? 'error' : 'errors'}
                  </span>
                )}
                {problemCounts.error > 0 && problemCounts.warning > 0 && ' · '}
                {problemCounts.warning > 0 && (
                  <span className="is-warning">
                    {problemCounts.warning}{' '}
                    {problemCounts.warning === 1 ? 'warning' : 'warnings'}
                  </span>
                )}
              </>
            ) : (
              <>
                <Check size={11} /> No problems
              </>
            )}
          </button>
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
        {portDialog && project.blocks.find((b) => b.id === portDialog) && (
          <PortDialog
            key={portDialog}
            block={project.blocks.find((b) => b.id === portDialog)!}
            count={(role, type) => {
              const kind = kindFor(role, type).kind;
              return project.blocks.filter(
                (b) => isBoundary(b) && b.definition.kind === kind,
              ).length;
            }}
            onClose={() => setPortDialog(null)}
            onApply={(change) => {
              commit((p) => editPort(p, portDialog, change));
              setPortDialog(null);
            }}
          />
        )}
        {equationBlock &&
          project.blocks.find((b) => b.id === equationBlock.id) && (
            <BlockDialog
              key={equationBlock.id}
              block={project.blocks.find((b) => b.id === equationBlock.id)!}
              initialTab={equationBlock.tab}
              onClose={() => setEquationBlock(null)}
              onCommit={(change) => commit(change)}
              onApply={(edits) => {
                const before = projectRef.current.blocks.find(
                  (b) => b.id === equationBlock.id,
                )?.definition;
                commit((p) => applyBlockEdits(p, equationBlock.id, edits));
                setEquationBlock(null);
                if (
                  before &&
                  ((edits.equations !== undefined &&
                    edits.equations !== before.equations) ||
                    (edits.declarations !== undefined &&
                      edits.declarations !== (before.declarations ?? '')))
                )
                  notify('Equations updated. Run the model to apply them.');
              }}
            />
          )}
        {browserSection && (
          <ModelBrowser
            section={browserSection}
            activeId={project.modelId}
            onClose={() => {
              setBrowserSection(null);
              setImportError(null);
            }}
            onOpen={openModel}
            onCreate={createModel}
            onImport={() => importRef.current?.click()}
            importError={importError}
            onDismissImportError={() => setImportError(null)}
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
            doc={doc}
            path={scope}
            project={project}
            selectedIds={selectedIds}
            runId={result?.comparison ? undefined : result?.id}
            onCommit={(change) => commit(change)}
            onShowBlocks={(ids) => {
              setExportOpen(false);
              selectBlocks(ids);
            }}
            onOpenSettings={() => {
              setExportOpen(false);
              setSettingsTab('ai');
            }}
            onClose={() => setExportOpen(false)}
          />
        )}
        {settingsTab && (
          <SettingsDialog
            initialTab={settingsTab}
            dataDirectory={health.projectDirectory}
            onClose={() => {
              setSettingsTab(null);
              refreshHealth();
            }}
            onEngineChange={refreshHealth}
          />
        )}
        {solverHelp && (
          <SolverHelpDialog topic={solverHelp.topic} onClose={() => setSolverHelp(null)} />
        )}
        {helpDefinition && (
          <BlockHelpDialog
            definition={helpDefinition}
            onClose={() => setHelpDefinition(null)}
          />
        )}
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="shortcuts-dialog" resizeKey="shortcuts">
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
                ['Rotate selected blocks clockwise', 'R'],
                ['Restore auto route (wires only)', 'R'],
                ['Name a signal / net', 'Double-click wire / F2'],
                ['Move a signal label', 'Drag along its net'],
                ['Ask agent (new block or model)', 'A'],
                ['Run simulation', '⌘ / Ctrl + Enter'],
                ['Save now (edits also save automatically)', '⌘ / Ctrl + S'],
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
                ['Switch to Diagram view', '⌘ / Ctrl + 1'],
                ['Switch to Results view', '⌘ / Ctrl + 2'],
                ['Switch to Model Explorer', '⌘ / Ctrl + 3'],
                ['Search the model', '⌘ / Ctrl + K'],
                ['Show or hide the Problems dock', '⌘ / Ctrl + J'],
                ['Make subsystem · ungroup', '⌘ / Ctrl + G · ⇧G'],
                ['Leave a subsystem', 'Esc · ⌘ / Ctrl + ↑'],
                ['Select several components', 'Shift + click / Drag'],
                ['Select / pan tools', 'V / H'],
                ['Fit the model to the view', 'Space (tap) / F'],
                ['Show or hide the grid', "⌘ / Ctrl + '"],
                ['Resize a side panel', 'Drag its inner edge'],
                ['Restore default panel sizes', 'Canvas menu → Reset layout'],
                ['Add a note', 'Canvas menu → Add note here'],
                ['Edit or delete a note', 'Double-click it · Delete'],
                ['Canvas menu', 'Right-click empty space or a block'],
                [
                  'Arrange the sheet (or the selection)',
                  '⌘ / Ctrl + Shift + A',
                ],
                ['Pan canvas', 'Space + drag / Trackpad'],
                ['Resize a block', 'Drag a corner or edge'],
                ['Move a block name', 'Drag the label'],
                ['Rename a block', 'Double-click its name'],
                ['Reset name position', 'Select the name, then Home'],
                ['Nudge selection one grid step', 'Arrow keys'],
                ['Nudge five grid steps', 'Shift + arrows'],
                ['Add a block at the pointer', 'Double-click empty canvas'],
                ["Open a block's properties", 'Double-click the block'],
                ['Open a subsystem', 'Double-click it'],
                ["Open a block's reference page", 'F1'],
                ['Show this list', '?'],
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
