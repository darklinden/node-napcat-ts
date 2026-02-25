import { Receive } from "../src"

export interface IFeature {

    feature_name: string

    check_command(msg: Receive[keyof Receive]): boolean

    deal_with_message(msg: Receive[keyof Receive], user: {
        user_id: number
        nickname: string
        card: string
    }): Promise<string>

}