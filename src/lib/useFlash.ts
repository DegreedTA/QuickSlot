import { useEffect, useRef } from 'react';

/**
 * A quick blink on an element whenever `dep` changes (not on first render), so a change of time zone
 * reads as "recalculating, done". Honors reduced motion with a much gentler fade.
 */
export function useFlashOnChange<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const prev = useRef(dep);
  useEffect(() => {
    if (Object.is(prev.current, dep)) return;
    prev.current = dep;
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const a = el.animate(
      reduce ? [{ opacity: 0.7 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0.2, offset: 0.35 }, { opacity: 1 }],
      { duration: reduce ? 200 : 480, easing: 'ease-in-out' },
    );
    return () => a.cancel();
  }, [dep]);
  return ref;
}
