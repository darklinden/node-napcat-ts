import { GroupMessage, PrivateFriendMessage, PrivateGroupMessage, Receive, Structs } from '../../src';
import { IFeature } from '../Feature'
import { distance as levenshtein } from 'fastest-levenshtein';
import phash from './phash'
import { imageSize, disableFS } from 'image-size';
import { type SendMessageSegment } from '../../src/index.js'
import redis from '../redis.js';

const MIN_WIDTH = 512
const MIN_HEIGHT = 512
const EXPIRE_DURATION = 10 * 24 * 3600 // 10 天
const EMOJI_EXPIRE_DURATION = 90 * 24 * 3600 // 90 天
const MAX_CALL_OUT = 10
const MARK_EMOJI_EXPIRE_DURATION = 60 // 1 分钟

export class DupCheck implements IFeature {

  public feature_name = '火星图出警: -emoji 标记上个出警为表情包'

  /** Map of user_id -> last warned image hash, so they can dismiss with -emoji */
  private lastWarned: { user_id: number, user_name: string, hash: string, timestamp: number } | null = null;

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
    if (msg.type === 'image') return true;
    if (msg.type === 'text' && msg.data.text.trim() === '-emoji') return true;
    return false;
  }



  /**
   * Scan emoji:* keys and check if the image hash matches any known emoji.
   * Returns true if the image is a known emoji and should be skipped.
   */
  async isKnownEmoji(imageHash: string, similarityThreshold: number): Promise<boolean> {
    let cursor = '0';

    do {
      const result = await redis.scan(cursor, 'MATCH', 'emoji:*', 'COUNT', 1000);
      cursor = result[0];

      for (const key of result[1]) {
        const hash = key.slice(6); // Remove 'emoji:' prefix
        const similarity = this.distanceRatio(imageHash, hash);
        if (similarity < similarityThreshold) {
          console.log(`Image matches known emoji: ${key}, similarity: ${similarity}`);
          return true;
        }
      }
    } while (cursor !== '0');

    return false;
  }

  /**
   * Handle the -emoji command: move the last warned hash from image:* to emoji:*.
   */
  private async handleEmojiCommand(user: { user_id: number; nickname: string }): Promise<SendMessageSegment | null> {
    const hash = this.lastWarned;
    if (!hash || Date.now() - hash.timestamp > MARK_EMOJI_EXPIRE_DURATION * 1000) {
      return Structs.text('没有找到 1 分钟内最近被出警的图片，无法标记为表情包。');
    }

    let cursor = '0';
    let keysToDelete: string[] = [];
    const similarityThreshold = 0.1;
    // Get the existing record from image:*
    do {
      const result = await redis.scan(cursor, 'MATCH', 'image:*', 'COUNT', 1000);
      cursor = result[0];

      for (const key of result[1]) {
        let k = key.slice(6); // Remove 'image:' prefix
        const similarity = this.distanceRatio(k, hash.hash);
        if (similarity < similarityThreshold) {
          keysToDelete.push(key);
        }
      }

    } while (cursor !== '0');

    await redis.del(keysToDelete);

    // Add to emoji:* with longer expiry
    await redis.setex(`emoji:${hash.hash}`, EMOJI_EXPIRE_DURATION, JSON.stringify({
      content: hash.hash,
      markedById: user.user_id,
      markedByName: user.nickname,
      timestamp: Date.now(),
    }));

    // Clear the user's last warned hash
    const userId = hash.user_id;
    const userName = hash.user_name;
    this.lastWarned = null;

    console.log(`User ${userName} (${userId}) marked image as emoji: ${hash}`);
    return Structs.text(`已将 ${userName} (${userId}) 刚被出警的图片标记为表情包，后续不再出警。`);
  }

  async levenshteinRedis(imageHash: string, similarityThreshold: number): Promise<{ key: string; similarity: number } | null> {
    let cursor = '0';
    let keysWithSimilarity: { key: string, similarity: number } | null = null;

    do {
      const result = await redis.scan(cursor, 'MATCH', 'image:*', 'COUNT', 1000);
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

  async deal_with_message(
    context: PrivateFriendMessage | PrivateGroupMessage | GroupMessage,
    msg: Receive[keyof Receive],
    user: { user_id: number; nickname: string; card: string }
  ): Promise<SendMessageSegment | null> {

    // Handle -emoji text command
    if (msg.type === 'text' && msg.data.text.trim() === '-emoji') {
      return this.handleEmojiCommand(user);
    }

    if (msg.type !== 'image') {
      console.log(`Message is not an image, skipping`);
      return null;
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
        return null;
      }
      if (imageType === undefined || !['jpg', 'png', 'bmp', 'webp', 'tiff'].includes(imageType)) {
        console.log(`Unsupported image type, skipping: ${imageType}`);
        return null;
      }

      imageHash = await phash(imageBuffer, 16)
    } catch (error) {
      console.log('Something wrong happened during the request of the image')
      console.log(error)
    }

    if (!imageHash) {
      console.log('Failed to compute image hash, skipping');
      return null;
    }

    // Check if the image is a known emoji — skip dup check if so
    if (await this.isKnownEmoji(imageHash, 0.1)) {
      console.log(`Image is a known emoji, skipping dup check: ${imageHash}`);
      return null;
    }

    let record = await this.levenshteinRedis(imageHash, 0.1);

    if (!record) {
      await redis.setex(`image:${imageHash}`, EXPIRE_DURATION, JSON.stringify({
        content: imageHash,
        count: 0,
        id: user.user_id,
        sender: user.nickname,
        timestamp: Date.now(),
        cooldown: undefined,
      }));
      console.log(`New Image hash stored: ${imageHash}`);
      return null;
    }

    let jsonStr = await redis.get(`image:${imageHash}`);
    if (!jsonStr) return null;

    let recordData = JSON.parse(jsonStr);
    recordData.count++;
    recordData.timestamp = Date.now();
    imageHash = recordData.content;

    await redis.setex(`image:${imageHash}`, EXPIRE_DURATION, JSON.stringify(recordData));

    if (recordData.count >= MAX_CALL_OUT) {
      console.log(`Max call out reached for image: ${imageHash}`);
      return null;
    }

    console.log(`Duplicate image detected: ${imageHash}, similarity: ${record.similarity}, count: ${recordData.count}`);

    // Track the last warned hash for this user so they can dismiss with -emoji
    this.lastWarned = { user_id: user.user_id, user_name: user.nickname, hash: imageHash!, timestamp: Date.now() };

    const ret = `出警！${user.nickname} 又在发火星图了！` +
      `图片` +
      `由 ${recordData.sender} (${recordData.id})` +
      `于 ${this.formatTimestamp(recordData.timestamp)} 发过，` +
      `已经被发过了 ${recordData.count} 次！\n` +
      `如果这是表情包，请发送 -emoji 来标记，后续不再出警。`;

    return Structs.text(ret);
  }
}

export const dup_check = new DupCheck()
export default dup_check
