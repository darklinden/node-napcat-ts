import { IFeature } from './Feature'
import { GroupMessage, PrivateFriendMessage, PrivateGroupMessage, Receive, Structs } from '../src'
import { type SendMessageSegment } from '../src/index.js'
import redis from './redis.js'

// https://api.jisuapi.com/gold/shgold?appkey=<appkey>
// https://api.jisuapi.com/silver/shgold?appkey=<appkey>
const JISU_GOLD_BASE_URL = 'https://api.jisuapi.com/'
const JISU_GOLD_TOKEN = process.env.JISU_API_TOKEN ?? ''
const JISU_GOLD_PRICE_URL = `${JISU_GOLD_BASE_URL}/gold/shgold?appkey=${JISU_GOLD_TOKEN}`
const JISU_SILVER_PRICE_URL = `${JISU_GOLD_BASE_URL}/silver/shgold?appkey=${JISU_GOLD_TOKEN}`

const GOLD_API_BASE_URL = 'https://www.goldapi.io/api/'
const GOLD_API_TOKEN = process.env.GOLD_API_TOKEN ?? ''
const GOLD_API_URLS = {
  XAU: `${GOLD_API_BASE_URL}XAU/USD`,
  XAG: `${GOLD_API_BASE_URL}XAG/USD`,
  XPT: `${GOLD_API_BASE_URL}XPT/USD`,
}

const FETCH_RETRY_LIMIT = 5

const FIFTEEN_MIN_MS = 30 * 60 * 1000
const CACHE_EXPIRE = 40 * 60 // 40 minutes in seconds, slightly longer than 15m window

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
  status: number
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
  return Math.floor(ts / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS
}

export class GoldPrice implements IFeature {

  public feature_name = '今日金价: -gold 或 gold 查看今日金价'

