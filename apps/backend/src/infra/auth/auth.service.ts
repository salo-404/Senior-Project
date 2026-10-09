import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, ProfileStatus, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../common/app.exception';
import { Db } from '../../common/db';
import { hashPassword, verifyPassword } from '../../common/password';
import { sha256 } from '../../common/tokens';
import type { EnvVars } from '../../config/env.validation';
import { PublicUser, UsersService } from '../../modules/users/users.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { AccessTokenPayload } from './guards';
import { TechnicianProfileStatusPort } from './technician-profile-status.port';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface UserForTokens {
  id: string;
  roles: { role: Role }[];
}

export interface SessionResult {
  accessToken: string;
  expiresInSeconds: number;
  /** Goes into the httpOnly cookie; the controller removes it from the response body. */
  refreshToken: string;
  refreshExpiresAt: Date;
  user: { id: string; roles: Role[]; technicianProfileStatus: ProfileStatus | null };
}

@Injectable()
export class AuthService {
  /** Verified when the email is unknown, so timing does not reveal whether an account exists. */
  private readonly dummyHash: Promise<string> = hashPassword('timing-equalizer-not-a-real-password');

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly technicianStatus: TechnicianProfileStatusPort,
  ) {}

  /** Public registration creates a Customer only. */
  register(dto: RegisterDto): Promise<PublicUser> {
    return this.users.registerCustomer(dto);
  }

  async login(dto: LoginDto): Promise<SessionResult> {
    const user = await this.users.findForLogin(dto.email);
    const passwordOk = await verifyPassword(user?.password_hash ?? (await this.dummyHash), dto.password);

    // One identical error for unknown email, wrong password and inactive account.
    if (!user || !passwordOk || !user.is_active) {
      await this.audit.log({
        actorId: user?.id ?? null,
        action: AuditAction.LOGIN_FAILED,
        entityType: 'user',
        entityId: user?.id ?? 'unknown',
        newValue: { reason: !user ? 'UNKNOWN_EMAIL' : !passwordOk ? 'BAD_PASSWORD' : 'INACTIVE' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    const session = await this.prisma.runInTransaction(async (tx) => {
      const tokens = await this.issueTokens(user, tx);
      await this.audit.log(
        { actorId: user.id, action: AuditAction.LOGIN, entityType: 'user', entityId: user.id },
        tx,
      );
      return tokens;
    });
    return this.toSession(user, session);
  }

  /** Rotates the refresh token: the old one is revoked and a new pair is issued. */
  async refresh(refreshToken: string | undefined): Promise<SessionResult> {
    const unauthorized = () => new UnauthorizedException('Invalid or expired session');
    if (!refreshToken) throw unauthorized();

    try {
      await this.jwt.verifyAsync(refreshToken, { secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }) });
    } catch {
      throw unauthorized();
    }

    const tokenHash = sha256(refreshToken);
    const row = await this.prisma.refreshToken.findUnique({ where: { token_hash: tokenHash } });
    if (!row) throw unauthorized();

    if (row.is_revoked) {
      // A revoked token came back: treat it as stolen and end every session of that user.
      await this.revokeAllForUser(row.user_id);
      throw unauthorized();
    }
    if (row.expires_at <= new Date()) throw unauthorized();

    const user = await this.users.findAuthState(row.user_id);
    if (!user || !user.is_active) {
      await this.prisma.refreshToken.updateMany({ where: { id: row.id }, data: { is_revoked: true } });
      throw unauthorized();
    }

    const session = await this.prisma.runInTransaction(async (tx) => {
      // Conditional revoke: two parallel refreshes with the same token cannot both succeed.
      const revoked = await tx.refreshToken.updateMany({
        where: { id: row.id, is_revoked: false },
        data: { is_revoked: true },
      });
      if (revoked.count !== 1) throw unauthorized();
      return this.issueTokens(user, tx);
    });
    return this.toSession(user, session);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { token_hash: sha256(refreshToken) } });
    if (!row) return;
    await this.prisma.runInTransaction(async (tx) => {
      await tx.refreshToken.updateMany({ where: { id: row.id }, data: { is_revoked: true } });
      await this.audit.log(
        { actorId: row.user_id, action: AuditAction.LOGOUT, entityType: 'user', entityId: row.user_id },
        tx,
      );
    });
  }

  /** Verifies the old password, stores the new one and ends every session of the user. */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.users.findAuthState(userId);
    if (!user || !(await verifyPassword(user.password_hash, dto.old_password))) {
      throw new AppException('WRONG_PASSWORD', 'The current password is incorrect', 400);
    }
    if (dto.old_password === dto.new_password) {
      throw new AppException('PASSWORD_UNCHANGED', 'The new password must differ from the current one', 400);
    }
    const newHash = await hashPassword(dto.new_password);
    await this.prisma.runInTransaction(async (tx) => {
      await this.users.setPasswordHash(userId, newHash, tx);
      await tx.refreshToken.updateMany({ where: { user_id: userId, is_revoked: false }, data: { is_revoked: true } });
      await this.audit.log(
        { actorId: userId, action: AuditAction.PASSWORD_CHANGED, entityType: 'user', entityId: userId },
        tx,
      );
    });
  }

  async me(userId: string) {
    const [user, technicianProfileStatus] = await Promise.all([
      this.users.getMe(userId),
      this.technicianStatus.getStatus(userId),
    ]);
    return { ...user, technicianProfileStatus };
  }

  activate(token: string, password: string): Promise<void> {
    return this.users.activateAccount(token, password);
  }

  // ---------------------------------------------------------------- helpers

  private async issueTokens(user: UserForTokens, tx: Db) {
    const roles = user.roles.map((r) => r.role);
    const accessPayload: AccessTokenPayload = { sub: user.id, roles };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: randomUUID() },
      {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
      },
    );
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await tx.refreshToken.create({
      data: { user_id: user.id, token_hash: sha256(refreshToken), expires_at: refreshExpiresAt },
    });
    return { accessToken, refreshToken, refreshExpiresAt };
  }

  private async toSession(
    user: UserForTokens,
    tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
  ): Promise<SessionResult> {
    return {
      ...tokens,
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        roles: user.roles.map((r) => r.role),
        // A PENDING_REVIEW or REJECTED technician may log in and sees only the application status.
        technicianProfileStatus: await this.technicianStatus.getStatus(user.id),
      },
    };
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { user_id: userId, is_revoked: false }, data: { is_revoked: true } });
  }
}
