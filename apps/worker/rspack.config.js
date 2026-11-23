const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = function (options) {
  return {
    ...options,
    // Nest CLI 12 бере devtool для rspack із tsconfig `sourceMap: true` (карти йшли б у прод-образ,
    // ~14 МБ); webpack-дефолти вмикали карти лише з `--debug` — лишаємо ту саму поведінку
    devtool: process.argv.includes('--debug') ? 'inline-source-map' : false,
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
