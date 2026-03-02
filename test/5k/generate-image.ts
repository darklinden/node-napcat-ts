import skiaCanvas from 'skia-canvas'

export interface ImageGeneratorOptions {
  reserve: boolean
  maxLength: number
  offsetX: number
  upper: {
    font: string
    weight: string | number
  },
  lower: {
    font: string
    weight: string | number
  }
}

export interface ConfigObject {
  /**
   * 设置上行文字。
   */
  upper: {
    /**
     * 设置上行文字的字体文件路径。
     */
    path?: string
    /**
     * 设置上行文字的字体名。
     */
    name?: string
    /**
     * 设置上行文字的字重。
     */
    weight?: string | number
  },
  /**
   * 设置下行文字。
   */
  lower: {
    /**
     * 设置下行文字的字体文件路径。
     */
    path?: string
    /**
     * 设置下行文字的字体名。
     */
    name?: string
    /**
     * 设置下行文字的字重。
     */
    weight?: string | number
  }
  /**
   * 是否强制清除消息段中的非文字元素。
   *
   * 当设置为 `true` 时，指令选项 `--reserve` 将失效。
   *
   * @default false
   */
  disableCQCode?: boolean
  /**
   * 一行最多字符数
   *
   * @default 42
   */
  maxLength?: number
  /**
   * 第二行文字的默认向右偏移距离（单位为px）
   *
   * @default 200
   */
  defaultOffsetX?: number
  /**
   * 第二行文字的最大向右偏移距离（单位为px）
   *
   * @default 1000
   */
  maxOffsetX?: number
}

interface FontOptions {
  /**
   * 字体注册成的名字。
   */
  family: string
  /**
   * 字体注册成的字重，如 `700` 者 `bold`。
   */
  weight?: string
  /**
   * 字体注册成的样式，如斜体、花体等。
   */
  style?: string
}

interface FontOptionsConfig extends FontOptions {
  /**
   * 字体对于工作路径的相对路径。
   */
  path: string
}

// Extend default behavior Canvas.
class CanvasInstance extends skiaCanvas.Canvas {
  async renderResize(factor: number) {
    const outputCanvas = new CanvasInstance()
    const outputCtx = outputCanvas.getContext('2d')

    outputCanvas.width = this.width * factor
    outputCanvas.height = this.height * factor

    const rendered = this.toBufferSync('png')
    outputCtx.drawImage(await skiaCanvas.loadImage(rendered), 0, 0, outputCanvas.width, outputCanvas.height)

    return outputCanvas
  }

  toBase64() {
    return this.toBufferSync('png').toString('base64')
  }
}

export function createCanvas(width?: number, height?: number) {
  return new CanvasInstance(width, height)
}

export function registerFont(path: string, options: FontOptions) {
  const result = skiaCanvas.FontLibrary.use(options.family, [path])[0]
  console.log(
    `Font registered: ${result.family} (${result.file}) / ` +
    `weight: ${result.weight}, style: ${result.style}, width: ${result.width}.`,
  )
}

