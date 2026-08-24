'use client';

/**
 * One selectable answer option (radio for single-choice/true-false, checkbox for multiple-choice). A hidden native
 * input drives real keyboard + group semantics; the visible card shows selection by a filled letter circle (a
 * shape change, not color alone) plus the native checked state. Reused across Placement / Practice / Review.
 */
export function AnswerOption({
  letter,
  text,
  checked,
  disabled,
  type,
  name,
  onChange,
}: {
  letter: string;
  text: string;
  checked: boolean;
  disabled?: boolean;
  type: 'radio' | 'checkbox';
  name?: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3.5 rounded-panel border p-4 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${
        checked ? 'border-primary bg-primary-tint' : 'border-border bg-surface hover:border-primary/40'
      } ${disabled ? 'pointer-events-none opacity-70' : ''}`}
    >
      <input type={type} name={name} className="peer sr-only" checked={checked} onChange={onChange} disabled={disabled} aria-label={text} />
      <span
        aria-hidden
        className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border-[1.5px] text-[12.5px] font-bold ${
          checked ? 'border-primary bg-primary text-primary-fg' : 'border-border text-muted'
        }`}
      >
        {letter}
      </span>
      <span className="text-[15px] text-text">{text}</span>
    </label>
  );
}
