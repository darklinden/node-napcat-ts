import { IFeature } from './Feature'
import { GroupMessage, PrivateFriendMessage, PrivateGroupMessage, Receive, Structs } from '../src'
import { type SendMessageSegment } from '../src/index.js'
import redis from './redis.js'

// https://api.jisuapi.com/gold/shgold?appkey=<appkey>
// https://api.jisuapi.com/silver/shgold?appkey=<appkey>
const JISU_GOLD_BASE_URL = 'https://api.jisuapi.com/'
const JISU_GOLD_TOKEN = process.env.JISU_API_TOKEN ?? ''
const JISU_GOLD_PRICE_URL = `${JISU_GOLD_BASE_URL}gold/shgold?appkey=${JISU_GOLD_TOKEN}`
const JISU_SILVER_PRICE_URL = `${JISU_GOLD_BASE_URL}silver/shgold?appkey=${JISU_GOLD_TOKEN}`

// curl -H "x-access-token: <token>" https://www.goldapi.io/api/XAU/USD -X GET 
// wget --header="x-access-token: <token>" https://www.goldapi.io/api/XAU/USD -O- -q
const GOLD_API_BASE_URL = 'https://www.goldapi.io/api/'
const GOLD_API_TOKEN = process.env.GOLD_API_TOKEN ?? ''
const GOLD_API_URLS = {
  XAU: `${GOLD_API_BASE_URL}XAU/USD`,
  XAG: `${GOLD_API_BASE_URL}XAG/USD`,
  XPT: `${GOLD_API_BASE_URL}XPT/USD`,
}

// https://currencyapi.net/api/v2/rates?base=USD&output=json&key=
// {
//   "valid": true,
//   "updated": 1773968416,
//   "base": "USD",
//   "rates": {
//     "CNY": 6.899882702,
//   }
// }

const CURRENCY_RATES_API_TOKEN = process.env.CURRENCY_RATES_API_TOKEN ?? ''
const CURRENCY_RATES_API_URL = 'https://currencyapi.net/api/v2/rates?base=USD&output=json&key=' + CURRENCY_RATES_API_TOKEN

interface ICachedRateData {
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

const OUNCE_TO_GRAM = 31.1035

const FETCH_RETRY_LIMIT = 5

const FETCH_INTERVAL_MS = 30 * 60 * 1000
const CACHE_EXPIRE = 40 * 60 // 40 minutes in seconds, slightly longer than 30m window

//         {
//             "type": "AU99.99",
//             "typename": "AU9999",
//             "price": "1131.00",
//             "openingprice": "1147.00",
//             "maxprice": "1150.80",
//             "minprice": "1129.65",
//             "changepercent": "-1.35",
//             "lastclosingprice": "1146.45",
//             "tradeamount": "756784.00",
//             "updatetime": "2026-03-13 19:24:53"
//         },

// {
//     "type": "Pt99.95",
//     "typename": "沪铂95",
//     "price": "537.85",
//     "openingprice": "547.00",
//     "maxprice": "547.00",
//     "minprice": "537.85",
//     "changepercent": "-2.78",
//     "lastclosingprice": "553.23",
//     "tradeamount": "54.00",
//     "updatetime": "2026-03-13 19:24:53"
// },

//         {
//             "type": "Ag99.99",
//             "typename": "白银9999",
//             "price": "21880",
//             "openingprice": "21720",
//             "maxprice": "21880",
//             "minprice": "21720",
//             "changepercent": "-2.52",
//             "lastclosingprice": "22445",
//             "tradeamount": "46",
//             "updatetime": "2026-03-13 19:25:51"
//         }



const METAL_CODES = {
  gold: 'AU99.99', // 黄金
  silver: 'Ag99.99', // 白银
  platinum: 'Pt99.95', // 铂金

  gold_usd: 'XAU', // 黄金美元价格
  silver_usd: 'XAG', // 白银美元价格
  platinum_usd: 'XPT', // 铂金美元价格
}

const METAL_NAMES = {
  'XAU': 'gold_usd',
  'XAG': 'silver_usd',
  'XPT': 'platinum_usd',
}

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

interface ICachedPriceData {
  time: string
  gold: IJisuApiResultItem | null
  platinum: IJisuApiResultItem | null
  silver: IJisuApiResultItem | null

