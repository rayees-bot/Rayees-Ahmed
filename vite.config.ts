import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ and builds a classic IIFE standalone bundle
      // so opening index.html or dist/index.html directly via file:// in Chrome works.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        async closeBundle(error?: Error): Promise<void> {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }

          // Emit classic (non-module) IIFE JS + CSS bundle for direct file:// opening in Chrome
          const distStandaloneDir = path.resolve(distDir, 'standalone');
          const publicStandaloneDir = path.resolve(__dirname, 'public/standalone');
          fs.mkdirSync(distStandaloneDir, {recursive: true});
          fs.mkdirSync(publicStandaloneDir, {recursive: true});

          const distAssetsBundleDir = path.resolve(distDir, 'assets');
          if (fs.existsSync(distAssetsBundleDir)) {
            const cssFile = fs
              .readdirSync(distAssetsBundleDir)
              .find((f) => f.endsWith('.css'));
            if (cssFile) {
              const cssSource = path.join(distAssetsBundleDir, cssFile);
              fs.copyFileSync(cssSource, path.join(distStandaloneDir, 'mediquick.css'));
              fs.copyFileSync(cssSource, path.join(publicStandaloneDir, 'mediquick.css'));
            }
          }

          const esbuild = await import('esbuild');
          const outJs = path.join(distStandaloneDir, 'mediquick.iife.js');
          await esbuild.build({
            entryPoints: [path.resolve(__dirname, 'src/main.tsx')],
            bundle: true,
            minify: true,
            format: 'iife',
            platform: 'browser',
            target: ['chrome90', 'safari15', 'firefox90'],
            outfile: outJs,
            tsconfig: path.resolve(__dirname, 'tsconfig.json'),
            define: {
              'process.env.NODE_ENV': '"production"',
              'import.meta.env.MODE': '"production"',
              'import.meta.env.PROD': 'true',
              'import.meta.env.DEV': 'false',
              'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(
                process.env.VITE_GOOGLE_MAPS_API_KEY || '',
              ),
              'import.meta.env': '{}',
            },
            plugins: [
              {
                name: 'ignore-css-imports',
                setup(build) {
                  build.onLoad({filter: /\.css$/}, () => ({
                    contents: '',
                    loader: 'js',
                  }));
                },
              },
            ],
          });
          fs.copyFileSync(outJs, path.join(publicStandaloneDir, 'mediquick.iife.js'));
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
