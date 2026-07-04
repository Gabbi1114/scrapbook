import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import javaScriptObfuscator from 'vite-plugin-javascript-obfuscator';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const isProd = mode === 'production';
  return {
    plugins: [
      react(),
      tailwindcss(),
      isProd && javaScriptObfuscator({
        options: {
          // Light-protection profile: identifier renaming + string array only.
          // Control-flow flattening, dead-code injection, self-defending,
          // splitStrings and transformObjectKeys were removed — they slow
          // main-thread execution by multiples and inflate the bundle,
          // which dominated load/render time on phones.
          renameGlobals: false,
          identifierNamesGenerator: 'hexadecimal',
          controlFlowFlattening: false,
          deadCodeInjection: false,
          stringArray: true,
          stringArrayEncoding: ['none'],
          stringArrayThreshold: 0.5,
          stringArrayRotate: true,
          stringArrayShuffle: true,
          // Hide console calls
          disableConsoleOutput: true,
          selfDefending: false,
          // Keep source maps off in prod
          sourceMap: false,
          numbersToExpressions: false,
          simplify: true,
          splitStrings: false,
          transformObjectKeys: false,
          unicodeEscapeSequence: false,
        },
      }),
    ].filter(Boolean),
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-motion': ['motion'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
