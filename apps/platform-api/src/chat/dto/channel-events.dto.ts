import { createZodDto } from 'nestjs-zod';
import {
  ChannelUnroutableListQuerySchema,
  ChannelUnroutableListResponseSchema,
} from '@saas-skeleton/contracts/platform';

export class ChannelUnroutableListQueryDto extends createZodDto(ChannelUnroutableListQuerySchema) {}
export class ChannelUnroutableListResponseDto extends createZodDto(
  ChannelUnroutableListResponseSchema,
) {}
