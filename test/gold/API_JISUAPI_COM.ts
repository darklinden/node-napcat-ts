// https://api.jisuapi.com/gold/shgold?appkey=<appkey>
// https://api.jisuapi.com/silver/shgold?appkey=<appkey>
const JISU_GOLD_BASE_URL = 'https://api.jisuapi.com/'
const JISU_GOLD_TOKEN = process.env.JISU_API_TOKEN ?? ''
const JISU_GOLD_PRICE_URL = `${JISU_GOLD_BASE_URL}gold/shgold?appkey=${JISU_GOLD_TOKEN}`
const JISU_SILVER_PRICE_URL = `${JISU_GOLD_BASE_URL}silver/shgold?appkey=${JISU_GOLD_TOKEN}`

import { FETCH_RETRY_LIMIT, IAPIRequest, IAPIRequestResult } from './IAPIRequest';

// {
//     "status": 0,
//         "msg": "ok",
//             "result": [
//                 {
//                     "type": "AU99.99",
//                     "typename": "AU9999",
//                     "price": "968.00",
//                     "openingprice": "965.00",
//                     "maxprice": "968.00",
//                     "minprice": "961.00",
//                     "changepercent": "4.69",
//                     "lastclosingprice": "924.65",
//                     "tradeamount": "2504.00",
//                     "updatetime": "2026-03-23 20:11:10"
//                 },
//                 {
//                     "type": "Pt99.95",
//                     "typename": "沪铂95",
//                     "price": "462.79",
//                     "openingprice": "0.00",
//                     "maxprice": "0.00",
//                     "minprice": "0.00",
//                     "changepercent": "-9.06",
//                     "lastclosingprice": "462.79",
//                     "tradeamount": "438.00",
//                     "updatetime": "2026-03-23 20:11:10"
//                 }
//             ]
// }

// {
//     "status": 0,
//     "msg": "ok",
//     "result": [
//         {
//             "type": "Ag(T+D)",
//             "typename": "白银延期",
//             "price": "16689",
//             "openingprice": "16200",
//             "maxprice": "17479",
//             "minprice": "16180",
//             "changepercent": "2.34",
//             "lastclosingprice": "15269",
//             "tradeamount": "340568",
//             "updatetime": "2026-03-24 11:21:03"
//         },
//         {
//             "type": "Ag99.99",
//             "typename": "白银9999",
//             "price": "16333",
//             "openingprice": "0",
//             "maxprice": "0",
//             "minprice": "0",
//             "changepercent": "-10.00",
//             "lastclosingprice": "16333",
//             "tradeamount": "40",
//             "updatetime": "2026-03-24 11:21:03"
//         }
//     ]
// }


interface IJisuApiResultItem {
    type: string
    typename: string
    price: string // 当前价
    openingprice: string // 开盘价
    maxprice: string // 最高价
    minprice: string // 最低价
    changepercent: string // 涨跌幅
    lastclosingprice: string // 昨收价
    tradeamount: string // 成交量
    updatetime: string // 更新时间
}

interface IJisuApiResult {
    status: number | string
    msg: string
    result: IJisuApiResultItem[]
}

export class JISUAPI_COM implements IAPIRequest {

