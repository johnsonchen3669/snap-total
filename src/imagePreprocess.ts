const TARGET_MIN_EDGE = 1200
const TARGET_MAX_EDGE = 1800

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Image load failed'))
    }

    image.src = objectUrl
  })
}

function getScaledSize(width: number, height: number) {
  const shortestEdge = Math.min(width, height)
  const longestEdge = Math.max(width, height)

  let scale = 1

  if (shortestEdge < TARGET_MIN_EDGE) {
    scale = TARGET_MIN_EDGE / shortestEdge
  }

  if (longestEdge * scale > TARGET_MAX_EDGE) {
    scale = TARGET_MAX_EDGE / longestEdge
  }

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function findPercentileBounds(histogram: Uint32Array, total: number) {
  const lowTarget = total * 0.02
  const highTarget = total * 0.98
  let cumulative = 0
  let low = 0
  let high = 255

  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index]

    if (cumulative >= lowTarget) {
      low = index
      break
    }
  }

  cumulative = 0

  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index]

    if (cumulative >= highTarget) {
      high = index
      break
    }
  }

  if (high <= low) {
    return { low: 0, high: 255 }
  }

  return { low, high }
}

function getOtsuThreshold(histogram: Uint32Array, total: number) {
  let sum = 0

  for (let index = 0; index < histogram.length; index += 1) {
    sum += index * histogram[index]
  }

  let sumBackground = 0
  let backgroundWeight = 0
  let varianceMax = 0
  let threshold = 127

  for (let index = 0; index < histogram.length; index += 1) {
    backgroundWeight += histogram[index]

    if (backgroundWeight === 0) {
      continue
    }

    const foregroundWeight = total - backgroundWeight

    if (foregroundWeight === 0) {
      break
    }

    sumBackground += index * histogram[index]

    const meanBackground = sumBackground / backgroundWeight
    const meanForeground = (sum - sumBackground) / foregroundWeight
    const varianceBetween =
      backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2

    if (varianceBetween > varianceMax) {
      varianceMax = varianceBetween
      threshold = index
    }
  }

  return threshold
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
          return
        }

        reject(new Error('Canvas export failed'))
      },
      'image/png',
      0.92,
    )
  })
}

export async function preprocessImageForOcr(file: File) {
  const image = await loadImage(file)
  const size = getScaledSize(image.naturalWidth || image.width, image.naturalHeight || image.height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height

  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    throw new Error('Canvas context unavailable')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, size.width, size.height)

  const imageData = context.getImageData(0, 0, size.width, size.height)
  const { data } = imageData
  const pixelCount = size.width * size.height
  const luminance = new Uint8ClampedArray(pixelCount)
  const histogram = new Uint32Array(256)

  for (let offset = 0, pixelIndex = 0; offset < data.length; offset += 4, pixelIndex += 1) {
    const value = Math.round(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114)
    luminance[pixelIndex] = value
    histogram[value] += 1
  }

  const bounds = findPercentileBounds(histogram, pixelCount)
  const stretchedHistogram = new Uint32Array(256)
  const stretched = new Uint8ClampedArray(pixelCount)

  for (let index = 0; index < pixelCount; index += 1) {
    const normalized = Math.round(((luminance[index] - bounds.low) * 255) / Math.max(1, bounds.high - bounds.low))
    const value = Math.min(255, Math.max(0, normalized))

    stretched[index] = value
    stretchedHistogram[value] += 1
  }

  const threshold = getOtsuThreshold(stretchedHistogram, pixelCount)

  for (let offset = 0, pixelIndex = 0; offset < data.length; offset += 4, pixelIndex += 1) {
    const value = stretched[pixelIndex] > threshold ? 255 : 0
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  }

  context.putImageData(imageData, 0, 0)
  return canvasToBlob(canvas)
}