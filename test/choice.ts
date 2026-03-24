import { IFeature } from './Feature'
import { GroupMessage, PrivateFriendMessage, PrivateGroupMessage, Receive, Structs } from '../src'
import { type SendMessageSegment } from '../src/index.js'

export class Choice implements IFeature {

  public feature_name = '帮我选: 帮我选 + 选项1 + 选项2 + ... 来帮你做选择'

  public check_command(msg: Receive[keyof Receive]): boolean {
    return msg.type == 'text' && (msg.data.text.startsWith('-choice ') || msg.data.text.startsWith('choice ') || msg.data.text.startsWith('帮我选 '));
  }

  async deal_with_message(
    context: PrivateFriendMessage | PrivateGroupMessage | GroupMessage,
    msg: Receive[keyof Receive],
    user: { user_id: number; nickname: string; card: string }
  ): Promise<SendMessageSegment | null> {

    if (!msg.type || msg.type !== 'text') return null

    let name: string = user.card
    if (!name || name.length === 0) name = user.nickname

    const values = msg.data.text.split(' ').map(s => s.trim()).filter(s => s.length > 0)

    if (values.length < 2) {
      return Structs.text('请至少提供两个选项哦！')
    }

    const options = values.slice(1)

    const choiceIndex = Math.floor(Math.random() * options.length)
    const choice = options[choiceIndex]

    return Structs.text(`帮 ${name}(${user.user_id}) 选择了：${choice}`)
  }
}

export const choice = new Choice()
export default choice