import type { z } from 'zod';
import type {
  CustomerKindSchema,
  CustomerStatusSchema,
  CreateCustomerSchema,
  UpdateCustomerSchema,
  SetCustomerStatusSchema,
  CustomerQuerySchema,
  CreateCustomerContactSchema,
  UpdateCustomerContactSchema,
  CustomerContactResponseSchema,
  CustomerResponseSchema,
  CustomerDetailResponseSchema,
  CustomerListResponseSchema,
} from './customer.schema';

export type CustomerKind = z.infer<typeof CustomerKindSchema>;
export type CustomerStatus = z.infer<typeof CustomerStatusSchema>;
export type CreateCustomer = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomer = z.infer<typeof UpdateCustomerSchema>;
export type SetCustomerStatus = z.infer<typeof SetCustomerStatusSchema>;
export type CustomerQuery = z.infer<typeof CustomerQuerySchema>;
export type CreateCustomerContact = z.infer<typeof CreateCustomerContactSchema>;
export type UpdateCustomerContact = z.infer<typeof UpdateCustomerContactSchema>;
export type CustomerContactResponse = z.infer<typeof CustomerContactResponseSchema>;
export type CustomerResponse = z.infer<typeof CustomerResponseSchema>;
export type CustomerDetailResponse = z.infer<typeof CustomerDetailResponseSchema>;
export type CustomerListResponse = z.infer<typeof CustomerListResponseSchema>;
