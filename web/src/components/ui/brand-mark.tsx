/**
 * The two-square Izlan brand mark — shared visual identity across the auth / onboarding / learner shells.
 * Presentation only (aria-hidden); pair it with a visible "Izlan" wordmark for the accessible name.
 * At the default size (26) it is pixel-identical to the frozen auth/onboarding mark.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  const square = Math.round((size * 17) / 26);
  const dot = Math.round((size * 13) / 26);
  const radius = Math.max(3, Math.round((size * 5) / 26));
  return (
    <span className="relative inline-block" style={{ height: size, width: size }} aria-hidden>
      <span className="absolute left-0 top-0 bg-primary" style={{ height: square, width: square, borderRadius: radius }} />
      <span className="absolute bottom-0 right-0 rounded-full border-2 border-primary bg-surface" style={{ height: dot, width: dot }} />
    </span>
  );
}
