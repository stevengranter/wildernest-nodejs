import { Redis } from 'ioredis'
import env from './app.config.js'

const redisClient: Redis = new Redis(env.REDIS_URL || 'redis://localhost:6379', {
    enableOfflineQueue: false,
    lazyConnect: true,
})
redisClient.on('error', () => { /* suppress unhandled error events */ })

// Ping Redis once a day to prevent Upstash free-tier deletion (7-day inactivity limit)
const DAY_MS = 24 * 60 * 60 * 1000
setInterval(async () => {
    try {
        await redisClient.ping()
    } catch (_) { /* ignore - redis unavailable */ }
}, DAY_MS)

export default redisClient