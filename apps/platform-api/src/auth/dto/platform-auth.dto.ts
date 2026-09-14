import { createZodDto } from 'nestjs-zod';
import {
  PlatformLoginSchema,
  PlatformAuthResponseSchema,
  PlatformAuthTokensSchema,
  PlatformUserResponseSchema,
} from '@saas-skeleton/contracts/platform';

export class PlatformLoginDto extends createZodDto(PlatformLoginSchema) {}
export class PlatformAuthResponseDto extends createZodDto(PlatformAuthResponseSchema) {}
export class PlatformAuthTokensDto extends createZodDto(PlatformAuthTokensSchema) {}
export class PlatformUserResponseDto extends createZodDto(PlatformUserResponseSchema) {}
