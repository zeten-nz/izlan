import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Guard: no test may depend on real network. Individual tests stub globalThis.fetch explicitly.
afterEach(() => {
  cleanup();
});
