import type { z } from 'zod';
import type {
  UserOperationErrorCodeSchema,
  UserOperationListQuerySchema,
  UserOperationListResponseSchema,
  UserOperationResponseSchema,
  UserOperationResultUrlResponseSchema,
  UserOperationStatusSchema,
  UserOperationStepSchema,
} from './user-operation.schema';

export type UserOperationStatus = z.infer<typeof UserOperationStatusSchema>;
export type UserOperationStep = z.infer<typeof UserOperationStepSchema>;
export type UserOperationErrorCode = z.infer<typeof UserOperationErrorCodeSchema>;
export type UserOperationResponse = z.infer<typeof UserOperationResponseSchema>;
export type UserOperationListQuery = z.infer<typeof UserOperationListQuerySchema>;
export type UserOperationListResponse = z.infer<typeof UserOperationListResponseSchema>;
export type UserOperationResultUrlResponse = z.infer<typeof UserOperationResultUrlResponseSchema>;
