import Redis from "ioredis";

let _redis: Redis | null = null;
export function getRedis(): Redis {
    if (!_redis) {
        _redis = new Redis(process.env.REDIS_URL!)
    }
    return _redis
}

let redis = getRedis()
export default redis

