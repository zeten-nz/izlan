import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LinearProgress, StepProgress, MasteryProgress, clampPercent } from './index';

describe('Progress family (WEB-PROG)', () => {
  it('WEB-PROG-01 clampPercent clamps to 0..100 and guards bad input', () => {
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(34, 68)).toBe(50);
    expect(clampPercent(1, 0)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it('WEB-PROG-02 LinearProgress has progressbar semantics and clamps aria-valuenow', () => {
    render(<LinearProgress value={150} label="Reading" showValue />);
    const bar = screen.getByRole('progressbar', { name: 'Reading' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('WEB-PROG-03 StepProgress renders every label and marks the current step (not color-only)', () => {
    render(<StepProgress steps={['Profil', 'Yo‘nalish', 'Daraja']} current={1} />);
    expect(screen.getByText('Profil')).toBeInTheDocument();
    expect(screen.getByText('Daraja')).toBeInTheDocument();
    expect(screen.getByText('Yo‘nalish').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Daraja').closest('li')).not.toHaveAttribute('aria-current');
  });

  it('WEB-PROG-04 MasteryProgress surfaces value + qualitative level via aria-valuetext', () => {
    render(<MasteryProgress value={68} label="Grammar" levelLabel="Yaxshi" />);
    const bar = screen.getByRole('progressbar', { name: 'Grammar' });
    expect(bar).toHaveAttribute('aria-valuenow', '68');
    expect(bar).toHaveAttribute('aria-valuetext', '68% — Yaxshi');
    expect(screen.getByText('Yaxshi')).toBeInTheDocument();
  });
});
