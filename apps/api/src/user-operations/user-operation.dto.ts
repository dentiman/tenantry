import { createZodDto } from 'nestjs-zod';
import {
  UserOperationListQuerySchema,
  UserOperationListResponseSchema,
  UserOperationResponseSchema,
  UserOperationResultUrlResponseSchema,
} from '@saas-skeleton/contracts';

export class UserOperationResponseDto extends createZodDto(UserOperationResponseSchema) {}
export class UserOperationListQueryDto extends createZodDto(UserOperationListQuerySchema) {}
export class UserOperationListResponseDto extends createZodDto(UserOperationListResponseSchema) {}
export class UserOperationResultUrlResponseDto extends createZodDto(
  UserOperationResultUrlResponseSchema,
) {}