  private readonly Result =
    '💰 今日金价 {datetime}\n'
    + '今日金价: {gold}元/克\n  开盘价: {gold_open}元/克\n  最高价: {gold_high}元/克\n  最低价: {gold_low}元/克\n  涨跌幅: {gold_changepercent}%\n  昨收价: {gold_lastclosingprice}元/克\n'
    + '白银价格: {silver}元/公斤\n  开盘价: {silver_open}元/公斤\n  最高价: {silver_high}元/公斤\n  最低价: {silver_low}元/公斤\n  涨跌幅: {silver_changepercent}%\n  昨收价: {silver_lastclosingprice}元/公斤\n'
    + '铂金价格: {platinum}元/克\n  开盘价: {platinum_open}元/克\n  最高价: {platinum_high}元/克\n  最低价: {platinum_low}元/克\n  涨跌幅: {platinum_changepercent}%\n  昨收价: {platinum_lastclosingprice}元/克\n'
    + '数据来源: Jisu API (https://www.jisuapi.com/)\n\n'
    + '黄金美元价格: {gold_usd} USD/盎司\n  开盘价: {gold_usd_open} USD/盎司\n  最高价: {gold_usd_high} USD/盎司\n  最低价: {gold_usd_low} USD/盎司\n  涨跌幅: {gold_usd_changepercent}%\n  昨收价: {gold_usd_lastclosingprice} USD/盎司\n'
    + '白银美元价格: {silver_usd} USD/盎司\n  开盘价: {silver_usd_open} USD/盎司\n  最高价: {silver_usd_high} USD/盎司\n  最低价: {silver_usd_low} USD/盎司\n  涨跌幅: {silver_usd_changepercent}%\n  昨收价: {silver_usd_lastclosingprice} USD/盎司\n'
    + '铂金美元价格: {platinum_usd} USD/盎司\n  开盘价: {platinum_usd_open} USD/盎司\n  最高价: {platinum_usd_high} USD/盎司\n  最低价: {platinum_usd_low} USD/盎司\n  涨跌幅: {platinum_usd_changepercent}%\n  昨收价: {platinum_usd_lastclosingprice} USD/盎司\n'
    + '数据来源: GoldAPI (https://www.goldapi.io/)'


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
    // Also store per-metal keys for historical tracking
    for (const [metal, price] of Object.entries(data)) {
      if (metal === 'timestamp') continue
      await redis.setex(`gold:${metal}:${windowTs}`, CACHE_EXPIRE, price)
    }
  }

  private async fetchCNYGoldPrice(): Promise<IJisuApiResult | null> {
    let retryCount = 0
    let json: IJisuApiResult | null = null
    while (retryCount < FETCH_RETRY_LIMIT) {
      try {
        const res = await fetch(JISU_GOLD_PRICE_URL)
        json = await res.json()
        if (!json || json.status !== 0) {
          throw new Error(`API error: ${json?.msg}`)
        }
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
        if (!json || json.status !== 0) {
          throw new Error(`API error: ${json?.msg}`)
        }
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
    if (gold && gold.status === 0) {
      for (const item of gold.result) {
        priceMap[item.type] = item
      }
    }
    if (silver && silver.status === 0) {
      for (const item of silver.result) {
        priceMap[item.type] = item
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
        const res = await fetch(url, { headers: { 'x-access-token': GOLD_API_TOKEN } })
        if (!res.ok) {
          throw new Error(`Failed to fetch ${metal} price: ${res.status} ${res.statusText}`)
        }
        json = await res.json() as IGoldApiResult
      }
      catch (err) {
        console.error(`[GoldPrice] Error fetching ${metal} price:`, err)
        retryCount++
        console.log(`[GoldPrice] Retrying... (${retryCount}/${FETCH_RETRY_LIMIT})`)
        await new Promise(resolve => setTimeout(resolve, 1000)) // Exponential backoff
        continue
      }
      break
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
          results[metal.toLowerCase()] = result
        }
      } catch (err) {
        console.error(`[GoldPrice] Error fetching ${metal} price:`, err)
      }
    }
    return results
  }

  /** Format a timestamp to a readable Beijing-time datetime string */
  private formatDatetime(ts: number): string {
    const date = new Date(ts)
    const bj = new Date(date.getTime() + 8 * 3600 * 1000)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}`
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
        console.log(`[GoldPrice] Cache miss for window ${windowTs}, fetching from AllTick API...`)
        var result1 = await this.fetchCNYPricesFromAPI()
        var result2 = await this.fetchUSDPricesFromAPI()

        result = {
          ...result1,
          ...result2,
        }

        await this.cachePrices(windowTs, result)

        console.log(`[GoldPrice] Prices cached: ${JSON.stringify(result)}`)
      }
      else {

        if (!result.gold || !result.platinum) {
          const cnyGold = await this.fetchCNYGoldPrice();
          result.gold = cnyGold?.result.find(item => item.type === METAL_CODES.gold) || result.gold || null
          result.platinum = cnyGold?.result.find(item => item.type === METAL_CODES.platinum) || result.platinum || null
        }

        if (!result.silver) {
          const cnySilver = await this.fetchCNYSilverPrice();
          result.silver = cnySilver?.result.find(item => item.type === METAL_CODES.silver) || result.silver || null
        }

        if (!result.gold_usd) {
          const goldUsd = await this.fetchUSDPrice('XAU');
          result.gold_usd = goldUsd || result.gold_usd || null
        }

        if (!result.silver_usd) {
          const silverUsd = await this.fetchUSDPrice('XAG');
          result.silver_usd = silverUsd || result.silver_usd || null
        }

        if (!result.platinum_usd) {
          const platinumUsd = await this.fetchUSDPrice('XPT');
          result.platinum_usd = platinumUsd || result.platinum_usd || null
        }
      }

      const ret = this.Result
        .replace('{datetime}', result.time)

        .replace('{gold}', result.gold ? result.gold.price : 'N/A')
        .replace('{gold_open}', result.gold ? result.gold.openingprice : 'N/A')
        .replace('{gold_high}', result.gold ? result.gold.maxprice : 'N/A')
        .replace('{gold_low}', result.gold ? result.gold.minprice : 'N/A')
        .replace('{gold_changepercent}', result.gold ? result.gold.changepercent : 'N/A')
        .replace('{gold_lastclosingprice}', result.gold ? result.gold.lastclosingprice : 'N/A')

        .replace('{silver}', result.silver ? result.silver.price : 'N/A')
        .replace('{silver_open}', result.silver ? result.silver.openingprice : 'N/A')
        .replace('{silver_high}', result.silver ? result.silver.maxprice : 'N/A')
        .replace('{silver_low}', result.silver ? result.silver.minprice : 'N/A')
        .replace('{silver_changepercent}', result.silver ? result.silver.changepercent : 'N/A')
        .replace('{silver_lastclosingprice}', result.silver ? result.silver.lastclosingprice : 'N/A')

        .replace('{platinum}', result.platinum ? result.platinum.price : 'N/A')
        .replace('{platinum_open}', result.platinum ? result.platinum.openingprice : 'N/A')
        .replace('{platinum_high}', result.platinum ? result.platinum.maxprice : 'N/A')
        .replace('{platinum_low}', result.platinum ? result.platinum.minprice : 'N/A')
        .replace('{platinum_changepercent}', result.platinum ? result.platinum.changepercent : 'N/A')
        .replace('{platinum_lastclosingprice}', result.platinum ? result.platinum.lastclosingprice : 'N/A')

        .replace('{gold_usd}', result.gold_usd ? result.gold_usd.price.toFixed(2) : 'N/A')
        .replace('{gold_usd_open}', result.gold_usd ? result.gold_usd.open_price.toFixed(2) : 'N/A')
        .replace('{gold_usd_high}', result.gold_usd ? result.gold_usd.high_price.toFixed(2) : 'N/A')
        .replace('{gold_usd_low}', result.gold_usd ? result.gold_usd.low_price.toFixed(2) : 'N/A')
        .replace('{gold_usd_changepercent}', result.gold_usd ? result.gold_usd.chp.toFixed(2) : 'N/A')
        .replace('{gold_usd_lastclosingprice}', result.gold_usd ? result.gold_usd.prev_close_price.toFixed(2) : 'N/A')

        .replace('{silver_usd}', result.silver_usd ? result.silver_usd.price.toFixed(2) : 'N/A')
        .replace('{silver_usd_open}', result.silver_usd ? result.silver_usd.open_price.toFixed(2) : 'N/A')
        .replace('{silver_usd_high}', result.silver_usd ? result.silver_usd.high_price.toFixed(2) : 'N/A')
        .replace('{silver_usd_low}', result.silver_usd ? result.silver_usd.low_price.toFixed(2) : 'N/A')
        .replace('{silver_usd_changepercent}', result.silver_usd ? result.silver_usd.chp.toFixed(2) : 'N/A')
        .replace('{silver_usd_lastclosingprice}', result.silver_usd ? result.silver_usd.prev_close_price.toFixed(2) : 'N/A')

        .replace('{platinum_usd}', result.platinum_usd ? result.platinum_usd.price.toFixed(2) : 'N/A')
        .replace('{platinum_usd_open}', result.platinum_usd ? result.platinum_usd.open_price.toFixed(2) : 'N/A')
        .replace('{platinum_usd_high}', result.platinum_usd ? result.platinum_usd.high_price.toFixed(2) : 'N/A')
        .replace('{platinum_usd_low}', result.platinum_usd ? result.platinum_usd.low_price.toFixed(2) : 'N/A')
        .replace('{platinum_usd_changepercent}', result.platinum_usd ? result.platinum_usd.chp.toFixed(2) : 'N/A')
        .replace('{platinum_usd_lastclosingprice}', result.platinum_usd ? result.platinum_usd.prev_close_price.toFixed(2) : 'N/A')

      return Structs.text(ret)
    } catch (err) {
      console.error('[GoldPrice] Error fetching prices:', err)
      return Structs.text(`获取金价失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export const goldPrice = new GoldPrice()
export default goldPrice