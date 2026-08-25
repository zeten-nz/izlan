import type { AdminUserDetailRow, AdminUserListRow } from './admin-users.repository';

/**
 * Safe Admin-user projections (Phase 07C1). Only the approved Admin-UX fields are emitted. There is deliberately no
 * password/OTP/DOB/session-token/security-payload field — the shapes below are the ONLY thing serialized.
 */
export interface AdminUserListItem {
  id: string;
  displayName: string | null;
  phone: string; // canonical E.164
  status: string; // UserStatus
  roles: string[]; // canonical role codes
  onboardingCompleted: boolean;
  createdAt: string; // ISO-8601
  lastLoginAt: string | null;
}

export interface AdminUserDetail {
  id: string;
  displayName: string | null;
  phone: string;
  status: string;
  onboardingCompleted: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  roles: { code: string; grantedAt: string }[];
  subjectAssignments: { subjectId: string; title: string }[];
  activeSessionCount: number; // aggregate only — never session ids/tokens
}

export function presentListItem(r: AdminUserListRow): AdminUserListItem {
  return {
    id: r.id,
    displayName: r.profile?.displayName ?? null,
    phone: r.phone,
    status: r.status,
    roles: r.roles.map((x) => x.role.code),
    onboardingCompleted: Boolean(r.profile?.onboardingCompletedAt),
    createdAt: r.createdAt.toISOString(),
    lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
  };
}

export function presentDetail(r: AdminUserDetailRow, activeSessionCount: number): AdminUserDetail {
  return {
    id: r.id,
    displayName: r.profile?.displayName ?? null,
    phone: r.phone,
    status: r.status,
    onboardingCompleted: Boolean(r.profile?.onboardingCompletedAt),
    createdAt: r.createdAt.toISOString(),
    lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
    roles: r.roles.map((x) => ({ code: x.role.code, grantedAt: x.grantedAt.toISOString() })),
    subjectAssignments: r.subjectAssignments.map((a) => ({ subjectId: a.subjectId, title: a.subject.title })),
    activeSessionCount,
  };
}
