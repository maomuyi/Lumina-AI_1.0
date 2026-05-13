import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        exclude: ['tests/**/._*'],
        globals: true,
        coverage: {
            include: ['src/services/**', 'src/utils/**'],
            exclude: ['src/services/llm.ts', 'src/services/session.ts'],
            reporter: ['text', 'html'],
        },
    },
});
