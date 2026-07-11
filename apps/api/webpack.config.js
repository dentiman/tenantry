const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = function (options) {
  return {
    ...options,
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
      },
    },
  };
};