  gold_usd?: IGoldApiResult | null
  silver_usd?: IGoldApiResult | null
  platinum_usd?: IGoldApiResult | null
}

// {
//   "timestamp": 1773660307,
//   "metal": "XAU",
//   "currency": "USD",
//   "exchange": "FOREXCOM",
//   "symbol": "FOREXCOM:XAUUSD",
//   "prev_close_price": 5019.175,
//   "open_price": 5019.175,
//   "low_price": 4967.61,
//   "high_price": 5036.255,
//   "open_time": 1773619200,
//   "price": 5019.315,
//   "ch": 0.14,
//   "chp": 0.01,
//   "ask": 5019.91,
//   "bid": 5018.99,
//   "price_gram_24k": 161.3747,
//   "price_gram_22k": 147.9268,
//   "price_gram_21k": 141.2029,
//   "price_gram_20k": 134.4789,
//   "price_gram_18k": 121.031,
//   "price_gram_16k": 107.5831,
//   "price_gram_14k": 94.1353,
//   "price_gram_10k": 67.2395
// }


interface IGoldApiResult {
  "timestamp": number,
  "metal": string, // "XAU", "XAG", "XPT"
  "currency": string,
  "exchange": string,
  "symbol": string,
  "prev_close_price": number, // 昨收价
  "open_price": number, // 开盘价
  "low_price": number, // 最低价
  "high_price": number, // 最高价
  "open_time": number,
  "price": number, // 当前价
  "ch": number,
  "chp": number,
  "ask": number,
  "bid": number,
  "price_gram_24k": number,
  "price_gram_22k": number,
  "price_gram_21k": number,
  "price_gram_20k": number,
  "price_gram_18k": number,
  "price_gram_16k": number,
  "price_gram_14k": number,
  "price_gram_10k": number
}

/** Align a timestamp down to the current 30-minute window start */
function align30Min(ts: number): number {
  return Math.floor(ts / FETCH_INTERVAL_MS) * FETCH_INTERVAL_MS
}

export class GoldPrice implements IFeature {

  public feature_name = '今日金价: -gold 或 gold 查看今日金价'

  private readonly Result =
    '💰 国内金价 数据来源: Jisu API ( https://www.jisuapi.com/ )\n'
    + '黄金价格: {gold}元/克\n'
    + '  开盘价: {gold_open}元/克 最高价: {gold_high}元/克 最低价: {gold_low}元/克\n'
    + '  涨跌幅: {gold_changepercent}% 昨收价: {gold_lastclosingprice}元/克 更新时间: {gold_updatetime}\n\n'
    + '白银价格: {silver}元/公斤\n'
    + '  开盘价: {silver_open}元/公斤 最高价: {silver_high}元/公斤 最低价: {silver_low}元/公斤\n'
    + '  涨跌幅: {silver_changepercent}% 昨收价: {silver_lastclosingprice}元/公斤 更新时间: {silver_updatetime}\n\n'
    + '铂金价格: {platinum}元/克\n'
    + '  开盘价: {platinum_open}元/克 最高价: {platinum_high}元/克 最低价: {platinum_low}元/克\n'
    + '  涨跌幅: {platinum_changepercent}% 昨收价: {platinum_lastclosingprice}元/克 更新时间: {platinum_updatetime}\n\n'
    + '💰 国际金价 数据来源: GoldAPI ( https://www.goldapi.io/ ) 汇率数据来源: 汇率 API ( https://currencyapi.net/ )\n'
    + '黄金美元价格: {gold_usd} USD/盎司 折合 {gold_usd_cny}元/克\n'
    + '  开盘价: {gold_usd_open} USD/盎司 最高价: {gold_usd_high} USD/盎司 最低价: {gold_usd_low} USD/盎司\n'
    + '  涨跌幅: {gold_usd_changepercent}% 昨收价: {gold_usd_lastclosingprice} USD/盎司 更新时间: {gold_usd_updatetime}\n\n'
    + '白银美元价格: {silver_usd} USD/盎司 折合 {silver_usd_cny}元/克\n'
    + '  开盘价: {silver_usd_open} USD/盎司 最高价: {silver_usd_high} USD/盎司 最低价: {silver_usd_low} USD/盎司\n'
    + '  涨跌幅: {silver_usd_changepercent}% 昨收价: {silver_usd_lastclosingprice} USD/盎司 更新时间: {silver_usd_updatetime}\n\n'
    + '铂金美元价格: {platinum_usd} USD/盎司 折合 {platinum_usd_cny}元/克\n'
    + '  开盘价: {platinum_usd_open} USD/盎司 最高价: {platinum_usd_high} USD/盎司 最低价: {platinum_usd_low} USD/盎司\n'
    + '  涨跌幅: {platinum_usd_changepercent}% 昨收价: {platinum_usd_lastclosingprice} USD/盎司 更新时间: {platinum_usd_updatetime}\n'


