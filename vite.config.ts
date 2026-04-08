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
          // Rename variables/functions → unreadable
          renameGlobals: false,
          identifierNamesGenerator: 'hexadecimal',
          // Control flow flattening makes logic hard to follow
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.4,
          // Dead code injection adds fake code blocks
          deadCodeInjection: true,
          deadCodeInjectionThreshold: 0.2,
          // String encoding
          stringArray: true,
          stringArrayEncoding: ['base64'],
          stringArrayThreshold: 0.75,
          stringArrayRotate: true,
          stringArrayShuffle: true,
          // Hide console calls
          disableConsoleOutput: true,
          // Self-defending: resists reformatting
          selfDefending: true,
          // Keep source maps off in prod
          sourceMap: false,
          // Performance balance: don't go too heavy
          numbersToExpressions: true,
          simplify: true,
          splitStrings: true,
          splitStringsChunkLength: 8,
          transformObjectKeys: true,
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
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
