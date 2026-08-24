import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { OtpInput } from './OtpInput';

/** Controlled harness so the OtpInput behaves as it does in the real forms. */
function Harness({ onChangeSpy }: { onChangeSpy?: (v: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <I18nProvider>
      <OtpInput
        value={code}
        onChange={(v) => {
          setCode(v);
          onChangeSpy?.(v);
        }}
      />
    </I18nProvider>
  );
}

/** Typed box accessor — getAllByRole is a live query, so re-reading returns the same DOM nodes. */
function boxes(): HTMLInputElement[] {
  return screen.getAllByRole('textbox') as HTMLInputElement[];
}

describe('OtpInput (WEB-OTP)', () => {
  it('WEB-OTP-01 renders exactly six labeled digit boxes in one group', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Tasdiqlash kodi' })).toBeInTheDocument();
    expect(boxes()).toHaveLength(6);
  });

  it('WEB-OTP-02 typing a digit fills the box and advances focus', () => {
    render(<Harness />);
    const b = boxes();
    fireEvent.change(b[0]!, { target: { value: '1' } });
    expect(b[0]!).toHaveValue('1');
    expect(b[1]!).toHaveFocus();
    fireEvent.change(b[1]!, { target: { value: '2' } });
    expect(b[1]!).toHaveValue('2');
    expect(b[2]!).toHaveFocus();
  });

  it('WEB-OTP-03 non-digit input is ignored', () => {
    render(<Harness />);
    const b = boxes();
    fireEvent.change(b[0]!, { target: { value: 'a' } });
    expect(b[0]!).toHaveValue('');
  });

  it('WEB-OTP-04 Backspace on an empty box clears and focuses the previous box', () => {
    render(<Harness />);
    const b = boxes();
    fireEvent.change(b[0]!, { target: { value: '1' } });
    fireEvent.change(b[1]!, { target: { value: '2' } }); // focus now on box 2 (empty)
    fireEvent.keyDown(b[2]!, { key: 'Backspace' });
    expect(b[1]!).toHaveValue('');
    expect(b[1]!).toHaveFocus();
  });

  it('WEB-OTP-05 Backspace on a filled box clears it in place', () => {
    render(<Harness />);
    const b = boxes();
    fireEvent.change(b[0]!, { target: { value: '5' } });
    b[0]!.focus();
    fireEvent.keyDown(b[0]!, { key: 'Backspace' });
    expect(b[0]!).toHaveValue('');
  });

  it('WEB-OTP-06 arrow keys move focus without changing values', () => {
    render(<Harness />);
    const b = boxes();
    b[0]!.focus();
    fireEvent.keyDown(b[0]!, { key: 'ArrowRight' });
    expect(b[1]!).toHaveFocus();
    fireEvent.keyDown(b[1]!, { key: 'ArrowLeft' });
    expect(b[0]!).toHaveFocus();
  });

  it('WEB-OTP-07 pasting a full 6-digit code fills every box and emits the whole value', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const b = boxes();
    fireEvent.paste(b[0]!, { clipboardData: { getData: () => '654321' } });
    '654321'.split('').forEach((d, i) => expect(b[i]!).toHaveValue(d));
    expect(spy).toHaveBeenLastCalledWith('654321');
  });

  it('WEB-OTP-08 pasting a spaced/however-formatted code keeps only its digits', () => {
    render(<Harness />);
    const b = boxes();
    fireEvent.paste(b[0]!, { clipboardData: { getData: () => '12 34-56' } });
    '123456'.split('').forEach((d, i) => expect(b[i]!).toHaveValue(d));
  });
});
