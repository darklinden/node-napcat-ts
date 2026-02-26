import 'dotenv/config'
import { NCWebsocket, NCWebsocketOptions, Structs, type WSSendParam } from '../src/index.js'
import { IFeature } from './Feature.js'
import { jrrp } from './jrrp.js'
import { dup_check } from './dup_check.js'

const features: IFeature[] = [
  jrrp,
  dup_check
]

const WsConfig: NCWebsocketOptions = {
  protocol: 'ws',
  host: process.env.WS_HOST!,
  port: parseInt(process.env.WS_PORT!),
  accessToken: process.env.WS_ACCESS_TOKEN!,
  throwPromise: false,
  reconnection: {
    enable: true,
    attempts: Number.MAX_SAFE_INTEGER,
    delay: 5000,
  },
}
const bot = new NCWebsocket(WsConfig, true)

bot.on('socket.connecting', function (res) {
  console.log(`连接中#${res.reconnection.nowAttempts}`)
})

bot.on('socket.error', function (err) {
  console.log(`连接失败#${err.reconnection.nowAttempts}`)
  console.dir(err, { depth: null })
})

bot.on('socket.close', function (err) {
  console.log(`连接断开#${err.reconnection.nowAttempts}`)
  console.dir(err, { depth: null })
})

bot.on('socket.open', async function (res) {
  console.log(`连接成功#${res.reconnection.nowAttempts}`)
})

bot.on('api.preSend', function (params) {
  console.log('\n发送了一条请求')
  console.dir(params, { depth: null })
})

bot.on('message', async (context) => {
  console.log('\n机器人收到了一条信息\n')
  // console.dir(context, { depth: null })

  context.message.forEach(async (item) => {
    console.log(`消息内容：${JSON.stringify(item)}`)

    let hasCommand = false
    for (const feature of features) {
      if (feature.check_command(item)) {
        let ret = await feature.deal_with_message(item, context.sender)
        if (ret == null || ret.length === 0) {
          console.log('功能没有返回任何内容，跳过回复')
        }
        else {
          await bot.send_msg({ ...context, message: [Structs.text(ret)] })
        }
        hasCommand = true
        break
      }
    }

    if (!hasCommand && item.type == 'text' && item.data.text === 'echo features') {
      let featureList = features.map(feature => feature.feature_name).join(',\n')
      await bot.send_msg({ ...context, message: [Structs.text(`当前已加载的功能有：\n${featureList}`)] })
    }
  })
})

bot.on('notice', async (event) => {
  console.log('\n收到了一条通知')
  console.dir(event, { depth: null })
})

bot.on('request', async (event) => {
  console.log('\n收到了一条请求')
  console.dir(event, { depth: null })
})

await bot.connect()
console.log('连接成功')
