import { createZodDto } from 'nestjs-zod';
import { AuthResponseSchema, AuthTokensSchema, MeResponseSchema } from '@saas-skeleton/contracts';

export class AuthResponseDto extends createZodDto(AuthResponseSchema) {}
export class AuthTokensDto extends createZodDto(AuthTokensSchema) {}
export class MeResponseDto extends createZodDto(MeResponseSchema) {}
