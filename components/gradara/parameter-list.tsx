'use client';
import type { Ref } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Parameter } from '@/lib/gradara/model';
import NumberField from './number-field';

/** Parameter rows shared by the inspector and the block dialog. */
export default function ParameterList({
  blockId,
  parameters,
  onChange,
  defaults,
  firstInputRef,
  live = false,
  onEnter,
  promoted,
  onPromote,
  onDemote,
}: {
  blockId: string;
  parameters: Parameter[];
  onChange: (id: string, value: number) => void;
  defaults?: Record<string, number>;
  firstInputRef?: Ref<HTMLInputElement>;
  live?: boolean;
  onEnter?: () => void;
  /** Parameters set per instance by a subsystem parameter (inside a subsystem). */
  promoted?: Map<string, { id: string; name: string }>;
  onPromote?: (id: string) => void;
  onDemote?: (promotedId: string) => void;
}) {
  if (!parameters.length)
    return (
      <p className="no-parameters">This component has no parameters.</p>
    );
  return parameters.map((param, index) => {
    const initial = defaults?.[param.id];
    const canReset = initial !== undefined && initial !== param.value;
    const setBy = promoted?.get(param.id);
    return (
      <label className="parameter" key={`${blockId}-${param.id}`}>
        <span>
          {param.name}
          {setBy && (
            <small className="promoted-note" title="Each instance of this subsystem sets its own value.">
              set per instance
            </small>
          )}
        </span>
        <div>
          <NumberField
            disabled={!!setBy}
            value={param.value}
            min={param.min}
            max={param.max}
            ariaLabel={param.name}
            inputRef={index === 0 ? firstInputRef : undefined}
            live={live}
            onEnter={onEnter}
            onChange={(value) => onChange(param.id, value)}
          />
          <span>{param.unit}</span>
          {(onPromote || onDemote) && (
            <button
              type="button"
              className="parameter-promote"
              title={
                setBy
                  ? `Stop exposing “${setBy.name}” on the subsystem block`
                  : 'Promote: expose this parameter on the subsystem block'
              }
              aria-label={setBy ? `Unpromote ${param.name}` : `Promote ${param.name}`}
              onClick={(e) => {
                e.preventDefault();
                if (setBy) onDemote?.(setBy.id);
                else onPromote?.(param.id);
              }}
            >
              {setBy ? '↓' : '↑'}
            </button>
          )}
          {defaults && (
            <button
              type="button"
              className="parameter-reset"
              disabled={!canReset}
              title={
                initial === undefined
                  ? undefined
                  : `Reset to library default (${initial}${param.unit ? ' ' + param.unit : ''})`
              }
              aria-label={`Reset ${param.name} to library default`}
              onClick={(e) => {
                e.preventDefault();
                if (initial !== undefined) onChange(param.id, initial);
              }}
            >
              <RotateCcw size={11} />
            </button>
          )}
        </div>
      </label>
    );
  });
}
