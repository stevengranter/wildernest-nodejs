import NodeCache from 'node-cache'
import redisClient from '../config/redisClient.js'

const CACHE_TTL = 7 * 86400 // 7 days

export interface ICacheService {
    get: <T>(key: string) => Promise<T | undefined>;
    set: <T>(key: string, value: T) => Promise<boolean>;
    del: (key: string) => Promise<number | boolean>;
    flush: () => Promise<string | void>;
}

const memoryCache = new NodeCache({ stdTTL: CACHE_TTL })

export const memoryCacheService: ICacheService = {
    get: async <T>(key: string): Promise<T | undefined> => {
        return memoryCache.get<T>(key)
    },

    set: async <T>(key: string, value: T): Promise<boolean> => {
        return memoryCache.set(key, value)
    },

    del: async (key: string): Promise<number> => {
        return memoryCache.del(key)
    },

    flush: async (): Promise<void> => {
        memoryCache.flushAll()
    },
}

const redisCacheService: ICacheService = {
    get: async <T>(key: string): Promise<T | undefined> => {
        const value = await redisClient.get(key)
        if (value) {
            return JSON.parse(value) as T
        }
        return undefined
    },

    set: async <T>(key: string, value: T): Promise<boolean> => {
        const result = await redisClient.set(
            key,
            JSON.stringify(value),
            'EX',
            CACHE_TTL
        )
        return result === 'OK'
    },

    del: async (key: string): Promise<number> => {
        return await redisClient.del(key)
    },

    flush: async (): Promise<string> => {
        return await redisClient.flushall()
    },
}

export const tieredCacheService: ICacheService = {
    get: async <T>(key: string): Promise<T | undefined> => {
        let value = await memoryCacheService.get<T>(key)
        if (value) {
            return value
        }

        try {
            value = await redisCacheService.get<T>(key)
            if (value) {
                await memoryCacheService.set(key, value)
            }
        } catch (_) { /* redis unavailable, use memory cache only */ }
        return value
    },

    set: async <T>(key: string, value: T): Promise<boolean> => {
        const memoryResult = await memoryCacheService.set(key, value)
        try {
            await redisCacheService.set(key, value)
        } catch (_) { /* redis unavailable */ }
        return memoryResult
    },

    del: async (key: string): Promise<boolean> => {
        const memoryResult = await memoryCacheService.del(key)
        try {
            await redisCacheService.del(key)
        } catch (_) { /* redis unavailable */ }
        return !!memoryResult
    },

    flush: async (): Promise<void> => {
        await memoryCacheService.flush()
        try {
            await redisCacheService.flush()
        } catch (_) { /* redis unavailable */ }
    },
}
export const cacheService = tieredCacheService