  public check_command(msg: Receive[keyof Receive]): boolean {
    return msg.type == 'text' && (msg.data.text === '-gold' || msg.data.text === 'gold');
  }

  /** Get the Redis key for a given 15-min window */
  private getCacheKey(windowTs: number): string {
    return `gold:prices:${windowTs}`
  }

  /** Try to load cached prices from Redis for the current 15-min window */
  private async getCachedPrices(windowTs: number): Promise<ICachedPriceData | null> {
    const key = this.getCacheKey(windowTs)
    const cached = await redis.get(key)
    if (!cached) return null
    try {
      return JSON.parse(cached) as ICachedPriceData
    } catch {
      return null
    }
  }

  /** Store prices into Redis keyed by the 15-min window */
  private async cachePrices(windowTs: number, data: ICachedPriceData): Promise<void> {
    const key = this.getCacheKey(windowTs)
    await redis.setex(key, CACHE_EXPIRE, JSON.stringify(data))
  }

  /** Try to load cached prices from Redis for the current 15-min window */
  private async getCachedRate(): Promise<ICachedRateData | null> {
    const key = `RATE:USD:CNY`
    const cached = await redis.get(key)
    if (!cached) return null
    try {
      return JSON.parse(cached) as ICachedRateData
    } catch {
      return null
    }
  }

  /** Store prices into Redis keyed by the 15-min window */
  private async cacheRate(data: ICachedRateData): Promise<void> {
    const key = `RATE:USD:CNY`
    await redis.set(key, JSON.stringify(data))
  }

