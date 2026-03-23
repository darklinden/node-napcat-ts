export const FETCH_RETRY_LIMIT = 5

export interface IAPIRequestResult {
    // "XAU" for gold, "XAG" for silver
    metal: 'XAU' | 'XAG' | 'XPT' | 'XPD';
    // "CNY" for Chinese Yuan or "USD" for US Dollar
    currency: 'CNY' | 'USD';
    // timestamp of the latest update in milliseconds since the Unix epoch
    update: string;
    // 收盘价
    prev_close_price: string;
    // 开盘价
    open_price: string;
    // 最高价
    low_price: string;
    // 最低价
    high_price: string;
    // 当前价
    price: string;
    // 涨跌额
    change_percent: string;
}

export interface IAPIRequest {
    fetchResults(): Promise<IAPIRequestResult[]>;
}

/** Format a timestamp to a readable Beijing-time datetime string */
export function stampToString(ts: number): string {
    if (!ts || isNaN(ts)) return 'N/A'
    const bj = new Date(ts + 8 * 3600 * 1000)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`
}