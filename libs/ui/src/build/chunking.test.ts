import { describe, expect, it } from 'vitest';
import { chunkFileNames, manualChunks, packageNameOf } from './chunking';

describe('packageNameOf', () => {
  it('бере імʼя пакета з pnpm-шляху, зокрема scoped', () => {
    expect(
      packageNameOf(
        '/r/node_modules/.pnpm/react-dom@19.2.7_react@19/node_modules/react-dom/index.js',
      ),
    ).toBe('react-dom');
    expect(
      packageNameOf('/r/node_modules/.pnpm/x/node_modules/@tanstack/react-router/dist/a.js'),
    ).toBe('@tanstack/react-router');
  });

  it('для коду застосунку імені немає', () => {
    expect(packageNameOf('/r/apps/web/src/main.tsx')).toBeUndefined();
  });
});

describe('manualChunks', () => {
  it('збирає стабільні вендор-групи', () => {
    expect(manualChunks('/r/node_modules/.pnpm/a/node_modules/react/index.js')).toBe(
      'vendor-react',
    );
    expect(manualChunks('/r/node_modules/.pnpm/a/node_modules/i18next/dist/a.js')).toBe(
      'vendor-i18n',
    );
  });

  it('не чіпає ледачі бібліотеки й код застосунку', () => {
    expect(
      manualChunks('/r/node_modules/.pnpm/a/node_modules/react-markdown/index.js'),
    ).toBeUndefined();
    expect(
      manualChunks('/r/node_modules/.pnpm/a/node_modules/@base-ui/react/a.js'),
    ).toBeUndefined();
    expect(manualChunks('/r/apps/web/src/features/chat/pages/chat.tsx')).toBeUndefined();
  });
});

describe('chunkFileNames', () => {
  it('називає чанк сторінки за модулем і сторінкою', () => {
    expect(
      chunkFileNames({
        name: 'chat',
        facadeModuleId: '/r/apps/web/src/features/chat/pages/chat-conversation.tsx',
      }),
    ).toBe('assets/route-chat-chat-conversation-[hash].js');
  });

  it('решту лишає з імʼям Rollup', () => {
    expect(chunkFileNames({ name: 'select', facadeModuleId: null })).toBe(
      'assets/[name]-[hash].js',
    );
  });
});
