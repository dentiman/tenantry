import type { z } from 'zod';
import type {
  PlatformLoginSchema,
  PlatformUserResponseSchema,
  PlatformAuthResponseSchema,
  PlatformAuthTokensSchema,
} from './platform-auth.schema';

export type PlatformLogin = z.infer<typeof PlatformLoginSchema>;
export type PlatformUserResponse = z.infer<typeof PlatformUserResponseSchema>;
export type PlatformAuthResponse = z.infer<typeof PlatformAuthResponseSchema>;
export type PlatformAuthTokens = z.infer<typeof PlatformAuthTokensSchema>;
