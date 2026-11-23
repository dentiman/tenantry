const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = function (options) {
  return {
    ...options,
    externals: [
      nodeExternals({
        allowlist: [/^@saas-skeleton\//],
      }),
      // Воркер бандлить nestjs-zod разом із @nestjs/swagger (через libs/shared), бо їх нема в
      // apps/worker/node_modules. У swagger 12 `@fastify/static` вантажиться через import(),
      // який webpack резолвить на збірці (у 11 був ледачий require → лише warning). Fastify
      // воркеру не потрібен — лишаємо пакет зовнішнім, він ніколи не виконується.
      { '@fastify/static': 'commonjs @fastify/static' },
    ],
    resolve: {
      ...options.resolve,
      alias: {
        '@saas-skeleton/database': path.resolve(__dirname, '../../libs/database/src'),
        '@saas-skeleton/contracts': path.resolve(__dirname, '../../libs/contracts/src'),
        '@saas-skeleton/shared': path.resolve(__dirname, '../../libs/shared/src'),
      },
    },
  };
};
