// https://api.gold-api.com/ohlc/XAU?startTimestamp=1771053764&endTimestamp=1771485764
// x-api-key: YOUR_API_KEY
// curl -X GET "https://api.gold-api.com/ohlc/XAU" -H "x-api-key: YOUR_API_KEY"
const GOLD_API_BASE_URL = 'https://api.gold-api.com/ohlc'
const GOLD_API_URL = `${GOLD_API_BASE_URL}/XAU`
const GOLD_API_TOKEN = process.env.GOLD_API_TOKEN ?? ''

import { FETCH_RETRY_LIMIT, IAPIRequest, IAPIRequestResult, stampToString } from './IAPIRequest';

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

interface IGoldApiResult {
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

    private async fetchUSDGoldPrice(): Promise<IAPIRequestResult[]> {
        let retryCount = 0
        let json: IGoldApiResult | null = null
        while (retryCount < FETCH_RETRY_LIMIT) {
            try {
                const res = await fetch(GOLD_API_URL, {
                    headers: {
                        'x-api-key': GOLD_API_TOKEN,
                    },
                    method: 'GET',
                })
                json = await res.json()
                if (!json || typeof json.close !== 'number') {
                    throw new Error(`API error: ${JSON.stringify(json)}`)
                }
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

        if (json && typeof json.close === 'number') {
            const prices = [] as IAPIRequestResult[]
            prices.push({
                metal: 'XAU',
                currency: 'USD',
                update: stampToString(json.startTimestamp * 1000),
                prev_close_price: '' + json.close,
                open_price: '' + json.open,
                low_price: '' + json.low,
                high_price: '' + json.high,
                price: '' + json.close,
                change_percent: json.highLowChangePercent.toFixed(2) + '%',
            })
            return prices
        }

        return [
            {
                metal: 'XAU',
                currency: 'USD',
                update: 'N/A',
                prev_close_price: 'N/A',
                open_price: 'N/A',
                low_price: 'N/A',
                high_price: 'N/A',
                price: 'N/A',
                change_percent: 'N/A',
            }
        ]
    }

    async fetchResults(): Promise<IAPIRequestResult[]> {
        return await this.fetchUSDGoldPrice()
    }
}

const goldApi = new GOLDAPI_COM()
export default goldApi