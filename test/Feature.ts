import { Receive } from "../src"
import { type SendMessageSegment } from '../src/index.js'


export interface IFeature {

    feature_name: string

    check_command(msg: Receive[keyof Receive]): boolean

    deal_with_message(msg: Receive[keyof Receive], user: {
        user_id: number
        nickname: string
        card: string
    }): Promise<SendMessageSegment | null>

}