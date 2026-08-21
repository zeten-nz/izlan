import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * AuthorizationRepository — Role / UserRole / RolePermission (TD-26).
 * Permission jadvali YO'Q — permission kodlar RolePermission.permissionCode (string, registry-validated).
 */
@Injectable()
export class AuthorizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  findRoleByCode(code: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).role.findUnique({ where: { code } });
  }

  upsertRole(code: string, name: string, tx?: Prisma.TransactionClient) {
    // Idempotent bootstrap — mavjud role semantikasi buzilmaydi (faqat name yangilanadi).
    return this.db(tx).role.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
  }

  assignRole(userId: string, roleId: string, grantedBy: string | null, tx?: Prisma.TransactionClient) {
    return this.db(tx).userRole.create({ data: { userId, roleId, grantedBy } });
  }

  removeRole(userId: string, roleId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).userRole.deleteMany({ where: { userId, roleId } });
  }

  addRolePermission(roleId: string, permissionCode: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).rolePermission.create({ data: { roleId, permissionCode } });
  }

  /** User → UserRole → Role → RolePermission (effective permission lookup uchun). */
  findUserRolePermissions(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).userRole.findMany({
      where: { userId },
      select: { role: { select: { code: true, permissions: { select: { permissionCode: true } } } } },
    });
  }
}
