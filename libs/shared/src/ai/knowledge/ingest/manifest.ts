import { z } from 'zod';

const relativePath = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'Expected a relative POSIX path without traversal',
  );

export const SourceManifestSchema = z.strictObject({
  sourceKey: z.string().regex(/^[a-z0-9-]+$/),
  product: z.string().regex(/^[a-z0-9-]+$/),
  allowedDirectories: z.array(relativePath).min(1),
  languages: z.array(z.enum(['en', 'ru', 'uk'])).min(1),
  statusPolicy: z.enum(['current-or-approved', 'all-for-testing']).default('current-or-approved'),
  allowedDocumentTypes: z.array(z.string().min(1)).min(1).optional(),
  audienceMapping: z.record(z.string().min(1), z.array(z.enum(['ADMIN', 'USER']))),
  chunking: z
    .strictObject({
      targetTokens: z.number().int().min(64).max(2048),
      overlapTokens: z.number().int().min(0),
    })
    .refine(
      (value) => value.overlapTokens < value.targetTokens / 2,
      'Overlap must be less than half the chunk budget',
    ),
  draftApprovals: z
    .array(
      z.strictObject({
        path: relativePath,
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        reviewer: z.string().trim().min(1),
        reviewAfter: z.iso.date(),
      }),
    )
    .default([]),
});

export type SourceManifest = z.infer<typeof SourceManifestSchema>;
export const DocumentMetadataSchema = z.object({
  title: z.string().trim().min(1),
  canonical_id: z.string().trim().min(1),
  language: z.string().min(1),
  audience: z.array(z.string().min(1)).min(1),
  status: z.string().min(1).optional(),
  doc_type: z.string().min(1).optional(),
  product: z.string().optional(),
  publish: z.boolean().optional(),
  draft: z.boolean().optional(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
