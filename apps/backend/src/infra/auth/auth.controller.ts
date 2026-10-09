import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AppException } from '../../common/app.exception';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { ActivateAccountDto } from '../../modules/users/dto/users.dto';
import { AuthService, SessionResult } from './auth.service';
import { CurrentUser, Public } from './decorators';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

export const REFRESH_COOKIE = 'refresh_token';

/** httpOnly + Secure + SameSite=Strict, limited to the auth routes (the API lives under /api/v1). */
const cookieBase: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/v1/auth',
};

/** Read lazily so the limit follows the validated environment (default 5 attempts per minute). */
const loginLimit = (): number => Number(process.env.LOGIN_RATE_LIMIT) || 5;
const ONE_MINUTE = 60_000;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: loginLimit, ttl: ONE_MINUTE } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  /** TODO(week 2): implemented with the technicians module (profile + INITIAL_APPLICATION tier request). */
  @Public()
  @Throttle({ default: { limit: loginLimit, ttl: ONE_MINUTE } })
  @Post('register/technician')
  registerTechnician(): never {
    throw new AppException('NOT_IMPLEMENTED', 'Technician registration is not available yet', 501);
  }

  @Public()
  @Throttle({ default: { limit: loginLimit, ttl: ONE_MINUTE } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: ONE_MINUTE } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, cookieBase);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, cookieBase);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(user.id, dto);
    res.clearCookie(REFRESH_COOKIE, cookieBase);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  @Public()
  @Throttle({ default: { limit: loginLimit, ttl: ONE_MINUTE } })
  @Post('activate')
  @HttpCode(204)
  async activate(@Body() dto: ActivateAccountDto): Promise<void> {
    await this.auth.activate(dto.token, dto.password);
  }

  private respond(res: Response, session: SessionResult) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieBase, expires: session.refreshExpiresAt });
    return {
      accessToken: session.accessToken,
      expiresInSeconds: session.expiresInSeconds,
      user: session.user,
    };
  }
}
