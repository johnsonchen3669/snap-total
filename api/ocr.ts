import type { VercelRequest, VercelResponse } from '@vercel/node'

const ENDPOINT = 'https://models.github.ai/inference/chat/completions'
const MODEL = 'openai/gpt-4.1-nano'

const SYSTEM_PROMPT = `你是台灣超市／賣場價格標籤辨識助手。
請仔細觀察照片中的商品資訊，找出所有商品的品名與價格。

規則：
- 價格以新台幣（NT$）為單位，回傳整數
- 品名請用原始標籤上的文字，不要翻譯
- 忽略地址、電話、統編、發票號碼、日期、條碼等非商品資訊
- 若有「特價」或「促銷價」，優先回傳特價金額
- 若照片模糊無法辨識，items 回傳空陣列

回傳格式（純 JSON，不要 markdown）：
{"items":[{"name":"品名","price":數字}]}`

// Increase body size limit for base64-encoded images
export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
  }

  const token = (process.env.GH_TOKEN ?? '').trim()
  if (!token) {
    return res.status(503).json({ error: 'SERVER_MISCONFIGURED' })
  }

  const body = req.body as { imageDataUrl?: unknown }
  const { imageDataUrl } = body

  if (
    typeof imageDataUrl !== 'string' ||
    !imageDataUrl.startsWith('data:image/')
  ) {
    return res.status(400).json({ error: 'INVALID_INPUT' })
  }

  try {
    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
              { type: 'text', text: '請辨識這張照片中的商品品名與價格。' },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    })

    if (!upstream.ok) {
      const status = upstream.status
      if (status === 401) return res.status(401).json({ error: 'TOKEN_INVALID' })
      if (status === 429) return res.status(429).json({ error: 'RATE_LIMITED' })
      return res.status(502).json({ error: 'API_ERROR', upstreamStatus: status })
    }

    const data = await upstream.json() as {
      choices?: { message?: { content?: string } }[]
    }

    const rawText = data.choices?.[0]?.message?.content ?? ''
    return res.status(200).json({ rawText })
  } catch {
    return res.status(502).json({ error: 'API_ERROR' })
  }
}
