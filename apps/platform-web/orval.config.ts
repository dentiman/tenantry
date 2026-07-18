import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: '../platform-api/openapi.json',
    output: {
      target: 'src/api/generated/api.ts',
      schemas: 'src/api/generated/model',
      client: 'react-query',
      httpClient: 'axios',
      mode: 'split',
      prettier: true,
      override: {
        mutator: {
          path: 'src/api/http-client.ts',
          name: 'customInstance',
        },
      },
    },
  },
});
