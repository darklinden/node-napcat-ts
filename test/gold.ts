import { IFeature } from './Feature'
import { GroupMessage, PrivateFriendMessage, PrivateGroupMessage, Receive, Structs } from '../src'
import { type SendMessageSegment } from '../src/index.js'
import redis from './redis.js'

// https://api.jisuapi.com/gold/shgold?appkey=<appkey>
// https://api.jisuapi.com/silver/shgold?appkey=<appkey>
const GOLD_BASE_URL = 'https://api.jisuapi.com/'
const GOLD_TOKEN = process.env.GOLD_API_TOKEN ?? ''
const GOLD_PRICE_URL = `${GOLD_BASE_URL}/gold/shgold?appkey=${GOLD_TOKEN}`
const SILVER_PRICE_URL = `${GOLD_BASE_URL}/silver/shgold?appkey=${GOLD_TOKEN}`

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

  private fetchGoldPrice(): Promise<IJisuApiResult> {
    return fetch(GOLD_PRICE_URL)
      .then(res => res.json())
      .then((json: IJisuApiResult) => {
        if (json.status !== 0) {
          throw new Error(`API error: ${json.msg}`)
        }
        return json
      })
  }

  private fetchSilverPrice(): Promise<IJisuApiResult> {
    return fetch(SILVER_PRICE_URL)
      .then(res => res.json())
      .then((json: IJisuApiResult) => {
        if (json.status !== 0) {
          throw new Error(`API error: ${json.msg}`)
        }
        return json
      })
  }

  /** Fetch latest 15-min K-line prices from AllTick batch-kline API */
  private async fetchPricesFromAPI(): Promise<ICachedPriceData> {
    const [gold, silver] = await Promise.all([
      this.fetchGoldPrice(),
      this.fetchSilverPrice(),
    ])

    const priceMap: Partial<Record<string, IJisuApiResultItem>> = {}
    for (const item of [...gold.result, ...silver.result]) {
      priceMap[item.type] = item
    }

    return {
      time: this.formatDatetime(Date.now()),
      gold: priceMap[METAL_CODES.gold] ?? null,
      silver: priceMap[METAL_CODES.silver] ?? null,
      platinum: priceMap[METAL_CODES.platinum] ?? null,
    }
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

      if (!result) {
        console.log(`[GoldPrice] Cache miss for window ${windowTs}, fetching from AllTick API...`)
        result = await this.fetchPricesFromAPI()
        await this.cachePrices(windowTs, result)
        console.log(`[GoldPrice] Prices cached: gold=${JSON.stringify(result.gold)}, silver=${JSON.stringify(result.silver)}, platinum=${JSON.stringify(result.platinum)}`)
      } else {
        console.log(`[GoldPrice] Cache hit for window ${windowTs}`)
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

      return Structs.text(ret)
    } catch (err) {
      console.error('[GoldPrice] Error fetching prices:', err)
      return Structs.text(`获取金价失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export const goldPrice = new GoldPrice()
export default goldPrice