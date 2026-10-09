import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Prisma, RequestPriority, Role } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AppException } from '../../common/app.exception';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { Db } from '../../common/db';
import { Paginated, paginated, skipTake } from '../../common/pagination';
import { hashPassword } from '../../common/password';
import { uniqueViolationFields } from '../../common/prisma-errors';
import { generateToken, sha256 } from '../../common/tokens';
import type { EnvVars } from '../../config/env.validation';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateStaffDto, ListUsersQuery, UpdateProfileDto } from './dto/users.dto';

export const ACTIVATION_TTL_MS = 48 * 60 * 60 * 1000;

/** Fields that are safe to return from the API (never password_hash or the activation token). */
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  phone: true,
  first_name: true,
  last_name: true,
  is_active: true,
  created_at: true,
  roles: { select: { role: true } },
} satisfies Prisma.UserSelect;

type PublicUserRow = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER_SELECT }>;

export interface PublicUser {
  id: string;
  email: string;
  phone: string | null;
  first_name: string;
  last_name: string;
  is_active: boolean;
  created_at: Date;
  roles: Role[];
}

const toPublic = (row: PublicUserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  phone: row.phone,
  first_name: row.first_name,
  last_name: row.last_name,
  is_active: row.is_active,
  created_at: row.created_at,
  roles: row.roles.map((r) => r.role),
});

export interface RegisterCustomerInput {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

export interface CreatedStaff {
  user: PublicUser;
  /** Returned once so the manager can share it; only its hash is stored. */
  activationToken: string;
  activationLink: string;
  activationExpiresAt: Date;
}

export interface UnpaidBalanceCheck {
  /** True for an EMERGENCY request from a customer with an unpaid balance: the dispatcher sees a flag. */
  flagUnpaidBalance: boolean;
  unpaidAmountCents: number;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  // ---------------------------------------------------------------- own profile

