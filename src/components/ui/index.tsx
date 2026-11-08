import {
  useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type HTMLAttributes,
} from 'react';
import { CaretDown, Check, Copy } from '@phosphor-icons/react';
import { copyText } from '../../lib/clipboard';

const cx = (...a: Array<string | false | undefined>) => a.filter(Boolean).join(' ');

/* Button (pill) */
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export function Button({
  size = 'md', variant = 'primary', className, type = 'button', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: ButtonSize; variant?: ButtonVariant }) {
  return <button type={type} className={cx('ds-btn', `ds-btn-${size}`, `ds-btn-${variant}`, className)} {...rest} />;
}

/* Tooltip: hover or keyboard focus, after 300ms, above and centered */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 300);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  return (
    <span
      className="ds-tip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && hide()}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span role="tooltip" id={id} className="ds-tip">
          {label}
        </span>
      )}
    </span>
  );
}

/* IconButton: aria-label required; tooltip shows the label */
export function IconButton({
  label, tooltip, icon, className, type = 'button', ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & { label: string; tooltip?: string; icon: ReactNode }) {
  return (
    <Tooltip label={tooltip ?? label}>
      <button type={type} aria-label={label} className={cx('ds-icon-btn', className)} {...rest}>
        {icon}
      </button>
    </Tooltip>
  );
}

/* CopyIconButton: IconButton whose tooltip reads "Copied" for 1.5s after click */
export function CopyIconButton({ text, label = 'Copy link' }: { text: string | (() => string); label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function onClick() {
    const ok = await copyText(typeof text === 'function' ? text() : text);
    if (!ok) return;
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1500);
  }
  return (
    <>
      <IconButton
        label={label}
        tooltip={done ? 'Copied' : label}
        onClick={onClick}
        icon={done ? <Check weight="bold" aria-hidden /> : <Copy weight="bold" aria-hidden />}
      />
      <span className="sr-only" role="status" aria-live="polite">{done ? 'Copied' : ''}</span>
    </>
  );
}

/* TextInput */
export function TextInput({ label, id, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className="ds-field">
      <label className="ds-label" htmlFor={inputId}>{label}</label>
      <input id={inputId} className={cx('ds-input', className)} {...rest} />
    </div>
  );
}

/* Select (pill). size="lg" is the candidate-page variant (48px, 16px/600) */
export function Select({ size = 'md', className, children, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: 'md' | 'lg' }) {
  return (
    <span className={cx('ds-select-wrap', size === 'lg' && 'ds-select-lg')}>
      <select className={cx('ds-select', className)} {...rest}>{children}</select>
      <CaretDown weight="bold" aria-hidden />
    </span>
  );
}

/* Card */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('ds-card', className)} {...rest} />;
}

/* StatusChip */
export const STATUSES = {
  'New update': 'new',
  'Waiting for picks': 'waiting',
  'Waiting for availability': 'waiting',
  'Up to date': 'ok',
  'Few valid times this week': 'few',
  'No valid times this week': 'none',
} as const;
export type Status = keyof typeof STATUSES;
export function StatusChip({ status }: { status: Status }) {
  return <span className={`ds-chip ds-chip-${STATUSES[status]}`}>{status}</span>;
}
