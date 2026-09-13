/// <reference types="jest" />

import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
// MT-2: прямі доступи тестів — під BYPASSRLS (поза tenant-контекстом RLS дав би 0 рядків)
import { SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser, DEFAULT_TENANT_ID } from './test-users';
import { StorageService } from '@saas-skeleton/shared';

/**
 * In-memory підміна StorageService: e2e не потребують живого S3 (SeaweedFS немає в CI).
 * "Браузерний PUT" емулюється прямим записом байтів у Map — сам presigned-протокол
 * (підписи, CORS) перевіряється живою верифікацією, не тестами.
 */
class FakeStorageService {
  readonly bucket = 'test-bucket';
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  onModuleInit(): Promise<void> {
    return Promise.resolve();
  }

  // MT-1: сигнатура реального StorageService.buildObjectKey (tenant-префікс);
  // у фейку tenant-контекст не читаємо — достатньо детермінованого префікса
  buildObjectKey(filename: string): string {
    const ext = filename.includes('.') ? `.${filename.split('.').pop() ?? ''}` : '';
    return `${DEFAULT_TENANT_ID}/test/${randomUUID()}${ext}`;
  }
  getUploadUrl(key: string): Promise<string> {
    return Promise.resolve(`http://storage.test/upload/${encodeURIComponent(key)}?sig=fake`);
  }
  getDownloadUrl(key: string): Promise<string> {
    return Promise.resolve(`http://storage.test/download/${encodeURIComponent(key)}?sig=fake`);
  }
  headObject(key: string): Promise<{ size: number } | null> {
    const object = this.objects.get(key);
    return Promise.resolve(object ? { size: object.body.byteLength } : null);
  }
  readObjectHead(key: string, maxBytes: number): Promise<Uint8Array> {
    return Promise.resolve(this.objects.get(key)?.body.slice(0, maxBytes) ?? new Uint8Array());
  }
  readObject(key: string): Promise<Uint8Array> {
    return Promise.resolve(this.objects.get(key)?.body ?? new Uint8Array());
  }
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }
  deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  // Тестові хелпери
  has(key: string): boolean {
    return this.objects.has(key);
  }
  clear(): void {
    this.objects.clear();
  }
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const TEXT_BYTES = new Uint8Array(Buffer.from('just some text, not an image'));

