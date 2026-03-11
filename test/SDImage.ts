import { GroupMessage, NCWebsocket, PrivateFriendMessage, PrivateGroupMessage, Receive, Structs, type SendMessageSegment } from "../src"
import { IFeature } from "./Feature"

const COMFY_UI_URL = process.env.COMFY_UI_URL ?? 'http://127.0.0.1:8188'
const POLL_INTERVAL = 2000    // ms between status polls
const MAX_POLL_TIME = 600000  // max 10 minutes waiting

function getCheckpoint(model: string) {
    switch (model) {
        case 'hana':
            return 'hana4CHROME_huge.safetensors'
        case 'hunyuan':
            return 'hunyuan3d-dit-v2.safetensors'
        case 'nova':
            return 'novaAnimeXL_ilV170.safetensors'
        case 'xl':
        default:
            return 'sd_xl_base_1.0.safetensors'
    }
}

/** Default ComfyUI workflow – text-to-image via a checkpoint + CLIP + KSampler + VAE decode. */
function buildWorkflow(
    model: string,
    prompt: string,
    sampler_name?: string,
    cfg: number = 7,
    negativePrompt: string = '',
    steps: number = 20,
    denoise: number = 1) {
    model = getCheckpoint(model) // Normalize model to checkpoint name for easier handling
    console.log(`[buildWorkflow] Building workflow for model: ${model}, prompt: "${prompt}", sampler: ${sampler_name}, cfg: ${cfg}, negativePrompt: "${negativePrompt}", steps: ${steps}`)
    const actualSeed = Math.floor(Math.random() * 2 ** 32)
    return {
        "3": {
            class_type: "KSampler",
            inputs: {
                seed: actualSeed,
                steps: steps,
                cfg: cfg,
                sampler_name: sampler_name || "euler_ancestral",
                scheduler: "normal",
                denoise: denoise,
                model: ["4", 0],
                positive: ["6", 0],
                negative: ["7", 0],
                latent_image: ["5", 0],
            },
        },
        "4": {
            class_type: "CheckpointLoaderSimple",
            inputs: {
                ckpt_name: getCheckpoint(model),
            },
        },
        "5": {
            class_type: "EmptyLatentImage",
            inputs: {
                width: 1024,
                height: 1024,
                batch_size: 1,
            },
        },
        "6": {
            class_type: "CLIPTextEncode",
            inputs: {
                text: prompt,
                clip: ["4", 1],
            },
        },
        "7": {
            class_type: "CLIPTextEncode",
            inputs: {
                text: negativePrompt || "worst quality, bad quality, low quality, lowres, anatomical nonsense, artistic error, bad anatomy, blood, censored, monochrome",
                clip: ["4", 1],
            },
        },
        "8": {
            class_type: "VAEDecode",
            inputs: {
                samples: ["3", 0],
                vae: ["4", 2],
            },
        },
        "9": {
            class_type: "SaveImage",
            inputs: {
                filename_prefix: "sd_bot",
                images: ["8", 0],
            },
        },
    }
}

export class SDImage implements IFeature {

    public feature_name = 'sd 图片生成: sd <prompt> 或 -sd <prompt> 生成图片'
    public bot?: NCWebsocket | undefined

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

    private parse_command(txt: string): {
        model: string;
        prompt: string;
        negativePrompt: string | "";
        sampler_name?: string;
        cfg?: number;
        steps?: number;
        denoise?: number;
    } | null {
        if (!txt || !txt.length) return null

        const prefix = txt.startsWith('sd ') ? 'sd' : txt.startsWith('-sd ') ? '-sd' : null
        if (!prefix) return null

        let arg = txt.slice(prefix.length).trim()
        if (!arg || !arg.length) return null

        arg = this.trim(arg)
        if (!arg || !arg.length) return null

        const ret = {
            model: 'xl', // Default model
            prompt: "",
            negativePrompt: "",
            sampler_name: "euler_ancestral", // Default sampler
            cfg: 7,
            steps: 20,
            denoise: 1,
        }

        const parts = arg.split('|')
        for (const part of parts) {
            const values = part.split('=')
            if (values.length === 2) {
                const key = values[0].trim().toLowerCase()
                const value = this.trim(values[1])

                switch (key) {
                    case 'model':
                        ret.model = value.toLowerCase()
                        break
                    case 'negative':
                        ret.negativePrompt = value
                        break
                    case 'sampler':
                        ret.sampler_name = value
                        break
                    case 'cfg':
                        const cfgValue = parseFloat(value)
                        if (!isNaN(cfgValue)) {
                            ret.cfg = cfgValue
                        }
                        break
                    case 'steps':
                        const stepsValue = parseInt(value)
                        if (!isNaN(stepsValue)) {
                            ret.steps = stepsValue
                        }
                        break
                    case 'denoise':
                        const denoiseValue = parseFloat(value)
                        if (!isNaN(denoiseValue)) {
                            ret.denoise = denoiseValue
                        }
                        break
                    default:
                        // Unknown key, ignore or handle as needed
                        console.log(`Unknown parameter key: "${key}" with value: "${value}"`)
                        break
                }
            } else {
                // If no '=', treat the whole part as the prompt (for backward compatibility)
                ret.prompt = this.trim(part.trim())
            }
        }
        return ret
    }

