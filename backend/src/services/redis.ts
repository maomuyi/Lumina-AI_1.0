import Redis from 'ioredis';

export interface SharedRedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: 'EX', durationSeconds: number): Promise<unknown>;
    incr(key: string): Promise<number>;
    expire(key: string, durationSeconds: number): Promise<number>;
    ttl?(key: string): Promise<number>;
    connect?(): Promise<unknown>;
    on?(event: 'error', listener: (error: Error) => void): unknown;
    status?: string;
}

let sharedRedisClient: Redis | null = null;
let connectPromise: Promise<void> | null = null;
let redisClientOverride: SharedRedisClient | null = null;

function logRedisError(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[redis] ${context}: ${message}`);
}

function createRedisClient(): Redis {
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    const client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
    });

    client.on('error', (error) => {
        logRedisError('client error', error);
    });

    return client;
}

function ensureLazyConnection(client: SharedRedisClient): void {
    if (typeof client.connect !== 'function') {
        return;
    }

    const status = client.status;
    if (status && status !== 'wait' && status !== 'end') {
        return;
    }

    if (!connectPromise) {
        connectPromise = Promise.resolve(client.connect())
            .then(() => {})
            .catch((error) => {
                logRedisError('lazy connect failed', error);
            })
            .finally(() => {
                connectPromise = null;
            });
    }
}

export function getRedisClient(): SharedRedisClient {
    if (redisClientOverride) {
        return redisClientOverride;
    }

    if (!sharedRedisClient) {
        sharedRedisClient = createRedisClient();
    }

    ensureLazyConnection(sharedRedisClient);
    return sharedRedisClient;
}

export function setSharedRedisClientForTests(client: SharedRedisClient | null): void {
    redisClientOverride = client;
}
