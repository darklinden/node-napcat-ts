import { IFeature } from '../Feature.js'
import { GroupMessage, PrivateFriendMessage, PrivateGroupMessage, Receive, Structs } from '../../src/index.js'
import { type SendMessageSegment } from '../../src/index.js'
import redis from '../redis.js'
import { IAPIRequestResult, stampToString } from './IAPIRequest.js'
import jisuApi from './API_JISUAPI_COM.js'
import goldApi from './API_GOLDAPI_COM.js'
import { fetchUSDRateCNY, getCachedRate } from './API_CURRENCY.js'



const OUNCE_TO_GRAM = 31.1035

export const FETCH_INTERVAL_MS = 30 * 60 * 1000
const CACHE_EXPIRE = 40 * 60 // 40 minutes in seconds, slightly longer than 30m window

interface ICachedPriceData {
  time: number
  gold_cny: IAPIRequestResult
  gold_usd: IAPIRequestResult
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
    + '💰 国际金价 数据来源: GoldAPI ( https://gold-api.com/ ) 汇率数据来源: 汇率 API ( https://currencyapi.net/ )\n'
    + '黄金美元价格: {gold_usd} USD/盎司 折合 {gold_usd_cny}元/克\n'
    + '  开盘价: {gold_usd_open} USD/盎司 最高价: {gold_usd_high} USD/盎司 最低价: {gold_usd_low} USD/盎司\n'
    + '  涨跌幅: {gold_usd_changepercent}% 昨收价: {gold_usd_lastclosingprice} USD/盎司 更新时间: {gold_usd_updatetime}\n\n'

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

      if (result && result.time + FETCH_INTERVAL_MS > now) {
        // All data is present in cache, can use it directly
        console.log(`[GoldPrice] Cache hit for window ${windowTs}, using cached prices.`)
      }
      else {
        console.log(`[GoldPrice] Cache miss for window ${windowTs}, fetching from API...`)
        let [jisuResult, goldResult] = await Promise.all([
          jisuApi.fetchResults(),
          goldApi.fetchResults()
        ])

        console.log(`[GoldPrice] API results fetched. Jisu: ${JSON.stringify(jisuResult)}, GoldAPI: ${JSON.stringify(goldResult)}`)

        result = {
          time: windowTs,
          gold_cny: jisuResult.find(r => r.metal === 'XAU' && r.currency === 'CNY')!,
          gold_usd: goldResult.find(r => r.metal === 'XAU' && r.currency === 'USD')!,
        }

        await this.cachePrices(windowTs, result)
        console.log(`[GoldPrice] Prices cached: ${JSON.stringify(result)}`)
      }

      let usdCnyRate: number | null = null
      try {
        let rate = await getCachedRate()
        if (!rate || typeof rate.usd_cny !== 'number' || (now - rate.time) >= FETCH_INTERVAL_MS) {
          let fetchedRate = await fetchUSDRateCNY()
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
        .replace('{datetime}', stampToString(result.time))

        .replace('{gold}', result.gold_cny ? result.gold_cny.price : 'N/A')
        .replace('{gold_open}', result.gold_cny ? result.gold_cny.open_price : 'N/A')
        .replace('{gold_high}', result.gold_cny ? result.gold_cny.high_price : 'N/A')
        .replace('{gold_low}', result.gold_cny ? result.gold_cny.low_price : 'N/A')
        .replace('{gold_changepercent}', result.gold_cny ? result.gold_cny.change_percent : 'N/A')
        .replace('{gold_lastclosingprice}', result.gold_cny ? result.gold_cny.prev_close_price : 'N/A')
        .replace('{gold_updatetime}', result.gold_cny ? result.gold_cny.update : 'N/A')

        .replace('{gold_usd}', result.gold_usd ? result.gold_usd.price : 'N/A')
        .replace('{gold_usd_cny}', result.gold_usd && typeof usdCnyRate === 'number' ? (parseFloat(result.gold_usd.price) * usdCnyRate / OUNCE_TO_GRAM).toFixed(2) : 'N/A')
        .replace('{gold_usd_open}', result.gold_usd ? result.gold_usd.open_price : 'N/A')
        .replace('{gold_usd_high}', result.gold_usd ? result.gold_usd.high_price : 'N/A')
        .replace('{gold_usd_low}', result.gold_usd ? result.gold_usd.low_price : 'N/A')
        .replace('{gold_usd_changepercent}', result.gold_usd ? result.gold_usd.change_percent : 'N/A')
        .replace('{gold_usd_lastclosingprice}', result.gold_usd ? result.gold_usd.prev_close_price : 'N/A')
        .replace('{gold_usd_updatetime}', result.gold_usd ? result.gold_usd.update : 'N/A')

      return Structs.text(ret)
    } catch (err) {
      console.error('[GoldPrice] Error fetching prices:', err)
      return Structs.text(`获取金价失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export const goldPrice = new GoldPrice()
export default goldPrice