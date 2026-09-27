import type { Diagnostic } from './api';
import {
  findSubsystem,
  instanceDefinitionFor,
  instancePorts,
  newId,
  subsystemsOf,
  syncInstances,
} from './hierarchy';
import type {
  Block,
  Configuration,
  Project,
  SubsystemDefinition,
  Variant,
} from './model';
import { validateProject } from './validate-project';

/*
 * Variants: alternative insides for one subsystem instance, behind one set of
 * ports. The instance's `subsystem.ref` is always the active variant's inside,
 * so emission, results, and every other hierarchy helper see an ordinary
 * instance. Switching stores the current parameter values in the variant being
 * left and loads the chosen variant's values.
 */

type Sheet = { blocks: Block[] };

/** Every sheet of the document with its key prefix: '' for the top, the subsystem ID inside one. */
function sheets(doc: Project): [string, Sheet][] {
  return [
    ['', doc],
    ...subsystemsOf(doc).map((s) => [s.id, s] as [string, Sheet]),
  ];
}

export const configurationKey = (sheetId: string, blockId: string) =>
  `${sheetId}/${blockId}`;

export type VariantInstance = {
  key: string;
  sheetId: string;
  block: Block;
  variants: Variant[];
  active: string;
};

/** Instances with variants anywhere in the document, top level first. */
export function variantInstances(doc: Project): VariantInstance[] {
  const out: VariantInstance[] = [];
  for (const [sheetId, sheet] of sheets(doc))
    for (const block of sheet.blocks) {
      const sr = block.definition.subsystem;
      if (sr?.variants && sr.active)
        out.push({
          key: configurationKey(sheetId, block.id),
          sheetId,
          block,
          variants: sr.variants,
          active: sr.active,
        });
    }
  return out;
}

export function activeVariant(block: Block) {
  const sr = block.definition.subsystem;
  return sr?.variants?.find((v) => v.id === sr.active);
}

function mapInstance(
  view: Project,
  instanceId: string,
  change: (block: Block) => Block,
): Project {
  return {
    ...view,
    blocks: view.blocks.map((b) => (b.id === instanceId ? change(b) : b)),
  };
}

function values(block: Block) {
  return Object.fromEntries(
    block.definition.parameters.map((p) => [p.id, p.value]),
  );
}

/** The next free short name: A, B, C, … (names fit the switch on the block). */
function nextVariantName(variants: Variant[]) {
  const names = new Set(variants.map((v) => v.name));
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!names.has(letter)) return letter;
  }
  return uniqueVariantName(variants, 'Variant');
}

