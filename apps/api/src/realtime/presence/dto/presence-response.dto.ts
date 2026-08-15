import { createZodDto } from 'nestjs-zod';
import { PresenceSnapshotSchema } from '@saas-skeleton/contracts';

export class PresenceSnapshotDto extends createZodDto(PresenceSnapshotSchema) {}