describe('Files API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;
  const storage = new FakeStorageService();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);

    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    storage.clear();
    await prisma.attachment.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.file.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const createAuthHeaders = async (suffix: string): Promise<{ Authorization: string }> => {
    // MT-1: register видалено — юзер створюється напряму і логіниться
    const { tokens } = await createAndLoginTestUser(app, prisma, {
      email: `files-${suffix}@example.com`,
      password: 'SecurePass123',
      name: null,
    });
    return { Authorization: `Bearer ${tokens.accessToken}` };
  };

  const initUpload = async (
    headers: { Authorization: string },
    overrides: Partial<{ filename: string; mimeType: string; size: number }> = {},
  ): Promise<{ fileId: string; key: string; uploadUrl: string }> => {
    const response = await request(app.getHttpServer())
      .post('/api/files')
      .set(headers)
      .send({
        filename: 'photo.png',
        mimeType: 'image/png',
        size: PNG_BYTES.byteLength,
        ...overrides,
      })
      .expect(201);

    const fileId = String(response.body.file.id);
    // key назовні не віддається — тест бере його з БД (як зробив би worker)
    const row = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    return { fileId, key: row.key, uploadUrl: String(response.body.uploadUrl) };
  };

  it('requires auth', async () => {
    await request(app.getHttpServer())
      .post('/api/files')
      .send({ filename: 'a.png', mimeType: 'image/png', size: 10 })
      .expect(401);
  });

  it('rejects MIME outside the allowlist', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-mime`);
    const response = await request(app.getHttpServer())
      .post('/api/files')
      .set(headers)
      .send({ filename: 'run.exe', mimeType: 'application/x-msdownload', size: 10 })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'mimeType' })]),
    );
  });

  it('creates a PENDING file and returns an upload URL', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-create`);
    const response = await request(app.getHttpServer())
      .post('/api/files')
      .set(headers)
      .send({ filename: 'photo.png', mimeType: 'image/png', size: 123 })
      .expect(201);

    expect(response.body.uploadUrl).toContain('http');
    expect(response.body.file).toMatchObject({
      filename: 'photo.png',
      mimeType: 'image/png',
      size: 123,
      status: 'PENDING',
      hasThumbnail: false,
    });
    // key — внутрішня деталь сховища, назовні не витікає
    expect(response.body.file.key).toBeUndefined();
  });

  it('completes an upload after bytes land in storage (idempotent)', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-complete`);
    const { fileId, key } = await initUpload(headers);
    await storage.putObject(key, PNG_BYTES, 'image/png');

    const response = await request(app.getHttpServer())
      .post(`/api/files/${fileId}/complete`)
      .set(headers)
      .expect(200);
    expect(response.body.status).toBe('READY');

    // Повторний complete — no-op, той самий READY
    const again = await request(app.getHttpServer())
      .post(`/api/files/${fileId}/complete`)
      .set(headers)
      .expect(200);
    expect(again.body.status).toBe('READY');
  });

  it('rejects complete when no object was uploaded', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-noobj`);
    const { fileId } = await initUpload(headers);

    const response = await request(app.getHttpServer())
      .post(`/api/files/${fileId}/complete`)
      .set(headers)
      .expect(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('rejects complete on size mismatch', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-size`);
    const { fileId, key } = await initUpload(headers, { size: PNG_BYTES.byteLength + 5 });
    await storage.putObject(key, PNG_BYTES, 'image/png');

    await request(app.getHttpServer())
      .post(`/api/files/${fileId}/complete`)
      .set(headers)
      .expect(400);
  });

  it('rejects mismatched content (magic bytes) and removes both object and row', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-magic`);
    const { fileId, key } = await initUpload(headers, { size: TEXT_BYTES.byteLength });
    // Заявлено image/png, а покладено текст
    await storage.putObject(key, TEXT_BYTES, 'image/png');

    await request(app.getHttpServer())
      .post(`/api/files/${fileId}/complete`)
      .set(headers)
      .expect(400);

    expect(storage.has(key)).toBe(false);
    expect(await prisma.file.findUnique({ where: { id: fileId } })).toBeNull();
  });

  it('returns a download URL only for READY files', async () => {
    const headers = await createAuthHeaders(`${Date.now()}-dl`);
    const { fileId, key } = await initUpload(headers);

    // PENDING → 404
    await request(app.getHttpServer())
      .get(`/api/files/${fileId}/download-url`)
      .set(headers)
      .expect(404);

    await storage.putObject(key, PNG_BYTES, 'image/png');
    await request(app.getHttpServer())
      .post(`/api/files/${fileId}/complete`)
      .set(headers)
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/api/files/${fileId}/download-url`)
      .set(headers)
      .expect(200);
    expect(String(response.body.url)).toContain('http://storage.test/download/');
    expect(response.body.expiresInSeconds).toBeGreaterThan(0);
  });

  describe('users avatar (демо-споживач)', () => {
    const uploadReadyImage = async (headers: { Authorization: string }): Promise<string> => {
      const { fileId, key } = await initUpload(headers);
      await storage.putObject(key, PNG_BYTES, 'image/png');
      await request(app.getHttpServer())
        .post(`/api/files/${fileId}/complete`)
        .set(headers)
        .expect(200);
      return fileId;
    };

    it('sets avatar from a READY image file and returns avatarUrl', async () => {
      const headers = await createAuthHeaders(`${Date.now()}-avatar`);
      const fileId = await uploadReadyImage(headers);
      const target = await prisma.user.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          email: `avatar-target-${String(Date.now())}@example.com`,
        },
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/users/${target.id}`)
        .set(headers)
        .send({ avatarFileId: fileId })
        .expect(200);

      expect(response.body.avatarFileId).toBe(fileId);
      expect(String(response.body.avatarUrl)).toContain('http://storage.test/download/');
    });

    it('rejects a PENDING file as avatar with a field error', async () => {
      const headers = await createAuthHeaders(`${Date.now()}-avatar-pending`);
      const { fileId } = await initUpload(headers);
      const target = await prisma.user.create({
        data: {
          tenantId: DEFAULT_TENANT_ID,
          email: `avatar-pending-${String(Date.now())}@example.com`,
        },
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/users/${target.id}`)
        .set(headers)
        .send({ avatarFileId: fileId })
        .expect(400);

      expect(response.body.fieldErrors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'avatarFileId' })]),
      );
    });
  });
});
