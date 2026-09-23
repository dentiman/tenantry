import { createZodDto } from 'nestjs-zod';
import { PostChatMessageSchema } from '@saas-skeleton/contracts';

export class PostChatMessageDto extends createZodDto(PostChatMessageSchema) {}
