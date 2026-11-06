import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from '@phosphor-icons/react';
import { copyText } from '../lib/clipboard';

interface Props {
  text: string | (() => string);
  children: ReactNode;
  doneLabel?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  iconOnly?: boolean;
}

export function CopyButton({ text, children, doneLabel = 'Copied', className = 'btn', disabled, ariaLabel, iconOnly }: Props) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function onClick() {
    const ok = await copyText(typeof text === 'function' ? text() : text);
    setState(ok ? 'done' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  }

  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {state === 'done' ? <Check size={16} weight="bold" aria-hidden /> : <Copy size={16} weight="regular" aria-hidden />}
      {!iconOnly && <span>{state === 'done' ? doneLabel : state === 'failed' ? 'Copy failed' : children}</span>}
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'done' ? doneLabel : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </button>
  );
}
