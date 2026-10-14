import { createZodDto } from 'nestjs-zod';
import { PostTemplateMessageSchema } from '@saas-skeleton/contracts';

export class PostTemplateMessageDto extends createZodDto(PostTemplateMessageSchema) {}
