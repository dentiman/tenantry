import { createZodDto } from 'nestjs-zod';
import {
  NumberSeriesListResponseSchema,
  NumberSeriesResponseSchema,
  SetNextNumberSchema,
  UpdateNumberSeriesSchema,
} from '@saas-skeleton/contracts';

export class UpdateNumberSeriesDto extends createZodDto(UpdateNumberSeriesSchema) {}
export class SetNextNumberDto extends createZodDto(SetNextNumberSchema) {}
export class NumberSeriesResponseDto extends createZodDto(NumberSeriesResponseSchema) {}
export class NumberSeriesListResponseDto extends createZodDto(NumberSeriesListResponseSchema) {}
