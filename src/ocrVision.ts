export type VisionItem = {
  name: string
  price: number
}

export type VisionResult = {
  items: VisionItem[]
  rawText: string
}

function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result

      if (typeof result !== 'string') {
        reject(new Error('FileReader did not return string'))
        return
      }

      resolve(result)
    }

    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

function parseVisionResponse(text: string): VisionItem[] {
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  const parsed = JSON.parse(cleaned) as { items?: unknown[] }

  if (!Array.isArray(parsed.items)) {
    return []
  }

  return parsed.items
    .filter((item): item is { name: string; price: number } => {
      if (!item || typeof item !== 'object') {
        return false
      }

      const record = item as Record<string, unknown>

      return (
        typeof record.name === 'string' &&
        typeof record.price === 'number' &&
        Number.isFinite(record.price) &&
        record.price > 0
      )
    })
    .map((item) => ({
      name: item.name.trim(),
      price: Math.round(item.price),
    }))
}

export async function recognizeWithVision(
  imageFile: File | Blob,
): Promise<VisionResult> {
  const imageDataUrl = await fileToBase64(imageFile)

  const response = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl }),
  })

  if (!response.ok) {
    const status = response.status
    const body = await response.json().catch(() => ({}))
    const errorCode = (body as { error?: string }).error ?? ''

    if (status === 401 || errorCode === 'TOKEN_INVALID') {
      throw new VisionApiError('TOKEN_INVALID', 'AI 服務認證失敗，請聯絡管理員。')
    }

    if (status === 429 || errorCode === 'RATE_LIMITED') {
      throw new VisionApiError('RATE_LIMITED', '已達免費用量上限，暫時改用本地辨識。')
    }

    if (status === 503 || errorCode === 'SERVER_MISCONFIGURED') {
      throw new VisionApiError('API_ERROR', '伺服器尚未設定 AI 服務，改用本地辨識。')
    }

    throw new VisionApiError('API_ERROR', `API 回應錯誤 (${status})`)
  }

  const data = (await response.json()) as { rawText?: string }
  const rawText = data.rawText ?? ''
  const items = parseVisionResponse(rawText)

  return { items, rawText }
}

export class VisionApiError extends Error {
  code: 'TOKEN_INVALID' | 'RATE_LIMITED' | 'API_ERROR' | 'PARSE_ERROR'

  constructor(
    code: 'TOKEN_INVALID' | 'RATE_LIMITED' | 'API_ERROR' | 'PARSE_ERROR',
    message: string,
  ) {
    super(message)
    this.code = code
    this.name = 'VisionApiError'
  }
}
