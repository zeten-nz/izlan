/**
 * Dev-only demo login helper (§21, TD-252). Enabled ONLY when NEXT_PUBLIC_ENABLE_DEMO_ACCOUNTS=true and NOT in a
 * production build — so it can never appear in production. It fills the phone field ONLY; the password is entered by
 * the operator (from local .env) and is NEVER embedded in the frontend, and it never auto-logs-in.
 */
export function demoAccountsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_DEMO_ACCOUNTS === 'true' && process.env.NODE_ENV !== 'production';
}

export interface DemoAccount {
  labelKey: string;
  phone: string; // fills the phone input only
  display: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { labelKey: 'auth.demoAdmin', phone: '+998900000001', display: '+998 90 000 00 01' },
  { labelKey: 'auth.demoMethodist', phone: '+998900000002', display: '+998 90 000 00 02' },
];

/** Learner login demo helper (§48) — the learner demo account only (staff login keeps Admin/Methodist). Phone-only fill. */
export const DEMO_LEARNER_ACCOUNTS: DemoAccount[] = [
  { labelKey: 'learner.login.demoLearner', phone: '+998900000003', display: '+998 90 000 00 03' },
];
