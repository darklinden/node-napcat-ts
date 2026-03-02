import { Receive, Structs, type SendMessageSegment } from "../../src"
import { IFeature } from "../Feature"
import { access } from "fs/promises"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { generateImage, registerFont, type ImageGeneratorOptions } from "./generate-image"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CURRENT_FILE_PATH = resolve(__dirname, 'fonts')

export class Draw5k implements IFeature {

  public feature_name = '5k 图片生成: 5k <上行文字> <下行文字> 或 -5k <上行文字> <下行文字> 生成 5k 图片'

  private fontsRegistered = false
  private upperFormat = { font: '', weight: 'normal' as string | number }
  private lowerFormat = { font: '', weight: 'normal' as string | number }

  private readonly config = {
    disableCQCode: false,
    maxLength: 42,
    defaultOffsetX: 200,
    maxOffsetX: 1000,
    upper: {
      path: resolve(CURRENT_FILE_PATH, 'SourceHanSerif-Heavy.otf'),
      name: '',
      weight: 'bold' as string | number,
    },
    lower: {
      path: resolve(CURRENT_FILE_PATH, 'SourceHanSans-Heavy.otf'),
      name: '',
      weight: 'bold' as string | number,
    },
  }

  private trim(str: string): string {
    let s = str.trim()
    while (s.startsWith('"') && s.endsWith('"')) {
      s = s.slice(1, -1)
    }
    while (s.startsWith("'") && s.endsWith("'")) {
      s = s.slice(1, -1)
    }
    return s
  }

  private parse_command(txt: string): { upper: string, lower: string } | null {
    if (!txt || !txt.length) return null

    const prefix = txt.startsWith('5k ') ? '5k' : txt.startsWith('-5k ') ? '-5k' : null
    if (!prefix) return null

    let args = txt.slice(prefix.length).trim()
    if (!args || !args.length) return null

    // Handle quoted first argument
    const quote = args.startsWith('"') ? '"' : args.startsWith("'") ? "'" : null
    if (quote) {
      const next = args.indexOf(quote, 1)
      if (next === -1) return null
      const upper = this.trim(args.slice(1, next))
      const lower = this.trim(args.slice(next + 1))
      if (!upper && !lower) return null
      return { upper, lower }
    }

    // Handle space-separated arguments
    const spaceIndex = args.indexOf(' ')
    if (spaceIndex === -1) {
      // Only one argument — treat as upper text with empty lower
      return { upper: this.trim(args), lower: '' }
    }

    const upper = this.trim(args.slice(0, spaceIndex))
    const lower = this.trim(args.slice(spaceIndex + 1))

    if (!upper && !lower) return null

    return { upper, lower }
  }

  check_command(msg: Receive[keyof Receive]): boolean {
    if (msg.type !== 'text') return false
    const command = this.parse_command(msg.data.text)
    return command !== null
  }

  private async registerFonts(): Promise<boolean> {
    if (this.fontsRegistered) return true

    try {
      await access(this.config.upper.path)
      registerFont(this.config.upper.path, {
        family: '5k-upper',
        weight: String(this.config.upper.weight),
      })
      this.upperFormat.font = '5k-upper'
    } catch {
      console.warn('The font path for upper text does not exist:', this.config.upper.path)
    }

    try {
      await access(this.config.lower.path)
      registerFont(this.config.lower.path, {
        family: '5k-lower',
        weight: String(this.config.lower.weight),
      })
      this.lowerFormat.font = '5k-lower'
    } catch {
      console.warn('The font path for lower text does not exist:', this.config.lower.path)
    }

    if (this.config.upper.name) this.upperFormat.font = this.config.upper.name
    if (this.config.upper.weight) this.upperFormat.weight = this.config.upper.weight
    if (this.config.lower.name) this.lowerFormat.font = this.config.lower.name
    if (this.config.lower.weight) this.lowerFormat.weight = this.config.lower.weight

    if (!this.upperFormat.font || !this.lowerFormat.font) {
      console.error('Fonts are not provided. disposed.')
      return false
    }

    this.fontsRegistered = true
    return true
  }

  async deal_with_message(msg: Receive[keyof Receive], user: {
    user_id: number
    nickname: string
    card: string
  }): Promise<SendMessageSegment | null> {

    if (msg.type !== 'text') return null

    const command = this.parse_command(msg.data.text)
    if (!command) return null

    const fontsReady = await this.registerFonts()
    if (!fontsReady) return null

    let { upper, lower } = command

    const validateInput = (str: string): string => {
      return (typeof str === 'undefined')
        ? ''
        : str.toString().trim().replace(/\r\n/g, ' ')
    }

    const clearCQCode = (str: string): string => {
      return str.replace(/\[CQ:.+?\]/g, '')
    }

    if (this.config.disableCQCode) {
      upper = clearCQCode(upper)
      lower = clearCQCode(lower)
    }

    upper = validateInput(upper)
    lower = validateInput(lower)

    if (!upper && !lower) {
      return Structs.text('用法: 5k <上行文字> <下行文字>')
    }

    if (upper.length > this.config.maxLength || lower.length > this.config.maxLength) {
      return Structs.text('内容太长了。')
    }

    let offsetX = this.config.defaultOffsetX
    if (offsetX < 0) offsetX = 0
    if (offsetX > this.config.maxOffsetX) offsetX = this.config.maxOffsetX

    const options: ImageGeneratorOptions = {
      reserve: false,
      maxLength: this.config.maxLength,
      offsetX,
      upper: { ...this.upperFormat },
      lower: { ...this.lowerFormat },
    }

    try {
      const canvas = generateImage(upper, lower, options)
      const imageData = canvas.toBase64()
      return Structs.image(`base64://${imageData}`)
    } catch (err) {
      console.warn('Something went wrong when generating/sending image.')
      console.warn(err)
      return null
    }
  }
}

const draw5k = new Draw5k()
export default draw5k