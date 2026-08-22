'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiX } from 'react-icons/fi';
import { Button, IconButton } from './primitives';
import { useT } from '@/lib/i18n/i18n-context';
import { dialogPanel, overlayFade } from '@/lib/motion/motion';

/**
 * Accessible modal dialog: role="dialog" aria-modal, Escape closes, initial focus moves inside, background scroll
 * locked, overlay click closes. Animated open/close (spring panel + fade overlay), reduced-motion aware.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>('input,textarea,select,button,[tabindex]:not([tabindex="-1"])');
      focusable?.focus();
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(timer);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div variants={overlayFade} initial="initial" animate="animate" exit="exit" className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
          <motion.div
            ref={panelRef}
            variants={dialogPanel}
            initial="initial"
            animate="animate"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`izl-elevate relative z-10 w-full ${width} rounded-card border border-border bg-surface`}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-base font-semibold text-text">{title}</h2>
              <IconButton label={t('common.close')} onClick={onClose}>
                <FiX aria-hidden />
              </IconButton>
            </div>
            <div className="izl-scroll max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Confirmation dialog with optional required reason field. Returns the reason via onConfirm. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  danger = false,
  requireReason = false,
  reasonLabel,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  busy?: boolean;
}) {
  const t = useT();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const canConfirm = !requireReason || reason.trim().length > 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => onConfirm(reason.trim())} disabled={!canConfirm} loading={busy}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-text">
        <div className="leading-relaxed text-muted">{message}</div>
        {requireReason && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-reason" className="font-medium">
              {reasonLabel ?? t('common.reason')}
            </label>
            <textarea
              id="confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              placeholder={t('common.reasonPlaceholder')}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
