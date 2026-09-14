'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  browserCopyDragHost,
  installCopyDrag,
  type CopyDragProps,
} from '@/lib/gradara/copy-drag';

/** Pointer-rate previews stay below the workbench; release creates one edit. */
export default function CopyDragLayer(props: CopyDragProps) {
  const flow = useReactFlow();
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  }, [props]);
  useEffect(
    () =>
      installCopyDrag(() => latest.current, flow, browserCopyDragHost(window)),
    [flow],
  );
  return null;
}
