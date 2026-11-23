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