    private async fetchCNYGoldPrice(): Promise<IAPIRequestResult[]> {
        let retryCount = 0
        let json: IJisuApiResult | null = null
        while (retryCount < FETCH_RETRY_LIMIT) {
            try {
                const res = await fetch(JISU_GOLD_PRICE_URL)
                json = await res.json()
                if (!json || !(+json.status === 0 || +json.status === 104)) {
                    throw new Error(`API error: ${JSON.stringify(json)}`)
                }
                break
            }
            catch (err) {
                console.error('[GoldPrice] Error fetching CNY gold price:', err)
                retryCount++
                console.log(`[GoldPrice] Retrying... (${retryCount}/${FETCH_RETRY_LIMIT})`)
                await new Promise(resolve => setTimeout(resolve, 1000)) // Exponential backoff
                continue
            }
        }

        console.log(`[GoldPrice] Fetched CNY gold price from Jisu API: ${JSON.stringify(json)}`)

        if (json && +json.status === 0) {
            const prices = [] as IAPIRequestResult[]
            for (const item of json.result) {
                if (item.type === 'AU99.99') {
                    prices.push({
                        metal: 'XAU',
                        currency: 'CNY',
                        update: item.updatetime ?? 'N/A',
                        prev_close_price: item.lastclosingprice ?? 'N/A',
                        open_price: item.openingprice ?? 'N/A',
                        low_price: item.minprice ?? 'N/A',
                        high_price: item.maxprice ?? 'N/A',
                        price: item.price ?? 'N/A',
                        change_percent: item.changepercent ?? 'N/A',
                    })
                }
                else if (item.type === 'Pt99.95') {
                    prices.push({
                        metal: 'XPT',
                        currency: 'CNY',
                        update: item.updatetime ?? 'N/A',
                        prev_close_price: item.lastclosingprice ?? 'N/A',
                        open_price: item.openingprice ?? 'N/A',
                        low_price: item.minprice ?? 'N/A',
                        high_price: item.maxprice ?? 'N/A',
                        price: item.price ?? 'N/A',
                        change_percent: item.changepercent ?? 'N/A',
                    })
                }
            }
            return prices
        }

        return [
            {
                metal: 'XAU',
                currency: 'CNY',
                update: 'N/A',
                prev_close_price: 'N/A',
                open_price: 'N/A',
                low_price: 'N/A',
                high_price: 'N/A',
                price: 'N/A',
                change_percent: 'N/A',
            },
            {
                metal: 'XPT',
                currency: 'CNY',
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

    private async fetchCNYSilverPrice(): Promise<IAPIRequestResult[]> {
        let retryCount = 0
        let json: IJisuApiResult | null = null
        while (retryCount < FETCH_RETRY_LIMIT) {
            try {
                const res = await fetch(JISU_SILVER_PRICE_URL)
                json = await res.json()
                if (!json || !(+json.status === 0 || +json.status === 104)) {
                    throw new Error(`API error: ${JSON.stringify(json)}`)
                }
                break
            }
            catch (err) {
                console.error('[GoldPrice] Error fetching CNY silver price:', err)
                retryCount++
                console.log(`[GoldPrice] Retrying... (${retryCount}/${FETCH_RETRY_LIMIT})`)
                await new Promise(resolve => setTimeout(resolve, 1000)) // Exponential backoff
                continue
            }
        }

        console.log(`[GoldPrice] Fetched CNY silver price from Jisu API: ${JSON.stringify(json)}`)

        if (json && +json.status === 0) {
            const prices = [] as IAPIRequestResult[]
            for (const item of json.result) {
                if (item.type === 'Ag99.99') {
                    prices.push({
                        metal: 'XAG',
                        currency: 'CNY',
                        update: item.updatetime ?? 'N/A',
                        prev_close_price: item.lastclosingprice ? (parseFloat(item.lastclosingprice ?? 0) / 1000).toFixed(2) : 'N/A', // Jisu API returns silver price in 元/千克, convert to 元/克
                        open_price: item.openingprice ? (parseFloat(item.openingprice ?? 0) / 1000).toFixed(2) : 'N/A',
                        low_price: item.minprice ? (parseFloat(item.minprice ?? 0) / 1000).toFixed(2) : 'N/A',
                        high_price: item.maxprice ? (parseFloat(item.maxprice ?? 0) / 1000).toFixed(2) : 'N/A',
                        price: item.price ? (parseFloat(item.price ?? 0) / 1000).toFixed(2) : 'N/A',
                        change_percent: item.changepercent ? (parseFloat(item.changepercent ?? 0).toFixed(2) + '%') : 'N/A',
                    })
                }
            }
            return prices
        }

        return [
            {
                metal: 'XAG',
                currency: 'CNY',
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
        const [gold, silver] = await Promise.all([
            this.fetchCNYGoldPrice(),
            this.fetchCNYSilverPrice(),
        ])

        return [...gold, ...silver]
    }
}

const jisuApi = new JISUAPI_COM()
export default jisuApi