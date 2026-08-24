'use client';

import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './primitives';

type LinkProps = ComponentPropsWithoutRef<typeof Link>;

export interface ButtonLinkProps extends Omit<LinkProps, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  className?: string;
}

/**
 * A navigation link that looks like a Button. Renders a real anchor (`next/link`) — proper link semantics, keyboard
 * and middle-click behavior — and shares the exact `buttonClassName` style authority instead of duplicating classes.
 * Never nest a <button> inside; use this for "link styled as button" and `Button` for real actions.
 */
export function ButtonLink({ variant, size, leftIcon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClassName({ variant, size, className })} {...rest}>
      {leftIcon}
      {children}
    </Link>
  );
}
