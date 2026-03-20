export type LlmProvider = 'dashscope' | 'codeproxy' | 'generic';

export interface LlmProviderConfig {
    provider: LlmProvider;
    baseUrl: string;
    apiKey: string;
    visionModel: string;
    textModel: string;
    supportsChatCompletions: boolean;
    preferResponsesPrimaryForVision: boolean;
    preferResponsesPrimaryForText: boolean;
}

function normalizeBaseUrl(baseUrl?: string): string {
    return (baseUrl || '').trim().toLowerCase();
}

function normalizeProviderOverride(value?: string): LlmProvider | null {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'dashscope' || normalized === 'codeproxy' || normalized === 'generic') {
        return normalized;
    }
    return null;
}

export function detectLlmProvider(baseUrl?: string, override?: string): LlmProvider {
    const overridden = normalizeProviderOverride(override);
    if (overridden) {
        return overridden;
    }

    const normalized = normalizeBaseUrl(baseUrl);
    if (normalized.includes('dashscope.aliyuncs.com')) {
        return 'dashscope';
    }
    if (normalized.includes('codeproxy.dev')) {
        return 'codeproxy';
    }
    return 'generic';
}

function providerSupportsChatCompletions(provider: LlmProvider): boolean {
    return provider !== 'codeproxy';
}

export function resolveLlmProviderConfig(
    env: Partial<Record<string, string | undefined>> = process.env
): LlmProviderConfig {
    const baseUrl = env.OPENAI_BASE_URL || 'https://codeproxy.dev/v1';
    const provider = detectLlmProvider(baseUrl, env.LLM_PROVIDER);
    const supportsChatCompletions = providerSupportsChatCompletions(provider);
    const defaultVisionModel = provider === 'dashscope' ? 'qwen-vl-plus' : 'gpt-5.2';
    const defaultTextModel = 'gpt-5.2';
    const visionModel = env.LLM_VISION_MODEL || defaultVisionModel;
    const textModel = env.LLM_TEXT_MODEL || defaultTextModel;

    return {
        provider,
        baseUrl,
        apiKey: env.OPENAI_API_KEY || '',
        visionModel,
        textModel,
        supportsChatCompletions,
        preferResponsesPrimaryForVision: provider === 'dashscope' ? false : /^gpt-5/i.test(visionModel),
        preferResponsesPrimaryForText: provider === 'dashscope' ? false : /^gpt-5/i.test(textModel),
    };
}
