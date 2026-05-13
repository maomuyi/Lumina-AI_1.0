import { afterEach, describe, expect, it } from 'vitest';
import { isTextLLMConfigured, isVisionLLMConfigured } from '../src/services/llm.js';

const ORIGINAL_ENV = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    TEXT_API_KEY: process.env.TEXT_API_KEY,
    VISION_API_KEY: process.env.VISION_API_KEY,
};

function resetKeys() {
    delete process.env.OPENAI_API_KEY;
    delete process.env.TEXT_API_KEY;
    delete process.env.VISION_API_KEY;
}

afterEach(() => {
    resetKeys();
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
        if (value !== undefined) process.env[key] = value;
    }
});

describe('LLM channel configuration', () => {
    it('does not treat legacy OPENAI_API_KEY as text or vision configuration', () => {
        resetKeys();
        process.env.OPENAI_API_KEY = 'sk-legacy-key';

        expect(isTextLLMConfigured()).toBe(false);
        expect(isVisionLLMConfigured()).toBe(false);
    });

    it('keeps text and vision keys independent', () => {
        resetKeys();
        process.env.TEXT_API_KEY = 'sk-text-key';

        expect(isTextLLMConfigured()).toBe(true);
        expect(isVisionLLMConfigured()).toBe(false);

        resetKeys();
        process.env.VISION_API_KEY = 'sk-vision-key';

        expect(isTextLLMConfigured()).toBe(false);
        expect(isVisionLLMConfigured()).toBe(true);
    });

    it('ignores placeholder keys per channel', () => {
        resetKeys();
        process.env.TEXT_API_KEY = 'your-deepseek-api-key-here';
        process.env.VISION_API_KEY = 'your-openai-vision-api-key-here';

        expect(isTextLLMConfigured()).toBe(false);
        expect(isVisionLLMConfigured()).toBe(false);
    });
});
