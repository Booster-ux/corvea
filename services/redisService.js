const { Redis } = require('@upstash/redis');

let redisClient = null;
const inMemoryStore = new Map();

const isRedisAvailable = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

if (isRedisAvailable) {
    try {
        redisClient = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN
        });
        console.log('[Redis] Upstash Redis client initialized successfully.');
    } catch (err) {
        console.error('[Redis] Failed to initialize Upstash Redis client:', err.message);
    }
} else {
    console.log('[Redis] Upstash Redis credentials not detected. Falling back to Mock in-memory store.');
}

/**
 * Stores a value under a key with a TTL (default: 24 hours).
 * @param {string} key 
 * @param {object|string} value 
 * @param {number} exSeconds 
 */
async function set(key, value, exSeconds = 86400) {
    if (redisClient) {
        const payloadStr = typeof value === 'string' ? value : JSON.stringify(value);
        await redisClient.set(key, payloadStr, { ex: exSeconds });
        return 'OK';
    } else {
        const payloadStr = typeof value === 'string' ? value : JSON.stringify(value);
        inMemoryStore.set(key, payloadStr);
        // Simulate TTL cleanup
        setTimeout(() => inMemoryStore.delete(key), exSeconds * 1000);
        return 'OK';
    }
}

/**
 * Fetches and parses a value from the store.
 * @param {string} key 
 * @returns {object|string|null}
 */
async function get(key) {
    if (redisClient) {
        const data = await redisClient.get(key);
        if (!data) return null;
        if (typeof data === 'object') return data;
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
    } else {
        const val = inMemoryStore.get(key);
        if (!val) return null;
        return JSON.parse(val);
    }
}

/**
 * Deletes a value from the store.
 * @param {string} key 
 */
async function del(key) {
    if (redisClient) {
        await redisClient.del(key);
        return 1;
    } else {
        return inMemoryStore.delete(key) ? 1 : 0;
    }
}

/**
 * Checks the health status of the connection.
 * @returns {string}
 */
async function ping() {
    if (redisClient) {
        try {
            const res = await redisClient.ping();
            return res === 'PONG' || res === 'pong' ? 'healthy' : 'degraded';
        } catch (err) {
            console.error('[Redis Ping Error]:', err.message);
            return 'unhealthy';
        }
    } else {
        return 'mock-healthy';
    }
}

// Helpers for testing
function getInMemoryStore() {
    const obj = {};
    for (const [key, val] of inMemoryStore.entries()) {
        obj[key] = val;
    }
    return obj;
}

function getInMemoryStoreKeys() {
    return Array.from(inMemoryStore.keys());
}

module.exports = {
    set,
    get,
    del,
    ping,
    isRedisAvailable,
    getInMemoryStore,
    getInMemoryStoreKeys
};