function uniqueVariantName(variants: Variant[], base: string) {
  const names = new Set(variants.map((v) => v.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** The variant list of an instance, creating the first variant from what it shows now. */
function variantsOf(block: Block): Variant[] {
  const sr = block.definition.subsystem!;
  if (sr.variants) return sr.variants;
  return [{ id: newId('v_'), name: 'A', ref: sr.ref, values: values(block) }];
}

/** Point the instance at `variant`: its inside, and its remembered parameter values. */
function show(block: Block, variants: Variant[], variant: Variant): Block {
  const sr = block.definition.subsystem!;
  const leaving = variants.map((v) =>
    v.id === sr.active ? { ...v, values: values(block) } : v,
  );
  return {
    ...block,
    definition: {
      ...block.definition,
      parameters: block.definition.parameters.map((p) =>
        p.id in variant.values ? { ...p, value: variant.values[p.id] } : p,
      ),
      subsystem: { ref: variant.ref, variants: leaving, active: variant.id },
    },
  };
}

/**
 * Rebuild the instance for its new inside: ports and parameter list follow the
 * definition, and promoted values come from the chosen variant (parameters the
 * new inside adds start at their defaults). Works on a sheet view; the document
 * is synced when the edit is committed.
 */
function finish(view: Project, instanceId: string, variant: Variant): Project {
  return mapInstance(view, instanceId, (b) => {
    const def = instanceDefinitionFor(view, b) ?? b.definition;
    const parameters = def.parameters.map((p) =>
      p.id in variant.values ? { ...p, value: variant.values[p.id] } : p,
    );
    const now = Object.fromEntries(parameters.map((p) => [p.id, p.value]));
    const sr = def.subsystem!;
    return {
      ...b,
      definition: {
        ...def,
        parameters,
        subsystem: {
          ...sr,
          variants: sr.variants?.map((v) =>
            v.id === sr.active ? { ...v, values: now } : v,
          ),
        },
      },
    };
  });
}

/** Switch an instance on the sheet `view` to one of its variants. */
export function switchVariant(
  view: Project,
  instanceId: string,
  variantId: string,
): Project {
  const block = view.blocks.find((b) => b.id === instanceId);
  const sr = block?.definition.subsystem;
  const variant = sr?.variants?.find((v) => v.id === variantId);
  if (!block || !sr?.variants || !variant || sr.active === variantId)
    return view;
  return finish(
    mapInstance(view, instanceId, (b) => show(b, sr.variants!, variant)),
    instanceId,
    variant,
  );
}

/** A new diagram variant: a copy of the active inside that can then be edited on its own. */
export function addDiagramVariant(
  view: Project,
  instanceId: string,
  name?: string,
): { project: Project; variantId: string } | undefined {
  const block = view.blocks.find((b) => b.id === instanceId);
  const sub = block?.definition.subsystem
    ? findSubsystem(view, block.definition.subsystem.ref)
    : undefined;
  if (!block || !sub) return undefined;
  const variants = variantsOf(block);
  const active = variants.find((v) => v.ref === sub.id) ?? variants[0];
  // Boundary block IDs are kept, so the copy has the same ports as the original.
  const copy: SubsystemDefinition = {
    ...structuredClone(sub),
    id: newId('sub_'),
  };
  const variant: Variant = {
    id: newId('v_'),
    name: name ? uniqueVariantName(variants, name) : nextVariantName(variants),
    ref: copy.id,
    values: values(block),
  };
  copy.name = `${sub.name} ${variant.name}`.slice(0, 120);
  const withVariants = mapInstance(
    { ...view, version: 2, subsystems: [...subsystemsOf(view), copy] },
    instanceId,
    (b) => ({
      ...b,
      definition: {
        ...b.definition,
        subsystem: { ref: active.ref, variants, active: active.id },
      },
    }),
  );
  return {
    project: switchVariant(
      mapInstance(withVariants, instanceId, (b) => ({
        ...b,
        definition: {
          ...b.definition,
          subsystem: {
            ...b.definition.subsystem!,
            variants: [...variants, variant],
          },
        },
      })),
      instanceId,
      variant.id,
    ),
    variantId: variant.id,
  };
}

/** A new parameter variant: the same inside with its own promoted parameter values. */
export function addParameterVariant(
  view: Project,
  instanceId: string,
  name?: string,
): { project: Project; variantId: string } | undefined {
  const block = view.blocks.find((b) => b.id === instanceId);
  if (!block?.definition.subsystem) return undefined;
  const variants = variantsOf(block);
  const active =
    variants.find((v) => v.id === block.definition.subsystem!.active) ??
    variants[0];
  const variant: Variant = {
    id: newId('v_'),
    name: name ? uniqueVariantName(variants, name) : nextVariantName(variants),
    ref: active.ref,
    values: values(block),
  };
  return {
    project: switchVariant(
      mapInstance(view, instanceId, (b) => ({
        ...b,
        definition: {
          ...b.definition,
          subsystem: {
            ref: active.ref,
            variants: [...variants, variant],
            active: active.id,
          },
        },
      })),
      instanceId,
      variant.id,
    ),
    variantId: variant.id,
  };
}

export function renameVariant(
  view: Project,
  instanceId: string,
  variantId: string,
  name: string,
): Project {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return view;
  return mapInstance(view, instanceId, (b) => {
    const sr = b.definition.subsystem!;
    return {
      ...b,
      definition: {
        ...b.definition,
        subsystem: {
          ...sr,
          variants: sr.variants?.map((v) =>
            v.id === variantId ? { ...v, name: trimmed } : v,
          ),
        },
      },
    };
  });
}

/** Remove a variant; the instance keeps the rest, or becomes a plain subsystem when one is left. */
export function removeVariant(
  view: Project,
  instanceId: string,
  variantId: string,
): Project {
  const block = view.blocks.find((b) => b.id === instanceId);
  const sr = block?.definition.subsystem;
  if (!block || !sr?.variants) return view;
  const rest = sr.variants.filter((v) => v.id !== variantId);
  let next = view;
  if (sr.active === variantId)
    next = switchVariant(view, instanceId, rest[0].id);
  next = mapInstance(next, instanceId, (b) => {
    const cur = b.definition.subsystem!;
    const left = cur.variants!.filter((v) => v.id !== variantId);
    return {
      ...b,
      definition: {
        ...b.definition,
        subsystem:
          left.length > 1 ? { ...cur, variants: left } : { ref: cur.ref },
      },
    };
  });
  // Unreferenced insides and stale ports are dropped when the edit is committed.
  return next;
}

/** Mark a port that a variant's inside lacks as deliberately idle ("not used here"), or clear it. */
export function setPortUnused(
  view: Project,
  instanceId: string,
  variantId: string,
  portId: string,
  unused: boolean,
): Project {
  return mapInstance(view, instanceId, (b) => {
    const sr = b.definition.subsystem!;
    return {
      ...b,
      definition: {
        ...b.definition,
        subsystem: {
          ...sr,
          variants: sr.variants?.map((v) => {
            if (v.id !== variantId) return v;
            const set = new Set(v.unused ?? []);
            if (unused) set.add(portId);
            else set.delete(portId);
            const { unused: _u, ...rest } = v;
            return set.size ? { ...rest, unused: [...set].sort() } : rest;
          }),
        },
      },
    };
  });
}

/** Instance ports a variant's inside does not have. */
export function missingPorts(doc: Project, block: Block, variant: Variant) {
  const sub = findSubsystem(doc, variant.ref);
  if (!sub) return [];
  const present = new Set(instancePorts(sub).map((p) => p.id));
  return block.definition.ports.filter((p) => !present.has(p.id));
}

// ---------------------------------------------------------------- configurations

export function currentChoices(doc: Project): Record<string, string> {
  return Object.fromEntries(
    variantInstances(doc).map((i) => [i.key, i.active]),
  );
}

/** The configuration the document currently matches, if any. */
export function matchingConfiguration(doc: Project) {
  const choices = currentChoices(doc);
  return doc.configurations?.find((c) =>
    Object.entries(choices).every(
      ([key, id]) => !(key in c.choices) || c.choices[key] === id,
    ),
  );
}

/** Switch every instance to its variant in `configuration`, across the whole document. */
export function applyConfiguration(
  doc: Project,
  configuration: Configuration,
): Project {
  let next = doc;
  for (const inst of variantInstances(doc)) {
    const want = configuration.choices[inst.key];
    if (
      !want ||
      want === inst.active ||
      !inst.variants.some((v) => v.id === want)
    )
      continue;
    if (!inst.sheetId) next = switchVariant(next, inst.block.id, want);
    else {
      const sub = findSubsystem(next, inst.sheetId)!;
      const view = switchVariant(
        { ...next, blocks: sub.blocks },
        inst.block.id,
        want,
      );
      next = syncInstances({
        ...next,
        subsystems: subsystemsOf(view).map((s) =>
          s.id === inst.sheetId ? { ...s, blocks: view.blocks } : s,
        ),
      });
    }
  }
  return next;
}

export function saveConfiguration(doc: Project, name: string) {
  const configuration: Configuration = {
    id: newId('cfg_'),
    name: name.trim().slice(0, 60) || 'Configuration',
    choices: currentChoices(doc),
  };
  return {
    project: {
      ...doc,
      configurations: [...(doc.configurations ?? []), configuration],
    },
    configuration,
  };
}

export function setConfigurationChoice(
  doc: Project,
  configurationId: string,
  key: string,
  variantId: string,
): Project {
  return {
    ...doc,
    configurations: doc.configurations?.map((c) =>
      c.id === configurationId
        ? { ...c, choices: { ...c.choices, [key]: variantId } }
        : c,
    ),
  };
}

export function renameConfiguration(
  doc: Project,
  configurationId: string,
  name: string,
): Project {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return doc;
  return {
    ...doc,
    configurations: doc.configurations?.map((c) =>
      c.id === configurationId ? { ...c, name: trimmed } : c,
    ),
  };
}

export function removeConfiguration(
  doc: Project,
  configurationId: string,
): Project {
  const left = (doc.configurations ?? []).filter(
    (c) => c.id !== configurationId,
  );
  const { configurations: _c, ...rest } = doc;
  return left.length ? { ...rest, configurations: left } : (rest as Project);
}

// ---------------------------------------------------------------- checks

/**
 * Problems in every variant, active or not, so a broken alternative shows
 * before anyone switches to it: ports its inside lacks (unless marked not used
 * here) and the inside's own authoring problems. Inactive ones are warnings.
 */
export function variantProblems(doc: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const checked = new Set<string>();
  for (const inst of variantInstances(doc)) {
    for (const variant of inst.variants) {
      const active = variant.id === inst.active;
      const severity = active ? 'error' : 'warning';
      const label = `${inst.block.definition.name} [${variant.name}]`;
      const unused = new Set(variant.unused ?? []);
      for (const port of missingPorts(doc, inst.block, variant))
        if (!unused.has(port.id))
          out.push({
            id: `v-variant-port-${inst.key}-${variant.id}-${port.id}`,
            severity,
            source: 'validation',
            message: `${label} has no inside for port ${port.name}.`,
            detail: '',
            blockIds: [inst.block.id],
            ports: [{ blockId: inst.block.id, portId: port.id }],
            netIds: [],
            wireIds: [],
            hint: 'Add the port inside this variant, or mark it “not used here” so it stays idle.',
          });
      // The active inside is checked when its sheet is open; inactive ones only here.
      if (active || checked.has(variant.ref)) continue;
      checked.add(variant.ref);
      const sub = findSubsystem(doc, variant.ref);
      if (!sub) continue;
      for (const d of validateProject({
        ...doc,
        blocks: sub.blocks,
        wires: sub.wires,
        junctions: sub.junctions ?? [],
        nets: sub.nets,
      }))
        if (d.severity === 'error')
          out.push({
            ...d,
            id: `${d.id}-in-${variant.ref}`,
            severity: 'warning',
            message: `Inactive variant ${label}: ${d.message}`,
            blockIds: [inst.block.id],
            ports: [],
            wireIds: [],
            netIds: [],
          });
    }
  }
  return out;
}