  async getMe(userId: string): Promise<PublicUser> {
    const row = await this.prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_USER_SELECT });
    if (!row) throw new NotFoundException('User not found');
    return toPublic(row);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
    try {
      const row = await this.prisma.user.update({
        where: { id: userId },
        data: { first_name: dto.first_name, last_name: dto.last_name, phone: dto.phone },
        select: PUBLIC_USER_SELECT,
      });
      return toPublic(row);
    } catch (err) {
      this.rethrowUnique(err);
      throw err;
    }
  }

  // ---------------------------------------------------------------- registration and invite-only staff

  /** Public registration. Always creates a Customer; the role is never read from the request. */
  async registerCustomer(input: RegisterCustomerInput): Promise<PublicUser> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.prisma.runInTransaction(async (tx) => {
        const row = await tx.user.create({
          data: {
            email: input.email.toLowerCase(),
            phone: input.phone,
            password_hash: passwordHash,
            first_name: input.first_name,
            last_name: input.last_name,
            roles: { create: { role: Role.CUSTOMER } },
            customer_profile: { create: {} },
          },
          select: PUBLIC_USER_SELECT,
        });
        await this.audit.log(
          {
            actorId: row.id,
            action: AuditAction.USER_CREATED,
            entityType: 'user',
            entityId: row.id,
            newValue: { role: Role.CUSTOMER, self_registered: true },
          },
          tx,
        );
        return toPublic(row);
      });
    } catch (err) {
      this.rethrowUnique(err);
      throw err;
    }
  }

  /**
   * Manager-only. Creates an INACTIVE dispatcher or manager with a one-time activation token (48 h).
   * The manager never sets or sees a password: the stored hash belongs to a random value nobody knows.
   */
  async createStaff(dto: CreateStaffDto, actor: AuthenticatedUser): Promise<CreatedStaff> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);
    const unusablePasswordHash = await hashPassword(randomBytes(32).toString('hex'));

    try {
      const user = await this.prisma.runInTransaction(async (tx) => {
        const row = await tx.user.create({
          data: {
            email: dto.email.toLowerCase(),
            phone: dto.phone,
            password_hash: unusablePasswordHash,
            first_name: dto.first_name,
            last_name: dto.last_name,
            is_active: false,
            activation_token_hash: sha256(token),
            activation_expires_at: expiresAt,
            roles: { create: { role: dto.role } },
          },
          select: PUBLIC_USER_SELECT,
        });
        await this.audit.log(
          {
            actorId: actor.id,
            action: AuditAction.USER_CREATED,
            entityType: 'user',
            entityId: row.id,
            newValue: { role: dto.role, invited: true },
          },
          tx,
        );
        return toPublic(row);
      });
      return {
        user,
        activationToken: token,
        activationLink: `${this.config.get('WEB_URL', { infer: true })}/activate?token=${token}`,
        activationExpiresAt: expiresAt,
      };
    } catch (err) {
      this.rethrowUnique(err);
      throw err;
    }
  }

  /** Public (the invitee has no account yet). The token works once and only before it expires. */
  async activateAccount(token: string, password: string): Promise<void> {
    const invalid = () =>
      new AppException('INVALID_ACTIVATION_TOKEN', 'This activation link is invalid or has expired', 400);

    const tokenHash = sha256(token);
    // The hash column is unique, so this is an index lookup, not a table scan.
    const user = await this.prisma.user.findUnique({
      where: { activation_token_hash: tokenHash },
      select: { id: true, is_active: true, activation_expires_at: true },
    });
    if (!user || user.is_active || !user.activation_expires_at || user.activation_expires_at <= new Date()) {
      throw invalid();
    }

    const passwordHash = await hashPassword(password);
    await this.prisma.runInTransaction(async (tx) => {
      // Conditional update: two simultaneous uses of the same link cannot both win.
      const result = await tx.user.updateMany({
        where: {
          id: user.id,
          activation_token_hash: tokenHash,
          is_active: false,
          activation_expires_at: { gt: new Date() },
        },
        data: {
          password_hash: passwordHash,
          is_active: true,
          activation_token_hash: null,
          activation_expires_at: null,
        },
      });
      if (result.count !== 1) throw invalid();
      await this.audit.log(
        {
          actorId: user.id,
          action: AuditAction.ACCOUNT_ACTIVATED,
          entityType: 'user',
          entityId: user.id,
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- manager operations

  async deactivateUser(id: string, actor: AuthenticatedUser): Promise<PublicUser> {
    if (id === actor.id) {
      throw new AppException('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account', 409);
    }
    return this.prisma.runInTransaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: PUBLIC_USER_SELECT });
      if (!target) throw new NotFoundException('User not found');
      if (target.is_active) {
        await this.assertNotLastManager(tx, target);
        await tx.user.update({ where: { id }, data: { is_active: false } });
        await this.audit.log(
          {
            actorId: actor.id,
            action: AuditAction.USER_DEACTIVATED,
            entityType: 'user',
            entityId: id,
            oldValue: { is_active: true },
            newValue: { is_active: false },
          },
          tx,
        );
      }
      return toPublic({ ...target, is_active: false });
    });
  }

  /**
   * Replaces a staff member's role (dispatcher <-> manager). Never on yourself, never on a non-staff account,
   * and never so that the system is left without an active manager. Existing access tokens keep their old
   * roles until they expire (15 minutes).
   */
  async changeRole(id: string, role: Role, actor: AuthenticatedUser): Promise<PublicUser> {
    if (id === actor.id) {
      throw new AppException('CANNOT_CHANGE_OWN_ROLE', 'You cannot change your own role', 403);
    }
    return this.prisma.runInTransaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: PUBLIC_USER_SELECT });
      if (!target) throw new NotFoundException('User not found');
      const oldRoles = target.roles.map((r) => r.role);
      if (!oldRoles.some((r) => r === Role.DISPATCHER || r === Role.MANAGER)) {
        throw new AppException('NOT_STAFF_ACCOUNT', 'Only dispatcher and manager accounts can change role', 409);
      }
      if (role !== Role.MANAGER) await this.assertNotLastManager(tx, target);

      await tx.userRole.deleteMany({ where: { user_id: id, role: { in: [Role.DISPATCHER, Role.MANAGER] } } });
      await tx.userRole.create({ data: { user_id: id, role } });
      await this.audit.log(
        {
          actorId: actor.id,
          action: AuditAction.USER_ROLE_CHANGED,
          entityType: 'user',
          entityId: id,
          oldValue: { roles: oldRoles },
          newValue: { roles: [role] },
        },
        tx,
      );
      return toPublic({ ...target, roles: [{ role }] });
    });
  }

  async listUsers(query: ListUsersQuery): Promise<Paginated<PublicUser>> {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { roles: { some: { role: query.role } } } : {}),
      ...(query.is_active !== undefined ? { is_active: query.is_active } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { first_name: { contains: query.q, mode: 'insensitive' } },
              { last_name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: PUBLIC_USER_SELECT,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(rows.map(toPublic), query.page, query.pageSize, total);
  }

  // ---------------------------------------------------------------- calls from other modules

  /**
   * Blocks NORMAL and URGENT requests while the customer has an unpaid balance. EMERGENCY passes and
   * returns a flag so the dispatcher sees the balance (stored on the request as customer_had_unpaid_balance).
   */
  async assertCanCreateRequest(customerId: string, priority: RequestPriority, tx?: Db): Promise<UnpaidBalanceCheck> {
    const db = tx ?? this.prisma;
    const profile = await db.customerProfile.findUnique({ where: { user_id: customerId } });
    if (!profile || !profile.has_unpaid_balance) {
      return { flagUnpaidBalance: false, unpaidAmountCents: 0 };
    }
    const unpaidAmountCents = Math.round(profile.unpaid_amount.mul(100).toNumber());
    if (priority === RequestPriority.EMERGENCY) {
      return { flagUnpaidBalance: true, unpaidAmountCents };
    }
    throw new AppException(
      'UNPAID_BALANCE',
      'You have an unpaid balance. Please settle it before submitting a new request.',
      403,
      { unpaidAmountCents },
    );
  }

  /** Adds to the customer's unpaid amount and sets the flag. Pass the caller's `tx`. Amounts are integer cents. */
  async addUnpaid(customerId: string, amountCents: number, tx?: Db): Promise<void> {
    this.assertPositiveCents(amountCents);
    const db = tx ?? this.prisma;
    const amount = (amountCents / 100).toFixed(2);
    const rows = await db.$queryRaw<unknown[]>`
      UPDATE customer_profiles
         SET unpaid_amount = unpaid_amount + ${amount}::numeric,
             has_unpaid_balance = true,
             updated_at = now()
       WHERE user_id = ${customerId}
      RETURNING id`;
    if (rows.length === 0) throw new NotFoundException('Customer profile not found');
  }

  /** Subtracts from the unpaid amount (never below zero) and clears the flag when it reaches zero. */
  async clearUnpaid(customerId: string, amountCents: number, tx?: Db): Promise<void> {
    this.assertPositiveCents(amountCents);
    const db = tx ?? this.prisma;
    const amount = (amountCents / 100).toFixed(2);
    const rows = await db.$queryRaw<unknown[]>`
      UPDATE customer_profiles
         SET unpaid_amount = GREATEST(unpaid_amount - ${amount}::numeric, 0),
             has_unpaid_balance = (GREATEST(unpaid_amount - ${amount}::numeric, 0) > 0),
             updated_at = now()
       WHERE user_id = ${customerId}
      RETURNING id`;
    if (rows.length === 0) throw new NotFoundException('Customer profile not found');
  }

  /** For auth: the login record (includes the password hash; never return it from an endpoint). */
  findForLogin(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, password_hash: true, is_active: true, roles: { select: { role: true } } },
    });
  }

  /** For auth: current account state used when refreshing a session. */
  findAuthState(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, is_active: true, password_hash: true, roles: { select: { role: true } } },
    });
  }

  /** For auth: stores a new password hash inside the caller's transaction. */
  async setPasswordHash(userId: string, passwordHash: string, tx?: Db): Promise<void> {
    await (tx ?? this.prisma).user.update({ where: { id: userId }, data: { password_hash: passwordHash } });
  }

  /** For notifications: every active user holding the role. */
  async listActiveUserIdsByRole(role: Role): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { is_active: true, roles: { some: { role } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ---------------------------------------------------------------- helpers

  private assertPositiveCents(amountCents: number): void {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new AppException('INVALID_AMOUNT', 'Amount must be a positive whole number of cents', 400);
    }
  }

  /** Refuses to leave the system without an active manager. */
  private async assertNotLastManager(tx: Prisma.TransactionClient, target: PublicUserRow): Promise<void> {
    const isActiveManager = target.is_active && target.roles.some((r) => r.role === Role.MANAGER);
    if (!isActiveManager) return;
    const others = await tx.user.count({
      where: { id: { not: target.id }, is_active: true, roles: { some: { role: Role.MANAGER } } },
    });
    if (others === 0) {
      throw new AppException('LAST_MANAGER', 'The system must keep at least one active manager', 409);
    }
  }

  private rethrowUnique(err: unknown): void {
    const fields = uniqueViolationFields(err);
    if (!fields) return;
    if (fields.includes('phone')) throw new ConflictException('That phone number is already in use');
    throw new AppException('EMAIL_TAKEN', 'That email is already registered', 409);
  }
}
