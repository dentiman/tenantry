import { createZodDto } from 'nestjs-zod';
import {
  PlatformLoginSchema,
  PlatformAuthResponseSchema,
  PlatformUserResponseSchema,
} from '@saas-skeleton/contracts/platform';

export class PlatformLoginDto extends createZodDto(PlatformLoginSchema) {}
export class PlatformAuthResponseDto extends createZodDto(PlatformAuthResponseSchema) {}
export class PlatformUserResponseDto extends createZodDto(PlatformUserResponseSchema) {}
