import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../database/prisma.service.js';
import type { LoginDto, LoginResponseDto, SessionResponseDto } from './dto/login.dto.js';
import { PasswordService } from './password.service.js';
import { RATE_LIMIT_KEY, RateLimitService } from './rate-limit.guard.js';
import { SessionService } from './session.service.js';

type RateLimitedRequest = Request & { [RATE_LIMIT_KEY]?: string };

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
  ) {}

  async login(
    dto: LoginDto,
    request: RateLimitedRequest,
  ): Promise<{ response: LoginResponseDto; sessionToken: string }> {
    const identifier = typeof dto.identifier === 'string' ? dto.identifier.trim() : '';
    const password = typeof dto.password === 'string' ? dto.password : '';
    const rateKey = request[RATE_LIMIT_KEY] ?? this.limits.key(identifier, request.ip ?? 'unknown');
    const user = identifier
      ? await this.prisma.user.findFirst({
          where: {
            OR: [
              { username: { equals: identifier, mode: 'insensitive' } },
              { email: { equals: identifier, mode: 'insensitive' } },
            ],
          },
        })
      : null;

    if (!user) {
      await this.passwords.verifyUnknown(password);
      this.rejectLogin(rateKey);
    }

    const passwordMatches = await this.passwords.verify(user.passwordHash, password);
    if (!passwordMatches || user.status !== 'ACTIVE') this.rejectLogin(rateKey);

    this.limits.recordSuccess(rateKey);
    const sessionToken = await this.sessions.create(user.id);
    const response: LoginResponseDto =
      user.accountType === 'SUPPLIER'
        ? { accountType: 'SUPPLIER', landingPath: '/supplier/inbox' }
        : { accountType: 'INTERNAL', landingPath: '/app/workbench' };
    return { response, sessionToken };
  }

  async current(sessionToken: string | undefined): Promise<SessionResponseDto> {
    if (!sessionToken) this.sessionRequired();
    const session = await this.sessions.resolve(sessionToken);
    if (!session) this.sessionRequired();
    return {
      user: {
        id: session.user.id,
        organizationId: session.user.organizationId,
        accountType: session.user.accountType,
      },
    };
  }

  private rejectLogin(rateKey: string): never {
    this.limits.recordFailure(rateKey);
    throw new HttpException(
      { code: 'AUTH_INVALID_CREDENTIALS', message: '账号或密码错误' },
      401,
    );
  }

  private sessionRequired(): never {
    throw new HttpException(
      { code: 'AUTH_SESSION_REQUIRED', message: '请先登录' },
      401,
    );
  }
}
