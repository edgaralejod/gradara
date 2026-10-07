// SPDX-License-Identifier: Apache-2.0
/**
 * The Ask bar's rules: which actions a context allows, which one is chosen,
 * and what each costs. Where you ask decides what is sent, so no model call is
 * needed to route a request: on an open port it makes a block, on problems it
 * explains, with runs on show it explains results, on an empty sheet it builds
 * a model, otherwise it edits. Tab moves to the next allowed action.
 */
import type { AiOperation } from './ai';
import type { Diagnostic } from './api';
import { blockTypes, type BlockType } from './block-creation';
import type { Definition } from './model';

export type AskAction =
  | 'edit'
  | 'block'
  | 'refine-block'
  | 'model'
  | 'explain'
  | 'fix'
  | 'results';

/** Runs on show in the Data Inspector, and what the user is looking at. */
export type RunContext = {
  modelId: string;
  /** Shown runs, the one the question is about first. */
  runIds: string[];
  /** The run the others are compared with. */
  baseline?: string;
  /** Series keys plotted on the active plot. */
  signals: string[];
  /** The zoomed time window of the active plot, when it is not the whole run. */
  window?: [number, number];
  /** Run titles for the chips, by ID. */
  titles: Record<string, string>;
  /** Signal names for the chips, by key. */
  signalNames: Record<string, string>;
};

export type AskContext = {
  /** Selected blocks the request most likely concerns. */
  selection: string[];
  /** A connection the new block attaches to (an open port). */
  connection?: { blockId: string; portId: string };
  /** Where a new block goes, in canvas coordinates. */
  position?: { x: number; y: number };
  /** The block being refined. */
  existing?: { id: string; definition: Definition };
  /** Problems to explain or fix. */
  problems?: Diagnostic[];
  /** Runs to discuss. */
  runs?: RunContext;
  /** The sheet has no blocks yet. */
  emptySheet?: boolean;
  /** Inside a subsystem: the AI edits the top level only. */
  inSubsystem?: boolean;
};

export const actionInfo: Record<
  AskAction,
  { label: string; placeholder: string; operation: AiOperation; send: string }
> = {
  edit: {
    label: 'Edit model',
    placeholder: 'Describe a change to this model…',
    operation: 'edit',
    send: 'Propose',
  },
  block: {
    label: 'Create block',
    placeholder: 'Describe the block’s behavior…',
    operation: 'component',
    send: 'Create',
  },
  'refine-block': {
    label: 'Refine block',
    placeholder: 'Describe the change; existing terminals are kept…',
    operation: 'component',
    send: 'Refine',
  },
  model: {
    label: 'Build model',
    placeholder: 'Describe the model or circuit to build…',
    operation: 'model',
    send: 'Build',
  },
  explain: {
    label: 'Explain problems',
    placeholder: 'Add a question about these problems (optional)…',
    operation: 'diagnose',
    send: 'Explain',
  },
  fix: {
    label: 'Fix problems',
    placeholder: 'Add guidance for the fix (optional)…',
    operation: 'fix',
    send: 'Fix',
  },
  results: {
    label: 'Explain results',
    placeholder: 'Ask about these results, e.g. why is the current so high?',
    operation: 'results',
    send: 'Ask',
  },
};

/** The actions a context allows, the natural one first. */
export function availableActions(context: AskContext): AskAction[] {
  if (context.existing) return ['refine-block'];
  if (context.connection) return ['block'];
  if (context.problems?.length) return ['explain', 'fix'];
  if (context.runs?.runIds.length) return ['results', 'edit'];
  if (context.emptySheet) return ['model', 'block'];
  return ['edit', 'block', 'model'];
}

/** The action after `current` (Tab), wrapping around. */
export function nextAction(context: AskContext, current: AskAction): AskAction {
  const actions = availableActions(context);
  const at = actions.indexOf(current);
  return actions[(at + 1) % actions.length] ?? actions[0];
}

/** The action to use: the chosen one while the context still allows it, else the natural one. */
export function resolveAction(
  context: AskContext,
  chosen?: AskAction,
): AskAction {
  const actions = availableActions(context);
  return chosen && actions.includes(chosen) ? chosen : actions[0];
}

/** Whether `text` can be sent for `action` (problem actions may go without words). */
export function canSend(action: AskAction, text: string): boolean {
  if (action === 'explain' || action === 'fix') return true;
  return text.trim().length >= 3;
}

const DOMAIN_WORDS: [BlockType, RegExp][] = [
  [
    'multidomain',
    /\b(motor|generator|actuator|solenoid|loudspeaker|thermistor|heater|joule|self-heating|electromechanical)s?\b/i,
  ],
  [
    'electrical',
    /\b(resistor|capacitor|inductor|diode|transistor|mosfet|igbt|switch|transformer|voltage|current|ohm|farad|henry|circuit|battery)s?\b/i,
  ],
  ['translational', /\b(linear|translational|piston|force|newton|slider|mass|spring.*linear)s?\b/i],
  ['mechanical', /\b(shaft|torque|rotational|gear|inertia|flywheel|clutch|angular|rpm)s?\b/i],
  ['thermal', /\b(thermal|heat|temperature|kelvin|celsius|conduction|convection)s?\b/i],
  ['magnetic', /\b(magnetic|reluctance|flux|air gap|permeance|mmf)s?\b/i],
];

/** A first guess at the block type from the request, before the user picks one. */
export function guessBlockType(text: string): BlockType {
  const found = DOMAIN_WORDS.filter(([, words]) => words.test(text)).map(([type]) => type);
  // Two physical domains in one request (a resistor with a thermal port) make a multidomain block.
  if (found[0] === 'multidomain' || found.length > 1) return 'multidomain';
  return found[0] ?? 'signal';
}

/** The block type an open port implies. */
export function portBlockType(domain: string | undefined): BlockType | undefined {
  if (!domain) return undefined;
  if (domain === 'signal' || domain === 'boolean') return 'signal';
  return domain in blockTypes ? (domain as BlockType) : undefined;
}

/** The scope line under a request in the Proposals tab. */
export function scopeText(
  action: AskAction,
  context: AskContext,
  names: (id: string) => string | undefined,
): string {
  if (action === 'results' && context.runs) {
    const runs = context.runs.runIds
      .map((id) => context.runs!.titles[id] ?? 'Run')
      .join(' · ');
    return context.runs.window
      ? `Explain results · ${runs} · zoomed`
      : `Explain results · ${runs}`;
  }
  if ((action === 'explain' || action === 'fix') && context.problems)
    return `${actionInfo[action].label} · ${context.problems.length} ${context.problems.length === 1 ? 'problem' : 'problems'}`;
  if (action === 'refine-block' && context.existing)
    return `Refine block · ${context.existing.definition.name}`;
  if (action === 'block')
    return context.connection ? 'Create block · on a port' : 'Create block';
  if (action === 'model') return 'Build model · opens as a new model';
  const picked = context.selection.map(names).filter(Boolean);
  return picked.length ? `Selection · ${picked.join(', ')}` : 'Whole model';
}
