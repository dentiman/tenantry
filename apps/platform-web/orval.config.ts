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
      // Прибирає файли, яких генератор більше не створює (мертві моделі після переїзду
      // ендпоінтів). Чиститься лише src/api/generated — рукописний http-client.ts лежить вище.
      clean: true,
      override: {
        mutator: {
          path: 'src/api/http-client.ts',
          name: 'customInstance',
        },
      },
    },
  },
});