  private async fetchUSDRateCNY(): Promise<ICachedRateData | null> {
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
        update_time: this.formatDatetime(json.updated * 1000),
        usd_cny: json.rates.CNY,
      }
      await this.cacheRate(ret)
      return ret
    }
    return null
  }

  private async fetchCNYGoldPrice(): Promise<IJisuApiResult | null> {
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
    return json
  }

  private async fetchCNYSilverPrice(): Promise<IJisuApiResult | null> {
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
    return json
  }

  private async fetchCNYPricesFromAPI(): Promise<ICachedPriceData> {
    const [gold, silver] = await Promise.all([
      this.fetchCNYGoldPrice(),
      this.fetchCNYSilverPrice(),
    ])

    const priceMap: Partial<Record<string, IJisuApiResultItem>> = {}
    if (gold)
      if (gold.status === 0) {
        for (const item of gold.result) {
          priceMap[item.type] = item
        }
      }
      else if (gold.status === 104) {
        priceMap[METAL_CODES.gold] = {
          type: METAL_CODES.gold,
          typename: '黄金',
          price: 'N/A', // 当前价
          openingprice: 'N/A', // 开盘价
          maxprice: 'N/A', // 最高价
          minprice: 'N/A', // 最低价
          changepercent: 'N/A', // 涨跌幅
          lastclosingprice: 'N/A', // 昨收价
          tradeamount: 'N/A', // 成交量
          updatetime: 'N/A', // 更新时间
        }
        priceMap[METAL_CODES.platinum] = {
          type: METAL_CODES.platinum,
          typename: '铂金',
          price: 'N/A', // 当前价
          openingprice: 'N/A', // 开盘价
          maxprice: 'N/A', // 最高价
          minprice: 'N/A', // 最低价
          changepercent: 'N/A', // 涨跌幅
          lastclosingprice: 'N/A', // 昨收价
          tradeamount: 'N/A', // 成交量
          updatetime: 'N/A', // 更新时间
        }
      }

    if (silver)
      if (silver.status === 0) {
        for (const item of silver.result) {
          priceMap[item.type] = item
        }
      }
      else if (silver.status === 104) {
        priceMap[METAL_CODES.silver] = {
          type: METAL_CODES.silver,
          typename: '白银',
          price: 'N/A', // 当前价
          openingprice: 'N/A', // 开盘价
          maxprice: 'N/A', // 最高价
          minprice: 'N/A', // 最低价
          changepercent: 'N/A', // 涨跌幅
          lastclosingprice: 'N/A', // 昨收价
          tradeamount: 'N/A', // 成交量
          updatetime: 'N/A', // 更新时间
        }
      }

    return {
      time: this.formatDatetime(Date.now()),
      gold: priceMap[METAL_CODES.gold] ?? null,
      silver: priceMap[METAL_CODES.silver] ?? null,
      platinum: priceMap[METAL_CODES.platinum] ?? null,
    }
  }

  private async fetchUSDPrice(metal: string): Promise<IGoldApiResult | null> {
    let retryCount = 0
    let json: IGoldApiResult | null = null
    while (retryCount < FETCH_RETRY_LIMIT) {
      try {
        const url = GOLD_API_URLS[metal as keyof typeof GOLD_API_URLS]
        const res = await fetch(url, { method: 'GET', headers: { 'x-access-token': GOLD_API_TOKEN } })
        if (!res.ok) {
          throw new Error(`Failed to fetch ${metal} price: ${res.status} ${res.statusText}`)
        }
        json = await res.json() as IGoldApiResult
        break
      }
      catch (err) {
        console.error(`[GoldPrice] Error fetching ${metal} price:`, err)
        retryCount++
        console.log(`[GoldPrice] Retrying... (${retryCount}/${FETCH_RETRY_LIMIT})`)
        await new Promise(resolve => setTimeout(resolve, 1000)) // Exponential backoff
        continue
      }
    }

    return json
  }

  private async fetchUSDPricesFromAPI(): Promise<Partial<Record<string, IGoldApiResult>>> {
    const metals = ['XAU', 'XAG', 'XPT']
    const results: Partial<Record<string, IGoldApiResult>> = {}
    for (const metal of metals) {
      try {
        const result = await this.fetchUSDPrice(metal)
        if (result) {
          results[METAL_NAMES[result.metal]] = result
        }
      } catch (err) {
        console.error(`[GoldPrice] Error fetching ${metal} price:`, err)
      }
    }
    return results
  }

  /** Format a timestamp to a readable Beijing-time datetime string */
  private formatDatetime(ts: number): string {
    if (!ts || isNaN(ts)) return 'N/A'
    const bj = new Date(ts + 8 * 3600 * 1000)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`
  }

  async deal_with_message(
    context: PrivateFriendMessage | PrivateGroupMessage | GroupMessage,
    msg: Receive[keyof Receive],
    user: { user_id: number; nickname: string; card: string }
  ): Promise<SendMessageSegment | null> {

    const now = Date.now()
    const windowTs = align30Min(now)

    try {
      // Check cache first — skip API request if already stored for this 30-min window
      let result = await this.getCachedPrices(windowTs)

      if (result
        && result.gold && result.silver && result.platinum
        && result.gold_usd && result.silver_usd && result.platinum_usd
      ) {
        // All data is present in cache, can use it directly
        console.log(`[GoldPrice] Cache hit for window ${windowTs}`)
      }
      else if (!result) {
        console.log(`[GoldPrice] Cache miss for window ${windowTs}, fetching from API...`)
        let result1 = await this.fetchCNYPricesFromAPI()
        let result2 = await this.fetchUSDPricesFromAPI()

        result = {
          ...result1,
          ...result2,
        }

        await this.cachePrices(windowTs, result)

        console.log(`[GoldPrice] Prices cached: ${JSON.stringify(result)}`)
      }
      else {

        if (!result.gold || !result.platinum) {
          try {
            const cnyGold = await this.fetchCNYGoldPrice();
            result.gold = cnyGold?.result?.find(item => item.type === METAL_CODES.gold) || result.gold || null
            result.platinum = cnyGold?.result?.find(item => item.type === METAL_CODES.platinum) || result.platinum || null
          }
          catch (err) {
            console.error('[GoldPrice] Error fetching CNY gold/platinum price:', err)
          }
        }

        if (!result.silver) {
          try {
            const cnySilver = await this.fetchCNYSilverPrice();
            result.silver = cnySilver?.result?.find(item => item.type === METAL_CODES.silver) || result.silver || null
          }
          catch (err) {
            console.error('[GoldPrice] Error fetching CNY silver price:', err)
          }
        }

        if (!result.gold_usd) {
          try {
            const goldUsd = await this.fetchUSDPrice('XAU');
            result.gold_usd = goldUsd || result.gold_usd || null
          }
          catch (err) {
            console.error('[GoldPrice] Error fetching gold USD price:', err)
          }
        }

        if (!result.silver_usd) {
          try {
            const silverUsd = await this.fetchUSDPrice('XAG');
            result.silver_usd = silverUsd || result.silver_usd || null
          }
          catch (err) {
            console.error('[GoldPrice] Error fetching silver USD price:', err)
          }
        }

        if (!result.platinum_usd) {
          try {
            const platinumUsd = await this.fetchUSDPrice('XPT');
            result.platinum_usd = platinumUsd || result.platinum_usd || null
          }
          catch (err) {
            console.error('[GoldPrice] Error fetching platinum USD price:', err)
          }
        }
      }

      let usdCnyRate: number | null = null
      try {
        let rate = await this.getCachedRate()
        if (!rate || typeof rate.usd_cny !== 'number' || (now - rate.time) >= FETCH_INTERVAL_MS) {
          let fetchedRate = await this.fetchUSDRateCNY()
          if (fetchedRate && typeof fetchedRate.usd_cny === 'number') {
            rate = fetchedRate
          }
        }

        if (rate && typeof rate.usd_cny === 'number') {
          usdCnyRate = rate.usd_cny
        }
      }
      catch (err) {
        console.error('[GoldPrice] Error fetching USD/CNY rate:', err)
      }

      const ret = this.Result
        .replace('{datetime}', result.time)

        .replace('{gold}', result.gold ? result.gold.price : 'N/A')
        .replace('{gold_open}', result.gold ? result.gold.openingprice : 'N/A')
        .replace('{gold_high}', result.gold ? result.gold.maxprice : 'N/A')
        .replace('{gold_low}', result.gold ? result.gold.minprice : 'N/A')
        .replace('{gold_changepercent}', result.gold ? result.gold.changepercent : 'N/A')
        .replace('{gold_lastclosingprice}', result.gold ? result.gold.lastclosingprice : 'N/A')
        .replace('{gold_updatetime}', result.gold ? result.gold.updatetime : 'N/A')

        .replace('{silver}', result.silver ? result.silver.price : 'N/A')
        .replace('{silver_open}', result.silver ? result.silver.openingprice : 'N/A')
        .replace('{silver_high}', result.silver ? result.silver.maxprice : 'N/A')
        .replace('{silver_low}', result.silver ? result.silver.minprice : 'N/A')
        .replace('{silver_changepercent}', result.silver ? result.silver.changepercent : 'N/A')
        .replace('{silver_lastclosingprice}', result.silver ? result.silver.lastclosingprice : 'N/A')
        .replace('{silver_updatetime}', result.silver ? result.silver.updatetime : 'N/A')

        .replace('{platinum}', result.platinum ? result.platinum.price : 'N/A')
        .replace('{platinum_open}', result.platinum ? result.platinum.openingprice : 'N/A')
        .replace('{platinum_high}', result.platinum ? result.platinum.maxprice : 'N/A')
        .replace('{platinum_low}', result.platinum ? result.platinum.minprice : 'N/A')
        .replace('{platinum_changepercent}', result.platinum ? result.platinum.changepercent : 'N/A')
        .replace('{platinum_lastclosingprice}', result.platinum ? result.platinum.lastclosingprice : 'N/A')
        .replace('{platinum_updatetime}', result.platinum ? result.platinum.updatetime : 'N/A')

        .replace('{gold_usd}', result.gold_usd ? result.gold_usd.price.toFixed(2) : 'N/A')
        .replace('{gold_usd_cny}', result.gold_usd && typeof usdCnyRate === 'number' ? (result.gold_usd.price * usdCnyRate / OUNCE_TO_GRAM).toFixed(2) : 'N/A')
        .replace('{gold_usd_open}', result.gold_usd ? result.gold_usd.open_price.toFixed(2) : 'N/A')
        .replace('{gold_usd_high}', result.gold_usd ? result.gold_usd.high_price.toFixed(2) : 'N/A')
        .replace('{gold_usd_low}', result.gold_usd ? result.gold_usd.low_price.toFixed(2) : 'N/A')
        .replace('{gold_usd_changepercent}', result.gold_usd ? result.gold_usd.chp.toFixed(2) : 'N/A')
        .replace('{gold_usd_lastclosingprice}', result.gold_usd ? result.gold_usd.prev_close_price.toFixed(2) : 'N/A')
        .replace('{gold_usd_updatetime}', result.gold_usd ? this.formatDatetime(result.gold_usd.timestamp * 1000) : 'N/A')

        .replace('{silver_usd}', result.silver_usd ? result.silver_usd.price.toFixed(2) : 'N/A')
        .replace('{silver_usd_cny}', result.silver_usd && typeof usdCnyRate === 'number' ? (result.silver_usd.price * usdCnyRate / OUNCE_TO_GRAM).toFixed(2) : 'N/A')
        .replace('{silver_usd_open}', result.silver_usd ? result.silver_usd.open_price.toFixed(2) : 'N/A')
        .replace('{silver_usd_high}', result.silver_usd ? result.silver_usd.high_price.toFixed(2) : 'N/A')
        .replace('{silver_usd_low}', result.silver_usd ? result.silver_usd.low_price.toFixed(2) : 'N/A')
        .replace('{silver_usd_changepercent}', result.silver_usd ? result.silver_usd.chp.toFixed(2) : 'N/A')
        .replace('{silver_usd_lastclosingprice}', result.silver_usd ? result.silver_usd.prev_close_price.toFixed(2) : 'N/A')
        .replace('{silver_usd_updatetime}', result.silver_usd ? this.formatDatetime(result.silver_usd.timestamp * 1000) : 'N/A')

        .replace('{platinum_usd}', result.platinum_usd ? result.platinum_usd.price.toFixed(2) : 'N/A')
        .replace('{platinum_usd_cny}', result.platinum_usd && typeof usdCnyRate === 'number' ? (result.platinum_usd.price * usdCnyRate / OUNCE_TO_GRAM).toFixed(2) : 'N/A')
        .replace('{platinum_usd_open}', result.platinum_usd ? result.platinum_usd.open_price.toFixed(2) : 'N/A')
        .replace('{platinum_usd_high}', result.platinum_usd ? result.platinum_usd.high_price.toFixed(2) : 'N/A')
        .replace('{platinum_usd_low}', result.platinum_usd ? result.platinum_usd.low_price.toFixed(2) : 'N/A')
        .replace('{platinum_usd_changepercent}', result.platinum_usd ? result.platinum_usd.chp.toFixed(2) : 'N/A')
        .replace('{platinum_usd_lastclosingprice}', result.platinum_usd ? result.platinum_usd.prev_close_price.toFixed(2) : 'N/A')
        .replace('{platinum_usd_updatetime}', result.platinum_usd ? this.formatDatetime(result.platinum_usd.timestamp * 1000) : 'N/A')

      return Structs.text(ret)
    } catch (err) {
      console.error('[GoldPrice] Error fetching prices:', err)
      return Structs.text(`获取金价失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export const goldPrice = new GoldPrice()
export default goldPrice