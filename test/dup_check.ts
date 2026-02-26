import { Receive } from '../src';
import { IFeature } from './Feature'
import { distance as levenshtein } from 'fastest-levenshtein';
import phash from './phash'
import Redis from 'ioredis';
import { imageSize, disableFS } from 'image-size';

const MIN_WIDTH = 512
const MIN_HEIGHT = 512
const EXPIRE_DURATION = 10 * 24 * 3600 // 10 天
const MAX_CALL_OUT = 10
const COOLDOWN = 180 * 1000 // 3 分钟

export class DupCheck implements IFeature {

  public feature_name = '火星图出警'

  constructor() {
    disableFS(true)
  }

  distanceRatio(a: string, b: string): number {
    return levenshtein(a, b) / Math.max(a.length, b.length)
  }

  /**
   * @param {number} number
   * @param {number} digits
   * @returns {string}
   */
  padZero(num: number, digits: number): string {
    return num.toString().padStart(digits, '0')
  }

  /**
   * @param {number} timestamp
   * @returns {string}
   */
  formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp + 8 * 3600 * 1000) // 转换为北京时间

    const year = this.padZero(date.getFullYear(), 4)
    const month = this.padZero(date.getMonth() + 1, 2)
    const day = this.padZero(date.getDate(), 2)
    const hours = this.padZero(date.getHours(), 2)
    const minutes = this.padZero(date.getMinutes(), 2)
    const seconds = this.padZero(date.getSeconds(), 2)

    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`
  }

  check_command(msg: Receive[keyof Receive]): boolean {
    return msg.type === 'image';
  }

  private _redis: Redis | null = null;
  private get redis(): Redis {
    if (!this._redis) {
      this._redis = new Redis(process.env.REDIS_URL!)
    }
    return this._redis
  }

  async levenshteinRedis(imageHash: string, similarityThreshold: number): Promise<{ key: string; similarity: number } | null> {
    let cursor = '0';
    let keysWithSimilarity: { key: string, similarity: number } | null = null;

    do {
      const result = await this.redis.scan(cursor, 'MATCH', 'image:*', 'COUNT', 1000);
      cursor = result[0];

      for (const key of result[1]) {
        let hash = key.slice(6); // Remove 'image:' prefix
        const similarity = this.distanceRatio(imageHash, hash);
        if (similarity < similarityThreshold) {
          keysWithSimilarity = { key, similarity };
          break;
        }
      }

    } while (cursor !== '0' && !keysWithSimilarity);

    return keysWithSimilarity;
  }

  async deal_with_message(msg: Receive[keyof Receive], user: { user_id: number; nickname: string; card: string }): Promise<string> {

    if (msg.type !== 'image') {
      console.log(`Message is not an image, skipping`);
      return '';
    }

    let imageHash: string | null = null;
    try {
      const resp = await fetch(msg.data.url, {
        headers: {
          responseType: 'arraybuffer',
        }
      });
      const imageBuffer = await resp.arrayBuffer();
      const { width, height, type: imageType } = await imageSize(new Uint8Array(imageBuffer))
      if (width === undefined || height === undefined || (width < MIN_WIDTH && height < MIN_HEIGHT)) {
        console.log(`Image is too small, skipping: ${width}x${height}`);
        return '';
      }
      if (imageType === undefined || !['jpg', 'png', 'bmp', 'webp', 'tiff'].includes(imageType)) {
        console.log(`Unsupported image type, skipping: ${imageType}`);
        return '';
      }

      imageHash = await phash(imageBuffer, 16)
    } catch (error) {
      console.log('Something wrong happened during the request of the image')
      console.log(error)
    }

    if (!imageHash) {
      console.log('Failed to compute image hash, skipping');
      return '';
    }

    let record = await this.levenshteinRedis(imageHash, 0.1);

    if (!record) {
      await this.redis.setex(`image:${imageHash}`, EXPIRE_DURATION, JSON.stringify({
        content: imageHash,
        count: 0,
        id: user.user_id,
        sender: user.nickname,
        timestamp: Date.now(),
        cooldown: undefined,
      }));
      console.log(`New Image hash stored: ${imageHash}`);
      return '';
    }

    let jsonStr = await this.redis.get(`image:${imageHash}`);
    if (!jsonStr) return '';

    let recordData = JSON.parse(jsonStr);
    recordData.count++;
    recordData.timestamp = Date.now();
    await this.redis.setex(`image:${imageHash}`, EXPIRE_DURATION, JSON.stringify(recordData));

    if (recordData.count >= MAX_CALL_OUT) {
      console.log(`Max call out reached for image: ${imageHash}`);
      return '';
    }
    if (recordData.cooldown && recordData.cooldown >= recordData.timestamp) {
      console.log(`Image is still in cooldown: ${imageHash}`);
      return '';
    }

    recordData.cooldown = recordData.timestamp + COOLDOWN - 1;

    console.log(`Duplicate image detected: ${imageHash}, similarity: ${record.similarity}, count: ${recordData.count}`);

    return `出警！${user.nickname} 又在发火星图了！` +
      `图片` +
      `由 ${recordData.sender} (${recordData.id})` +
      `于 ${this.formatTimestamp(recordData.timestamp)} 发过，` +
      `已经被发过了 ${recordData.count} 次！`;
  }
}

export const dup_check = new DupCheck()
export default dup_check
