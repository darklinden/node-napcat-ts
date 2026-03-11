import { GroupMessage, NCWebsocket, PrivateFriendMessage, PrivateGroupMessage, Receive } from "../src"
import { type SendMessageSegment } from '../src/index.js'


export interface IFeature {

    feature_name: string
    bot?: NCWebsocket

    check_command(msg: Receive[keyof Receive]): boolean

    deal_with_message(
        context: PrivateFriendMessage | PrivateGroupMessage | GroupMessage,
        msg: Receive[keyof Receive],
        user: {
            user_id: number
            nickname: string
            card: string
        }): Promise<SendMessageSegment | null>

}