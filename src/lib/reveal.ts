// Lightweight reveal for V1.2 components: one IntersectionObserver per scope, CSS transitions only.
// The hiding class (html.js-reveal) is added only when this runs and motion is allowed, so content is
// always visible if JavaScript or the observer fails.
import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion } from './prefs';

export function useReveal(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal], .mask-reveal, [data-sheen]'));
    if (root.matches('[data-reveal], .mask-reveal, [data-sheen]')) items.push(root);
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      items.forEach((el) => el.classList.add('is-in'));
      return;
    }
    document.documentElement.classList.add('js-reveal');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    items.forEach((el) => io.observe(el));
    // Safety net: never leave content hidden (e.g. observer never fires in an embedded view).
    const t = window.setTimeout(() => items.forEach((el) => el.classList.add('is-in')), 4000);
    return () => {
      io.disconnect();
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
