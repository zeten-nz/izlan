/** Request principal (§10) — minimal. To'liq Prisma User request'ga biriktirilmaydi. */
export interface AuthPrincipal {
  userId: string;
  sessionId: string;
}

/** Fastify request'ga guard biriktiradigan maydon. */
export interface RequestWithPrincipal {
  authPrincipal?: AuthPrincipal;
}
