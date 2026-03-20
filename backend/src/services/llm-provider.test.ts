import assert from 'node:assert/strict';
import test from 'node:test';
import { detectLlmProvider, resolveLlmProviderConfig } from './llm-provider.js';

test('detectLlmProvider detects dashscope from compatible-mode base url', () => {
    const provider = detectLlmProvider('https://dashscope.aliyuncs.com/compatible-mode/v1');
    assert.equal(provider, 'dashscope');
});

test('resolveLlmProviderConfig defaults vision model to qwen-vl-plus for dashscope', () => {
    const config = resolveLlmProviderConfig({
        OPENAI_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        OPENAI_API_KEY: 'dashscope-key',
    });

    assert.equal(config.provider, 'dashscope');
    assert.equal(config.visionModel, 'qwen-vl-plus');
    assert.equal(config.supportsChatCompletions, true);
    assert.equal(config.preferResponsesPrimaryForVision, false);
});

test('resolveLlmProviderConfig keeps existing gpt defaults for non-dashscope providers', () => {
    const config = resolveLlmProviderConfig({
        OPENAI_BASE_URL: 'https://codeproxy.dev/v1',
        OPENAI_API_KEY: 'codeproxy-key',
    });

    assert.equal(config.provider, 'codeproxy');
    assert.equal(config.visionModel, 'gpt-5.2');
    assert.equal(config.textModel, 'gpt-5.2');
});

test('LLM_PROVIDER override can force provider strategy', () => {
    const config = resolveLlmProviderConfig({
        LLM_PROVIDER: 'generic',
        OPENAI_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        OPENAI_API_KEY: 'dashscope-key',
    });

    assert.equal(config.provider, 'generic');
    assert.equal(config.visionModel, 'gpt-5.2');
    assert.equal(config.preferResponsesPrimaryForVision, true);
});
