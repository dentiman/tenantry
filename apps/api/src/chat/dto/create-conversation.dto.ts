import { createZodDto } from 'nestjs-zod';
import { CreateConversationSchema } from '@saas-skeleton/contracts';

export class CreateConversationDto extends createZodDto(CreateConversationSchema) {}
