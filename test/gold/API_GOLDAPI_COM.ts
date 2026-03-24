// https://api.gold-api.com/ohlc/XAU?startTimestamp=1771053764&endTimestamp=1771485764
// x-api-key: YOUR_API_KEY
// curl -X GET "https://api.gold-api.com/ohlc/XAU" -H "x-api-key: YOUR_API_KEY"
// https://api.gold-api.com/price/XAU
const GOLD_API_BASE_URL = 'https://api.gold-api.com'
const GOLD_API_PRICE_URL = `${GOLD_API_BASE_URL}/price/XAU`
const SILVER_API_PRICE_URL = `${GOLD_API_BASE_URL}/price/XAG`
const GOLD_API_HISTORY_URL = `${GOLD_API_BASE_URL}/ohlc/XAU?startTimestamp={starttimestamp}&endTimestamp={endtimestamp}`
const SILVER_API_HISTORY_URL = `${GOLD_API_BASE_URL}/ohlc/XAG?startTimestamp={starttimestamp}&endTimestamp={endtimestamp}`
const GOLD_API_TOKEN = process.env.GOLD_API_TOKEN ?? ''

import { FETCH_RETRY_LIMIT, IAPIRequest, IAPIRequestResult, stampToString } from './IAPIRequest';

// {
//   "name": "Gold",
//   "price": 4356.899902,
//   "symbol": "XAU",
//   "updatedAt": "2026-03-24T02:41:12Z",
//   "updatedAtReadable": "a few seconds ago"
// }

interface IGoldApiPriceResult {
    symbol: string,
    price: number,
    updatedAt: string
}

// {
//   "close": 5017.6001,
//   "endTimestamp": 1771485764,
//   "high": 5043.2002,
//   "highLowChangePercent": 3.9128100019702154,
//   "low": 4853.2998,
//   "open": 5043.2002,
//   "openCloseChangePercent": -0.5076161759352834,
//   "startTimestamp": 1771053764
// }

interface IGoldApiHistoryResult {
    close: number,
    endTimestamp: number,
    high: number,
    highLowChangePercent: number,
    low: number,
    open: number,
    openCloseChangePercent: number,
    startTimestamp: number,
}

export class GOLDAPI_COM implements IAPIRequest {

    private async fetchUSDGoldHistory(): Promise<IGoldApiHistoryResult | null> {
        let retryCount = 0
        let json: IGoldApiHistoryResult | null = null
        while (retryCount < FETCH_RETRY_LIMIT) {
            try {
                const now = Math.floor(Date.now() / 1000)
                const start = now - 24 * 3600 // 24 hours ago
                const url = GOLD_API_HISTORY_URL.replace('{starttimestamp}', start.toString()).replace('{endtimestamp}', now.toString())
                const res = await fetch(url, {
                    headers: {
                        'x-api-key': GOLD_API_TOKEN,
                    },
                    method: 'GET',
                })
                json = await res.json()
                if (!json || typeof json.close !== 'number') {
                    throw new Error(`API error: ${JSON.stringify(json)}`)
                }
                console.error('[GoldPrice] Fetched USD gold history:', json)
                break
            }
            catch (err) {
                console.error('[GoldPrice] Error fetching USD gold history:', err)
                retryCount++
                console.log(`[GoldPrice] Retrying... (${retryCount}/${FETCH_RETRY_LIMIT})`)
                await new Promise(resolve => setTimeout(resolve, 1000)) // Exponential backoff
                continue
            }
        }

        return json
    }

    private async fetchUSDGoldPrice(): Promise<IGoldApiPriceResult | null> {
        let retryCount = 0
        let json: IGoldApiPriceResult | null = null
        while (retryCount < FETCH_RETRY_LIMIT) {
            try {
                const res = await fetch(GOLD_API_PRICE_URL, {
                    headers: {
                        'x-api-key': GOLD_API_TOKEN,
                    },
                    method: 'GET',
                })
                json = await res.json()
                if (!json || typeof json.price !== 'number') {
                    throw new Error(`API error: ${JSON.stringify(json)}`)
                }
                console.log(`[GoldPrice] USD gold price fetched: ${JSON.stringify(json)}`)
                break
            }
            catch (err) {
                console.error('[GoldPrice] Error fetching USD gold price:', err)
                retryCount++
                console.log(`[GoldPrice] Retrying... (${retryCount}/${FETCH_RETRY_LIMIT})`)
                await new Promise(resolve => setTimeout(resolve, 1000)) // Exponential backoff
                continue
            }
        }

        return json
    }

