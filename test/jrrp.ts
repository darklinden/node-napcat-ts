import { createHash } from 'crypto'
import { IFeature } from './Feature'
import { Receive } from '../src'

export class Jrrp implements IFeature {

  public feature_name = '今日人品'

  private readonly Result = '{0} 的今日人品是：{1}。{2}'
  private readonly Levels = [0, 20, 40, 60, 80]
  private readonly Jackpots = [0, 42, 77, 100]

  private readonly LevelDescriptions = {

    'default-level-0': '推荐闷头睡大觉。',
    'default-level-20': '也许今天适合摆烂。',
    'default-level-40': '又是平凡的一天。',
    'default-level-60': '太阳当头照，花儿对你笑。',
    'default-level-80': '出门可能捡到 1 块钱。',

    'default-jackpot-0': '怎，怎么会这样……',
    'default-jackpot-42': '感觉可以参透宇宙的真理。',
    'default-jackpot-77': '要不要去抽一发卡试试呢……？',
    'default-jackpot-100': '买彩票可能会中大奖哦！',
  }

  public check_command(msg: Receive[keyof Receive]): boolean {
    return msg.type == 'text' && (msg.data.text === '-jrrp' || msg.data.text === 'jrrp');
  }

  public async deal_with_message(msg: Receive[keyof Receive], user: {
    user_id: number
    nickname: string
    card: string
  }): Promise<string> {

    let name: string = user.card
    if (!name || name.length === 0) name = user.nickname

    const luck = createHash('sha256')
    luck.update(user.user_id.toString())
    luck.update((new Date().getTime() / (1000 * 60 * 60 * 24)).toFixed(0))
    luck.update('42')

    const luckValue = parseInt(luck.digest('hex'), 16) % 101
    console.debug('Luck value:', luckValue)

    let comment: string = ''

    const jackpotIndex = this.Jackpots.indexOf(luckValue)

    if (jackpotIndex != -1) {
      comment = this.LevelDescriptions[`default-jackpot-${luckValue}`]
    }

    if (!comment) {
      let key: number

      const keyIndex = this.Levels.findIndex(level => luckValue <= level)
      console.debug('Level index:', keyIndex)

      if (keyIndex == -1) key = this.Levels[this.Levels.length - 1]
      else key = this.Levels[keyIndex - 1]
      console.debug('Level key:', key)

      comment = this.LevelDescriptions[`default-level-${key}`]
    }

    return this.Result.replace('{0}', name)
      .replace('{1}', luckValue.toString())
      .replace('{2}', comment);

  }
}

export const jrrp = new Jrrp()
export default jrrp