// https://currencyapi.net/api/v2/rates?base=USD&output=json&key=
// {
//   "valid": true,
//   "updated": 1773968416,
//   "base": "USD",
//   "rates": {
//     "CNY": 6.899882702,
//   }
// }

import redis from "../redis"
import { FETCH_RETRY_LIMIT, stampToString } from "./IAPIRequest"

const CURRENCY_RATES_API_TOKEN = process.env.CURRENCY_RATES_API_TOKEN ?? ''
const CURRENCY_RATES_API_URL = 'https://currencyapi.net/api/v2/rates?base=USD&output=json&key=' + CURRENCY_RATES_API_TOKEN

interface IRateData {
    time: number // 1773968416
    update_time?: string // "2026-03-17 12:00:16"
    usd_cny: number | null // 6.899882702
}

interface ICurrencyApiResult {
    valid: boolean
    updated: number
    base: string
    rates: {
        CNY: number
    }
}

/** Try to load cached prices from Redis for the current 15-min window */
export async function getCachedRate(): Promise<IRateData | null> {
    const key = `RATE:USD:CNY`
    const cached = await redis.get(key)
    if (!cached) return null
    try {
        return JSON.parse(cached) as IRateData
    } catch {
        return null
    }
}

/** Store prices into Redis keyed by the 15-min window */
async function cacheRate(data: IRateData): Promise<void> {
    const key = `RATE:USD:CNY`
    await redis.set(key, JSON.stringify(data))
}

export async function fetchUSDRateCNY(): Promise<IRateData | null> {
    let retryCount = 0
    let json: ICurrencyApiResult | null = null
    while (retryCount < FETCH_RETRY_LIMIT) {
        try {
            const res = await fetch(CURRENCY_RATES_API_URL, { method: 'GET' })
            json = await res.json()
            if (!json || !json.rates || typeof json.rates.CNY !== 'number') {
                throw new Error(`API error: ${JSON.stringify(json)}`)
            }
            break
        }
        catch (err) {
            console.error('[GoldPrice] Error fetching USD/CNY rate:', err)
            retryCount++
            console.log(`[GoldPrice] Retrying... (${retryCount}/${FETCH_RETRY_LIMIT})`)
            await new Promise(resolve => setTimeout(resolve, 1000)) // Exponential backoff
            continue
        }
    }
    if (json && json.rates && typeof json.rates.CNY === 'number') {
        const ret = {
            time: Date.now(),
            update_time: stampToString(json.updated * 1000),
            usd_cny: json.rates.CNY,
        }
        await cacheRate(ret)
        return ret
    }
    return null
}

