import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { AccessTokenService } from '../access-token/access-token.service';
import { AuthorizationService } from '../../authorization/authorization.service';
import { AccessTokenInvalidError } from '../../common/errors';
import { PERMISSIONS_KEY } from './decorators';

function ctxWith(headers: Record<string, string | undefined>, store: { authPrincipal?: unknown } = {}): ExecutionContext {
  const req = { headers, ...store };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const principal = { userId: 'u1', sessionId: 's1' };
  const accessToken = { verifyAccessToken: jest.fn() } as unknown as AccessTokenService;
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
  const guard = new AuthGuard(reflector, accessToken);

  beforeEach(() => jest.clearAllMocks());

  it('allows @Public routes without token', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValueOnce(true);
    expect(guard.canActivate(ctxWith({}))).toBe(true);
  });

  it('rejects missing Authorization', () => {
    expect(() => guard.canActivate(ctxWith({}))).toThrow(AccessTokenInvalidError);
  });

  it('rejects wrong scheme', () => {
    expect(() => guard.canActivate(ctxWith({ authorization: 'Basic abc' }))).toThrow(AccessTokenInvalidError);
  });

  it('attaches principal on valid bearer', () => {
    (accessToken.verifyAccessToken as jest.Mock).mockReturnValue(principal);
    const req: { authPrincipal?: unknown } = {};
    const ctx = ctxWith({ authorization: 'Bearer good' }, req);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('propagates invalid token error', () => {
    (accessToken.verifyAccessToken as jest.Mock).mockImplementation(() => {
      throw new AccessTokenInvalidError('bad');
    });
    expect(() => guard.canActivate(ctxWith({ authorization: 'Bearer bad' }))).toThrow(AccessTokenInvalidError);
  });
});

describe('PermissionsGuard', () => {
  const authz = { hasAllPermissions: jest.fn() } as unknown as AuthorizationService;
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new PermissionsGuard(reflector, authz);

  beforeEach(() => jest.clearAllMocks());

  it('passes when no metadata', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    expect(await guard.canActivate(ctxWith({}, { authPrincipal: { userId: 'u1' } }))).toBe(true);
  });

  it('passes when all permissions present', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['a', 'b']);
    (authz.hasAllPermissions as jest.Mock).mockResolvedValue(true);
    expect(await guard.canActivate(ctxWith({}, { authPrincipal: { userId: 'u1' } }))).toBe(true);
    expect(authz.hasAllPermissions).toHaveBeenCalledWith('u1', ['a', 'b']);
  });

  it('403 when a required permission missing (no magic ADMIN bypass)', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['a']);
    (authz.hasAllPermissions as jest.Mock).mockResolvedValue(false);
    await expect(guard.canActivate(ctxWith({}, { authPrincipal: { userId: 'admin-user' } }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 when principal missing', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['a']);
    await expect(guard.canActivate(ctxWith({}, {}))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