    private async fetchUSDSilverHistory(): Promise<IGoldApiHistoryResult | null> {
        let retryCount = 0
        let json: IGoldApiHistoryResult | null = null
        while (retryCount < FETCH_RETRY_LIMIT) {
            try {
                const now = Math.floor(Date.now() / 1000)
                const start = now - 24 * 3600 // 24 hours ago
                const url = SILVER_API_HISTORY_URL.replace('{starttimestamp}', start.toString()).replace('{endtimestamp}', now.toString())
                const res = await fetch(url, {
                    headers: {
                        'x-api-key': GOLD_API_TOKEN,
                    },
                    method: 'GET',
                })
                json = await res.json()
                if (!json || typeof json.close !== 'number') {
                    throw new Error(`API error: ${JSON.stringify(json)}`)
                }
                console.log(`[GoldPrice] Fetched USD silver history: ${JSON.stringify(json)}`)
                break
            }
            catch (err) {
                console.error('[GoldPrice] Error fetching USD silver history:', err)
                retryCount++
                console.log(`[GoldPrice] Retrying... (${retryCount}/${FETCH_RETRY_LIMIT})`)
                await new Promise(resolve => setTimeout(resolve, 1000)) // Exponential backoff
                continue
            }
        }

        return json
    }

    private async fetchUSDSilverPrice(): Promise<IGoldApiPriceResult | null> {
        let retryCount = 0
        let json: IGoldApiPriceResult | null = null
        while (retryCount < FETCH_RETRY_LIMIT) {
            try {
                const res = await fetch(SILVER_API_PRICE_URL, {
                    headers: {
                        'x-api-key': GOLD_API_TOKEN,
                    },
                    method: 'GET',
                })
                json = await res.json()
                if (!json || typeof json.price !== 'number') {
                    throw new Error(`API error: ${JSON.stringify(json)}`)
                }
                console.log(`[GoldPrice] USD silver price fetched: ${JSON.stringify(json)}`)
                break
            }
            catch (err) {
                console.error('[GoldPrice] Error fetching USD silver price:', err)
                retryCount++
                console.log(`[GoldPrice] Retrying... (${retryCount}/${FETCH_RETRY_LIMIT})`)
                await new Promise(resolve => setTimeout(resolve, 1000)) // Exponential backoff
                continue
            }
        }

        return json
    }

    async fetchResults(): Promise<IAPIRequestResult[]> {
        const [goldHistory, goldPrice] = await Promise.all([
            this.fetchUSDGoldHistory(),
            this.fetchUSDGoldPrice(),
        ])

        const [silverHistory, silverPrice] = await Promise.all([
            this.fetchUSDSilverHistory(),
            this.fetchUSDSilverPrice(),
        ])

        const gold: IAPIRequestResult = {
            metal: 'XAU',
            currency: 'USD',
            update: goldPrice ? goldPrice.updatedAt ? stampToString(new Date(goldPrice.updatedAt).getTime()) : 'N/A' : 'N/A',
            prev_close_price: goldHistory ? goldHistory.close.toString() : 'N/A',
            open_price: goldHistory ? goldHistory.open.toString() : 'N/A',
            low_price: goldHistory ? goldHistory.low.toString() : 'N/A',
            high_price: goldHistory ? goldHistory.high.toString() : 'N/A',
            price: goldPrice ? goldPrice.price.toString() : 'N/A',
            change_percent: goldHistory ? goldHistory.openCloseChangePercent.toFixed(2) + '%' : 'N/A',
        }

        // 2026-03-24T02:41:12Z to timestamp to stampToString
        const silver: IAPIRequestResult = {
            metal: 'XAG',
            currency: 'USD',
            update: silverPrice ? silverPrice.updatedAt ? stampToString(new Date(silverPrice.updatedAt).getTime()) : 'N/A' : 'N/A',
            prev_close_price: silverHistory ? silverHistory.close.toString() : 'N/A',
            open_price: silverHistory ? silverHistory.open.toString() : 'N/A',
            low_price: silverHistory ? silverHistory.low.toString() : 'N/A',
            high_price: silverHistory ? silverHistory.high.toString() : 'N/A',
            price: silverPrice ? silverPrice.price.toString() : 'N/A',
            change_percent: silverHistory ? silverHistory.openCloseChangePercent.toFixed(2) + '%' : 'N/A',
        }

        return [gold, silver]
    }
}

const goldApi = new GOLDAPI_COM()
export default goldApi