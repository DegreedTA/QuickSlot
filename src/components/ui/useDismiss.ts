import { useEffect, type RefObject } from 'react';

/** Close a popover on Escape or a press outside it. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const press = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', press);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', press);
    };
  }, [ref, open, onClose]);
}