export function generateImage(
  upper: string,
  lower: string,
  options: ImageGeneratorOptions
): CanvasInstance {
  // Shorthand variable names.
  const fontUpper = `${options.upper.weight} 100px ${options.upper.font}`;
  const fontLower = `${options.lower.weight} 100px ${options.lower.font}`;

  // Set canvas.
  const canvas = createCanvas();
  const ctx = canvas.getContext("2d");

  ctx.font = fontUpper;
  const upperWidth = ctx.measureText(upper).width;
  ctx.font = fontLower;
  const lowerWidth = ctx.measureText(lower).width;
  const offsetWidth = options.offsetX;

  canvas.height = 270;
  canvas.width = Math.max(upperWidth + 80, lowerWidth + offsetWidth + 90);
  ctx.lineJoin = "round";
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(1, 0, -0.4, 1, 0, 0);

  // Define auxillary variables.
  let posx: number, posy: number, grad: CanvasGradient;

  // Generate upper text.
  ctx.font = fontUpper;

  posx = 70;
  posy = 100;

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 18;
  ctx.strokeText(upper, posx + 4, posy + 3);

  grad = ctx.createLinearGradient(0, 24, 0, 122);
  grad.addColorStop(0.0, "rgb(0,15,36)");
  grad.addColorStop(0.1, "rgb(255,255,255)");
  grad.addColorStop(0.18, "rgb(55,58,59)");
  grad.addColorStop(0.25, "rgb(55,58,59)");
  grad.addColorStop(0.5, "rgb(200,200,200)");
  grad.addColorStop(0.75, "rgb(55,58,59)");
  grad.addColorStop(0.85, "rgb(25,20,31)");
  grad.addColorStop(0.91, "rgb(240,240,240)");
  grad.addColorStop(0.95, "rgb(166,175,194)");
  grad.addColorStop(1, "rgb(50,50,50)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 17;
  ctx.strokeText(upper, posx + 4, posy + 3);

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 10;
  ctx.strokeText(upper, posx, posy);

  grad = ctx.createLinearGradient(0, 20, 0, 100);
  grad.addColorStop(0, "rgb(253,241,0)");
  grad.addColorStop(0.25, "rgb(245,253,187)");
  grad.addColorStop(0.4, "rgb(255,255,255)");
  grad.addColorStop(0.75, "rgb(253,219,9)");
  grad.addColorStop(0.9, "rgb(127,53,0)");
  grad.addColorStop(1, "rgb(243,196,11)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 8;
  ctx.strokeText(upper, posx, posy);

  ctx.lineWidth = 4;
  ctx.strokeStyle = "#000";
  ctx.strokeText(upper, posx + 2, posy - 2);

  ctx.lineWidth = 4;
  ctx.strokeStyle = "#FFFFFF";
  ctx.strokeText(upper, posx, posy - 2);

  grad = ctx.createLinearGradient(0, 20, 0, 100);
  grad.addColorStop(0, "rgb(255, 100, 0)");
  grad.addColorStop(0.5, "rgb(123, 0, 0)");
  grad.addColorStop(0.51, "rgb(240, 0, 0)");
  grad.addColorStop(1, "rgb(5, 0, 0)");
  ctx.lineWidth = 1;
  ctx.fillStyle = grad;
  ctx.fillText(upper, posx, posy - 2);

  grad = ctx.createLinearGradient(0, 20, 0, 100);
  grad.addColorStop(0, "rgb(230, 0, 0)");
  grad.addColorStop(0.5, "rgb(230, 0, 0)");
  grad.addColorStop(0.51, "rgb(240, 0, 0)");
  grad.addColorStop(1, "rgb(5, 0, 0)");
  ctx.strokeStyle = grad;
  ctx.strokeText(upper, posx, posy - 2);

  // generate lower text
  ctx.font = fontLower;

  const offsetX = offsetWidth;
  const offsetY = 130;
  posx = offsetX + 130;
  posy = offsetY + 100;

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 17;
  ctx.strokeText(lower, posx + 4, posy + 3);

  grad = ctx.createLinearGradient(
    0 + offsetX,
    20 + offsetY,
    0 + offsetX,
    118 + offsetY
  );
  grad.addColorStop(0, "rgb(0,15,36)");
  grad.addColorStop(0.25, "rgb(250,250,250)");
  grad.addColorStop(0.5, "rgb(150,150,150)");
  grad.addColorStop(0.75, "rgb(55,58,59)");
  grad.addColorStop(0.85, "rgb(25,20,31)");
  grad.addColorStop(0.91, "rgb(240,240,240)");
  grad.addColorStop(0.95, "rgb(166,175,194)");
  grad.addColorStop(1, "rgb(50,50,50)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 14;
  ctx.strokeText(lower, posx + 4, posy + 3);

  ctx.strokeStyle = "#10193A";
  ctx.lineWidth = 12;
  ctx.strokeText(lower, posx, posy);

  ctx.strokeStyle = "#DDD";
  ctx.lineWidth = 7;
  ctx.strokeText(lower, posx, posy);

  grad = ctx.createLinearGradient(
    0 + offsetX,
    20 + offsetY,
    0 + offsetX,
    100 + offsetY
  );
  grad.addColorStop(0, "rgb(16,25,58)");
  grad.addColorStop(0.03, "rgb(255,255,255)");
  grad.addColorStop(0.08, "rgb(16,25,58)");
  grad.addColorStop(0.2, "rgb(16,25,58)");
  grad.addColorStop(1, "rgb(16,25,58)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 6;
  ctx.strokeText(lower, posx, posy);

  grad = ctx.createLinearGradient(
    0 + offsetX,
    20 + offsetY,
    0 + offsetX,
    100 + offsetY
  );
  grad.addColorStop(0, "rgb(245,246,248)");
  grad.addColorStop(0.15, "rgb(255,255,255)");
  grad.addColorStop(0.35, "rgb(195,213,220)");
  grad.addColorStop(0.5, "rgb(160,190,201)");
  grad.addColorStop(0.51, "rgb(160,190,201)");
  grad.addColorStop(0.52, "rgb(196,215,222)");
  grad.addColorStop(1.0, "rgb(255,255,255)");
  ctx.fillStyle = grad;
  ctx.fillText(lower, posx, posy - 3);

  // output canvas
  return canvas;
};

// Export modified koishi services.
export { CanvasInstance as Canvas }

// Re-export skia-canvas itself for fail-safe.
export * from 'skia-canvas'