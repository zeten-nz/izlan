import type { Transition, Variants } from 'framer-motion';

/**
 * ONE small motion system. Fast (120–280ms), subtle, spring-based where spatial. Motion communicates STATE
 * (enter/exit, reorder, open/close) — never decoration. `MotionConfig reducedMotion="user"` (in providers) makes
 * all of this respect the OS "reduce motion" setting automatically.
 */
export const DUR = { fast: 0.14, base: 0.2, slow: 0.28 } as const;
export const EASE_OUT = [0.22, 0.61, 0.36, 1] as const;

export const SPRING: Transition = { type: 'spring', stiffness: 460, damping: 36, mass: 0.7 };
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 320, damping: 30 };

export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE_OUT } },
  exit: { opacity: 0, y: 4, transition: { duration: DUR.fast, ease: EASE_OUT } },
};

export const overlayFade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.fast } },
  exit: { opacity: 0, transition: { duration: DUR.fast } },
};

export const dialogPanel: Variants = {
  initial: { opacity: 0, scale: 0.965, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: SPRING },
  exit: { opacity: 0, scale: 0.98, y: 6, transition: { duration: DUR.fast, ease: EASE_OUT } },
};

export const listItem: Variants = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE_OUT } },
  exit: { opacity: 0, x: -10, transition: { duration: DUR.fast, ease: EASE_OUT } },
};

export const toastItem: Variants = {
  initial: { opacity: 0, y: 14, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: SPRING },
  exit: { opacity: 0, y: 8, scale: 0.97, transition: { duration: DUR.fast, ease: EASE_OUT } },
};

/** Standard press feedback for interactive controls. */
export const tap = { scale: 0.97 };
