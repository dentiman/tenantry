## 1. Data and core

- [x] 1.1 Migration: platform settings, events, tenant access (grants, RLS).
- [x] 1.2 Secret box (AES-256-GCM) and platform settings reader with env fallback and cache.
- [x] 1.3 Availability service (installation, platform, tenant permission, tenant choice).

## 2. Runtime

- [x] 2.1 Worker: `AiRuntime` per generation, provider rebuild on change, disabled → cancel.
- [x] 2.2 Embeddings fall back to runtime credentials.
- [x] 2.3 Tenant API: availability on AI routes and bootstrap; `settings.ai.enabled`.

## 3. Control plane

- [x] 3.1 platform-api: settings read/update, reveal, events; tenant AI permission.
- [x] 3.2 Contracts, OpenAPI and orval for both planes.

## 4. UI

- [x] 4.1 platform-web: AI area with settings form and key reveal; tenant permission toggle.
- [x] 4.2 web: assistant switch in `/settings/ai`.

## 5. Verification

- [x] 5.1 Unit: secret box, precedence, availability, worker cancel and runtime model.
- [x] 5.2 E2E: platform settings/reveal/permission; tenant availability and switch.
- [x] 5.3 Docs and env; lint/typecheck/build; live check.
