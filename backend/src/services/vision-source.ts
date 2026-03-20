export type VisionInputMode = 'auto' | 'data_url' | 'public_url';

export interface VisionProviderCapabilities {
    supportsDataUrl: boolean;
    supportsPublicUrl: boolean;
    supportsChatCompletions: boolean;
    supportsFileUploadVision: boolean;
    preferredMode: Exclude<VisionInputMode, 'auto'>;
}

export interface ResolveVisionImageSourceInput {
    configuredMode?: string;
    baseUrl?: string;
    previewBase64: string;
    publicImageUrl?: string;
}

export interface ResolvedVisionImageSource {
    mode: Exclude<VisionInputMode, 'auto'>;
    imageUrl: string;
}

export interface VisionPreviewResource {
    publicUrl: string;
    cleanup?: () => void | Promise<void>;
}

export interface PrepareVisionImageSourceInput {
    configuredMode?: string;
    baseUrl?: string;
    publicBaseUrl?: string;
    previewBuffer: Buffer;
    createPreviewResource?: (buffer: Buffer, publicBaseUrl: string) => VisionPreviewResource;
}

export interface PreparedVisionImageSource extends ResolvedVisionImageSource {
    cleanup: () => Promise<void>;
}

function normalizeBaseUrl(baseUrl?: string): string {
    return (baseUrl || '').trim().toLowerCase();
}

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }

    const [a, b] = parts;
    return (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 192 && b === 168) ||
        (a === 172 && b >= 16 && b <= 31)
    );
}

export function getVisionProviderCapabilities(baseUrl?: string): VisionProviderCapabilities {
    const normalized = normalizeBaseUrl(baseUrl);

    if (normalized.includes('codeproxy.dev')) {
        return {
            supportsDataUrl: true,
            supportsPublicUrl: false,
            supportsChatCompletions: false,
            supportsFileUploadVision: false,
            preferredMode: 'data_url',
        };
    }

    return {
        supportsDataUrl: true,
        supportsPublicUrl: true,
        supportsChatCompletions: true,
        supportsFileUploadVision: true,
        preferredMode: 'data_url',
    };
}

export function providerSupportsChatCompletions(baseUrl?: string): boolean {
    return getVisionProviderCapabilities(baseUrl).supportsChatCompletions;
}

export function validatePublicBaseUrl(raw?: string): string | null {
    const trimmed = raw?.trim();
    if (!trimmed) return null;

    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

        const hostname = url.hostname.toLowerCase();
        if (
            hostname === 'localhost' ||
            hostname === '0.0.0.0' ||
            hostname.endsWith('.local') ||
            isPrivateIpv4(hostname)
        ) {
            return null;
        }

        url.hash = '';
        url.search = '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return null;
    }
}

function normalizeConfiguredMode(mode?: string): VisionInputMode {
    return mode === 'data_url' || mode === 'public_url' ? mode : 'auto';
}

export function resolveVisionImageSource(
    input: ResolveVisionImageSourceInput
): ResolvedVisionImageSource {
    const capabilities = getVisionProviderCapabilities(input.baseUrl);
    const mode = normalizeConfiguredMode(input.configuredMode);
    const targetMode = mode === 'auto' ? capabilities.preferredMode : mode;

    if (targetMode === 'public_url') {
        if (!capabilities.supportsPublicUrl) {
            throw new Error('Current provider does not support public URL vision inputs');
        }
        if (!input.publicImageUrl) {
            throw new Error(
                'Current provider requires a publicly reachable image URL. Set PUBLIC_API_BASE_URL to a public domain or switch to a provider that supports data URLs.'
            );
        }
        return {
            mode: 'public_url',
            imageUrl: input.publicImageUrl,
        };
    }

    if (!capabilities.supportsDataUrl) {
        throw new Error(
            'Current provider does not support base64 data URL image inputs. Configure a public preview URL strategy instead.'
        );
    }

    return {
        mode: 'data_url',
        imageUrl: `data:image/jpeg;base64,${input.previewBase64}`,
    };
}

export function prepareVisionImageSource(
    input: PrepareVisionImageSourceInput
): PreparedVisionImageSource {
    const previewBase64 = input.previewBuffer.toString('base64');
    const capabilities = getVisionProviderCapabilities(input.baseUrl);
    const mode = normalizeConfiguredMode(input.configuredMode);
    const targetMode = mode === 'auto' ? capabilities.preferredMode : mode;

    if (targetMode === 'public_url') {
        const publicBaseUrl = validatePublicBaseUrl(input.publicBaseUrl);
        if (!publicBaseUrl) {
            throw new Error(
                'Current provider requires a publicly reachable image URL. Set PUBLIC_API_BASE_URL to a public domain or switch to a provider that supports data URLs.'
            );
        }

        const createPreviewResource =
            input.createPreviewResource ??
            (() => {
                throw new Error('Missing preview resource creator for public URL mode');
            });
        const resource = createPreviewResource(input.previewBuffer, publicBaseUrl);
        const resolved = resolveVisionImageSource({
            configuredMode: targetMode,
            baseUrl: input.baseUrl,
            previewBase64,
            publicImageUrl: resource.publicUrl,
        });

        return {
            ...resolved,
            cleanup: async () => {
                await resource.cleanup?.();
            },
        };
    }

    const resolved = resolveVisionImageSource({
        configuredMode: targetMode,
        baseUrl: input.baseUrl,
        previewBase64,
    });

    return {
        ...resolved,
        cleanup: async () => {},
    };
}
