import { Body, Controller, Get, Patch, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * Own-profile API (§4/6). Global AuthGuard → authenticated. Permission code TALAB QILINMAYDI
 * (user o'ziga ta'sir qiladi). Target userId REQUEST'dan OLINMAYDI — faqat principal.userId (IDOR himoya).
 * `/auth/me` (minimal auth bootstrap) bilan aralashtirilmaydi.
 */
@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get('me')
  async me(@CurrentPrincipal() principal: AuthPrincipal, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('Cache-Control', 'no-store'); // PII — shared cache YO'Q (§44)
    return this.profile.getMyProfile(principal.userId);
  }

  @Patch('me')
  async update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: UpdateProfileDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('Cache-Control', 'no-store');
    return this.profile.updateMyProfile(principal.userId, dto);
  }
}
