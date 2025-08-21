import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ command }) => {
    return {
        base: command === 'build' ? '/webcam-reso/' : './',
        build: {
            target: 'esnext',
            sourcemap: false,
            minify: 'terser',
            terserOptions: {
                compress: {
                    drop_console: true,
                    drop_debugger: true,
                },
            },
        },
        plugins: [basicSsl()],
        server: {
            https: true, // プラグインで自己署名証明書を供給
            host: true,  // LAN 公開（実機アクセス用）
            port: 5173,
        }
    }
});