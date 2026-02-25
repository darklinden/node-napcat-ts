/**
 * This script is from
 * https://github.com/btd/sharp-phash/blob/master/index.js
 * and some modification is made to meet the need.
 */
import sharp from 'sharp'

const SAMPLE_SIZE = 32
const LOW_SIZE = 8

const initSqrt = (size: number): number[] => {
  const sqrts = Array<number>(size)
  for (let i = 1; i < size; i++) {
    sqrts[i] = 1
  }
  sqrts[0] = 1 / Math.sqrt(2.0)
  return sqrts
}

const sqrt = initSqrt(SAMPLE_SIZE)

const initCos = (size: number): number[][] => {
  const cosines = Array<number[]>(size)
  for (let k = 0; k < size; k++) {
    cosines[k] = Array<number>(size)
    for (let n = 0; n < size; n++) {
      cosines[k][n] = Math.cos(((2 * k + 1) / (2.0 * size)) * n * Math.PI)
    }
  }
  return cosines
}

const cos = initCos(SAMPLE_SIZE)

const applyDCT = (image: number[][], size: number): number[][] => {
  const dct = Array<number[]>(size)
  for (let u = 0; u < size; u++) {
    dct[u] = Array<number>(size)
    for (let v = 0; v < size; v++) {
      let sum = 0
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          sum += cos[i][u] * cos[j][v] * image[i][j]
        }
      }
      sum *= (sqrt[u] * sqrt[v]) / 4
      dct[u][v] = sum
    }
  }
  return dct
}

/**
 * @param image Image to be phashed.
 * @param size Size of the square taken from the result of DCT. Default value is 8.
 * @returns Fingerprint.
 */
const phash = async (image: Parameters<typeof sharp>[0], size: number = LOW_SIZE): Promise<string> => {
  // Preprocess image.
  const data = await sharp(image)
    .greyscale()
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer()

  // Copy signal.
  const s: number[][] = new Array(SAMPLE_SIZE)
  for (let x = 0; x < SAMPLE_SIZE; x++) {
    s[x] = new Array(SAMPLE_SIZE)
    for (let y = 0; y < SAMPLE_SIZE; y++) {
      s[x][y] = data[SAMPLE_SIZE * y + x]
    }
  }

  // Apply 2D DCT II
  const dct = applyDCT(s, SAMPLE_SIZE)

  // Get AVG on high frequencies.
  let totalSum = 0
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      totalSum += dct[x + 1][y + 1]
    }
  }

  const avg = totalSum / (size * size)

  // Compute Hash.
  let fingerprint = ''

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      fingerprint += dct[x + 1][y + 1] > avg ? '1' : '0'
    }
  }

  return fingerprint
}

export default phash