    check_command(msg: Receive[keyof Receive]): boolean {
        if (msg.type !== 'text') return false
        const command = this.parse_command(msg.data.text)
        return command !== null
    }

    /** Queue a prompt on ComfyUI, returns the prompt_id */
    private async queuePrompt(
        model: string,
        prompt: string,
        sampler_name?: string,
        cfg: number = 7,
        negativePrompt: string = '',
        steps: number = 20,
        denoise: number = 1
    ): Promise<string> {
        const workflow = buildWorkflow(model, prompt, sampler_name, cfg, negativePrompt, steps, denoise)
        const resp = await fetch(`${COMFY_UI_URL}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow }),
        })

        if (!resp.ok) {
            const text = await resp.text()
            throw new Error(`ComfyUI /prompt failed (${resp.status}): ${text}`)
        }

        const data = await resp.json() as { prompt_id: string }
        return data.prompt_id
    }

    /** Poll ComfyUI /history/{id} until the job finishes. Returns the output image info. */
    private async waitForResult(promptId: string): Promise<{ filename: string; subfolder: string; type: string }> {
        const start = Date.now()

        while (Date.now() - start < MAX_POLL_TIME) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL))

            const resp = await fetch(`${COMFY_UI_URL}/history/${promptId}`)
            if (!resp.ok) continue

            const history = await resp.json() as Record<string, any>
            const job = history[promptId]
            if (!job) continue

            // Check if job has status info indicating failure
            if (job.status?.completed === false && job.status?.status_str === 'error') {
                throw new Error(`ComfyUI job failed: ${JSON.stringify(job.status)}`)
            }

            // Look for outputs
            if (job.outputs) {
                for (const nodeId of Object.keys(job.outputs)) {
                    const output = job.outputs[nodeId]
                    if (output.images && output.images.length > 0) {
                        return output.images[0] as { filename: string; subfolder: string; type: string }
                    }
                }
            }
        }

        throw new Error('ComfyUI generation timed out')
    }

    /** Fetch the generated image from ComfyUI /view endpoint and return as base64 */
    private async fetchImage(imageInfo: { filename: string; subfolder: string; type: string }): Promise<string> {
        const params = new URLSearchParams({
            filename: imageInfo.filename,
            subfolder: imageInfo.subfolder || '',
            type: imageInfo.type || 'output',
        })

        const resp = await fetch(`${COMFY_UI_URL}/view?${params.toString()}`)
        if (!resp.ok) {
            throw new Error(`ComfyUI /view failed (${resp.status})`)
        }

        const buffer = Buffer.from(await resp.arrayBuffer())
        return buffer.toString('base64')
    }

    async deal_with_message(
        context: PrivateFriendMessage | PrivateGroupMessage | GroupMessage,
        msg: Receive[keyof Receive],
        user: { user_id: number; nickname: string; card: string }
    ): Promise<SendMessageSegment | null> {

        if (msg.type !== 'text') return null

        const args = this.parse_command(msg.data.text)
        if (!args) return null

        console.log(`[SDImage] User ${user.nickname} (${user.user_id}) requested: "${JSON.stringify(args)}"`)

        try {
            // 1. Queue the prompt
            const promptId = await this.queuePrompt(args.model, args.prompt, args.sampler_name, args.cfg, args.negativePrompt, args.steps, args.denoise)
            console.log(`[SDImage] Queued prompt: ${promptId}`)

            // Don't await this, let it run in the background and return immediately
            this.waitForResultAndReturn(context, msg, user, promptId);

            return Structs.text(`已收到请求，正在生成图片... (提示ID: ${promptId})`)
        } catch (err) {
            console.error('[SDImage] Error generating image:', err)
            return Structs.text(`图片生成失败: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    async waitForResultAndReturn(
        context: PrivateFriendMessage | PrivateGroupMessage | GroupMessage,
        msg: Receive[keyof Receive],
        user: { user_id: number; nickname: string; card: string },
        promptId: string
    ) {
        // 2. Wait for the result
        const imageInfo = await this.waitForResult(promptId)
        console.log(`[SDImage] Generation complete: ${imageInfo.filename}`)

        // 3. Fetch the image and return as base64
        const base64 = await this.fetchImage(imageInfo)
        console.log(`[SDImage] Image fetched, size: ${base64.length} chars`)

        this.bot!.send_msg({
            ...context, message: [
                Structs.text(`@${user.nickname} (${user.user_id})已生成图片：`),
                Structs.image(`base64://${base64}`)]
        })
    }
}

const sdImage = new SDImage()
export default sdImage