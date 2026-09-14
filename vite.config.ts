import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  input: {
    main: 'index.html',
    admin: 'admin.html',
  },
  build: {
    manifest: true,
    chunkSizeWarningLimit: 400,
  },
});
