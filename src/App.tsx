import { useEffect, useMemo, useState } from 'react'
import Tesseract from 'tesseract.js'
import logoUrl from '../icon.svg'
import './App.css'

type EntrySource = 'manual' | 'ocr'

type Entry = {
  id: string
  name: string
  amount: number
  source: EntrySource
  createdAt: string
}

type PersistedState = {
  entries: Entry[]
  budget: string
  seniorMode: boolean
}

const STORAGE_KEY = 'snap-total-state-v1'
const currencyFormatter = new Intl.NumberFormat('zh-TW', {
  style: 'currency',
  currency: 'TWD',
  maximumFractionDigits: 0,
})

const keypadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '←']

function loadInitialState(): PersistedState {
  const fallback: PersistedState = {
    entries: [],
    budget: '2000',
    seniorMode: true,
  }

  const raw = localStorage.getItem(STORAGE_KEY)

  if (!raw) {
    return fallback
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>

    return {
      entries: Array.isArray(parsed.entries)
        ? parsed.entries.filter(isValidEntry)
        : fallback.entries,
      budget: typeof parsed.budget === 'string' ? parsed.budget : fallback.budget,
      seniorMode:
        typeof parsed.seniorMode === 'boolean'
          ? parsed.seniorMode
          : fallback.seniorMode,
    }
  } catch {
    return fallback
  }
}

function isValidEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.amount === 'number' &&
    Number.isFinite(record.amount) &&
    typeof record.source === 'string' &&
    typeof record.createdAt === 'string'
  )
}

function normalizeDigits(value: string) {
  return value.replace(/[^\d]/g, '')
}

function parseAmount(value: string) {
  const digits = normalizeDigits(value)

  if (!digits) {
    return 0
  }

  return Number.parseInt(digits, 10)
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

function extractPriceCandidates(text: string) {
  const normalized = text
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')
    .replace(/[,，]/g, ',')

  const pattern =
    /(?:NT\$?|TWD|\$)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,5}(?:\.\d{1,2})?)(?:\s*元)?/g

  const candidates: number[] = []

  for (const match of normalized.matchAll(pattern)) {
    const rawValue = match[1]
    const value = Number.parseFloat(rawValue.replace(/,/g, ''))

    if (!Number.isFinite(value) || value <= 0 || value > 99999) {
      continue
    }

    const integerValue = Math.round(value)

    if (!candidates.includes(integerValue)) {
      candidates.push(integerValue)
    }
  }

  return candidates.slice(0, 6)
}

function createCsv(entries: Entry[]) {
  const header = ['品名', '金額', '來源', '建立時間']
  const lines = entries.map((entry) => [
    `"${entry.name.replaceAll('"', '""')}"`,
    entry.amount,
    entry.source === 'ocr' ? 'OCR' : '手動',
    `"${new Date(entry.createdAt).toLocaleString('zh-TW')}"`,
  ])

  return [header, ...lines].map((line) => line.join(',')).join('\n')
}

function App() {
  const initialState = useMemo(() => loadInitialState(), [])
  const [entries, setEntries] = useState<Entry[]>(initialState.entries)
  const [budget, setBudget] = useState(initialState.budget)
  const [seniorMode, setSeniorMode] = useState(initialState.seniorMode)
  const [draftName, setDraftName] = useState('')
  const [draftAmount, setDraftAmount] = useState('')
  const [manualNotice, setManualNotice] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [ocrName, setOcrName] = useState('')
  const [ocrAmount, setOcrAmount] = useState('')
  const [ocrText, setOcrText] = useState('')
  const [ocrCandidates, setOcrCandidates] = useState<number[]>([])
  const [ocrNotice, setOcrNotice] = useState('上傳價格標籤照片後，系統會幫你找出可能的金額。')
  const [isProcessing, setIsProcessing] = useState(false)
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const [imageName, setImageName] = useState('')
  const [activeTab, setActiveTab] = useState<'manual' | 'ocr'>('manual')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        entries,
        budget,
        seniorMode,
      } satisfies PersistedState),
    )
  }, [budget, entries, seniorMode])

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl)
      }
    }
  }, [imagePreviewUrl])

  const totalAmount = entries.reduce((sum, entry) => sum + entry.amount, 0)
  const budgetAmount = parseAmount(budget)
  const remainingBudget = budgetAmount - totalAmount
  const budgetUsage = budgetAmount > 0 ? Math.min((totalAmount / budgetAmount) * 100, 100) : 0
  const budgetState =
    budgetAmount === 0
      ? '尚未設定預算'
      : remainingBudget < 0
        ? '已超出預算，建議先停一下再確認購物清單。'
        : remainingBudget <= budgetAmount * 0.2
          ? '快接近預算上限，加入新項目前可以先看一下剩餘額度。'
          : '目前花費在預算範圍內。'

  function addEntry(amount: number, name: string, source: EntrySource) {
    const trimmedName = name.trim()

    setEntries((current) => [
      {
        id: crypto.randomUUID(),
        name: trimmedName || `未命名商品 ${current.length + 1}`,
        amount,
        source,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ])
  }

  function handleManualAdd() {
    const amount = parseAmount(draftAmount)

    if (amount <= 0) {
      setManualNotice('請先輸入有效金額。')
      return
    }

    addEntry(amount, draftName, 'manual')
    setDraftAmount('')
    setDraftName('')
    setManualNotice(`已加入 ${formatCurrency(amount)}。`)
  }

  function handleKeypadClick(key: string) {
    setManualNotice('')

    if (key === '←') {
      setDraftAmount((current) => current.slice(0, -1))
      return
    }

    setDraftAmount((current) => {
      const nextValue = `${current}${key}`
      return normalizeDigits(nextValue).slice(0, 6)
    })
  }

  function startEditing(entry: Entry) {
    setEditingId(entry.id)
    setEditName(entry.name)
    setEditAmount(String(entry.amount))
  }

  function saveEditing() {
    if (!editingId) {
      return
    }

    const nextAmount = parseAmount(editAmount)

    if (nextAmount <= 0) {
      return
    }

    setEntries((current) =>
      current.map((entry) =>
        entry.id === editingId
          ? {
              ...entry,
              name: editName.trim() || entry.name,
              amount: nextAmount,
            }
          : entry,
      ),
    )

    setEditingId(null)
    setEditAmount('')
    setEditName('')
  }

  function handleExport() {
    if (entries.length === 0) {
      return
    }

    const blob = new Blob([`\uFEFF${createCsv(entries)}`], {
      type: 'text/csv;charset=utf-8;',
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `snap-total-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl)
    }

    const previewUrl = URL.createObjectURL(file)
    setImagePreviewUrl(previewUrl)
    setImageName(file.name)
    setIsProcessing(true)
    setOcrText('')
    setOcrAmount('')
    setOcrCandidates([])
    setOcrNotice('正在辨識圖片中的價格，請稍候...')

    try {
      const result = await Tesseract.recognize(file, 'eng', {
        logger: (message) => {
          if (message.status) {
            const progress = Math.round((message.progress ?? 0) * 100)
            setOcrNotice(`${message.status} ${progress}%`)
          }
        },
      })

      const text = result.data.text.trim()
      const candidates = extractPriceCandidates(text)

      setOcrText(text)
      setOcrCandidates(candidates)

      if (candidates.length > 0) {
        setOcrAmount(String(candidates[0]))
        setOcrNotice('已找到可能的價格，確認後即可加入清單。')
      } else {
        setOcrNotice('沒有找到明確價格，請直接手動修正金額。')
      }
    } catch {
      setOcrNotice('辨識失敗，請換一張照片，或直接在下方手動輸入金額。')
    } finally {
      setIsProcessing(false)
      event.target.value = ''
    }
  }

  function handleAddOcrItem() {
    const amount = parseAmount(ocrAmount)

    if (amount <= 0) {
      setOcrNotice('請先選擇或輸入一個有效金額。')
      return
    }

    addEntry(amount, ocrName, 'ocr')
    setOcrName('')
    setOcrAmount('')
    setOcrText('')
    setOcrCandidates([])
    setImageName('')

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl)
      setImagePreviewUrl('')
    }

    setOcrNotice(`已加入 OCR 辨識金額 ${formatCurrency(amount)}。`)
  }

  return (
    <main className={`app-shell${seniorMode ? ' senior-mode' : ''}`}>
      <header className="mobile-header">
        <div className="brand">
          <img src={logoUrl} alt="SnapTotal logo" className="brand-logo" />
          <h1 className="brand-title">SnapTotal</h1>
          <div className="desktop-brand-text desktop-only">
            <p className="eyebrow">購物金額快速累計工具</p>
            <p className="hero-copy">
              用拍照或快速輸入，把每一筆價格即時加總，幫家人逛賣場時更容易控管預算。
            </p>
          </div>
        </div>
        <button type="button" className="icon-button settings-trigger" onClick={() => setIsSettingsOpen(true)} aria-label="設定">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </header>

      <section className="hero-card">
        <div className="summary-grid">
          <article className="summary-card total">
            <span>目前總金額</span>
            <div className="total-amount-row">
              <strong>{formatCurrency(totalAmount)}</strong>
              <small className="item-count-badge">{entries.length} 件商品</small>
            </div>
            
            {budgetAmount > 0 && (
              <div className="compact-budget-info">
                <div className="compact-budget-text">
                  <small>預算 {formatCurrency(budgetAmount)}</small>
                  <small className={remainingBudget < 0 ? 'danger' : 'safe'}>
                    {remainingBudget < 0 ? '已超支' : '剩餘'} {formatCurrency(Math.abs(remainingBudget))}
                  </small>
                </div>
                <div className="budget-meter" aria-hidden="true">
                  <div className="budget-meter-fill" style={{ width: `${budgetUsage}%` }} />
                </div>
              </div>
            )}
          </article>

          <article className="summary-card desktop-only">
            <span>預算</span>
            <strong>{budgetAmount > 0 ? formatCurrency(budgetAmount) : '尚未設定'}</strong>
            <small>{budgetState}</small>
          </article>
          <article className="summary-card desktop-only">
            <span>剩餘額度</span>
            <strong className={remainingBudget < 0 ? 'danger' : 'safe'}>
              {budgetAmount > 0 ? formatCurrency(remainingBudget) : '—'}
            </strong>
             <small>{budgetAmount > 0 ? `已使用 ${budgetUsage.toFixed(0)}%` : '可稍後再設定預算'}</small>
          </article>
        </div>

        {isSettingsOpen && (
          <dialog className="settings-modal" open>
            <div className="settings-header">
              <h2>設定</h2>
              <button type="button" className="icon-button" onClick={() => setIsSettingsOpen(false)} aria-label="關閉">×</button>
            </div>
            <div className="budget-panel">
              <label className="field">
                <span>預算設定</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={budget}
                  onChange={(event) => setBudget(normalizeDigits(event.target.value).slice(0, 6))}
                  placeholder="例如 2000"
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={seniorMode}
                  onChange={(event) => setSeniorMode(event.target.checked)}
                />
                <span>長輩模式 (大字體)</span>
              </label>
            </div>
            <button type="button" className="primary-button full-width-add" onClick={() => setIsSettingsOpen(false)}>
              完成
            </button>
          </dialog>
        )}
      </section>

      <section className="workspace">
        <div className="panel-stack">
          <div className="tabs">
            <button
              className={`tab-button ${activeTab === 'manual' ? 'active' : ''}`}
              onClick={() => setActiveTab('manual')}
            >
              手動輸入
            </button>
            <button
              className={`tab-button ${activeTab === 'ocr' ? 'active' : ''}`}
              onClick={() => setActiveTab('ocr')}
            >
              拍照辨識
            </button>
          </div>

          {activeTab === 'manual' && (
            <section className="panel">
              <div className="panel-heading desktop-only">
                <div>
                  <p className="eyebrow">手動快速輸入</p>
                  <h2>比計算機更少步驟</h2>
                </div>
              </div>

              <div className="manual-entry">
                <label className="field compact-field">
                  <span>品名（可不填）</span>
                  <input
                    type="text"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    placeholder="例如：牛奶"
                  />
                </label>

                <label className="field amount-field">
                  <span>金額</span>
                  <div className="amount-display">{draftAmount ? formatCurrency(parseAmount(draftAmount)) : '$0'}</div>
                </label>
              </div>

              <div className="keypad">
                {keypadKeys.map((key) => (
                  <button key={key} type="button" onClick={() => handleKeypadClick(key)}>
                    {key}
                  </button>
                ))}
              </div>

              <button type="button" className="primary-button full-width-add" onClick={handleManualAdd}>
                直接加入
              </button>

              <p className="notice">{manualNotice || '可用大按鈕快速輸入，最後按「直接加入」。'}</p>
            </section>
          )}

          {activeTab === 'ocr' && (
            <section className="panel">
              <div className="panel-heading desktop-only">
                <div>
                  <p className="eyebrow">拍照辨識價格</p>
                  <h2>先拍照，再確認金額</h2>
                </div>
              </div>

              <div className="ocr-toolbar">
                <label className="primary-button file-trigger">
                  <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} />
                  {isProcessing ? '辨識中...' : '拍照或選擇照片'}
                </label>
                <span className="file-name">{imageName || '尚未選擇圖片'}</span>
              </div>

              <div className="ocr-grid">
                <div className="ocr-preview">
                  {imagePreviewUrl ? (
                    <img src={imagePreviewUrl} alt="待辨識價格標籤" />
                  ) : (
                    <div className="empty-state">上傳價格標籤後，這裡會顯示預覽。</div>
                  )}
                </div>

                <div className="ocr-result">
                  <label className="field">
                    <span>品名（可不填）</span>
                    <input
                      type="text"
                      value={ocrName}
                      onChange={(event) => setOcrName(event.target.value)}
                      placeholder="例如：洗衣精"
                    />
                  </label>

                  <label className="field">
                    <span>確認金額</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={ocrAmount}
                      onChange={(event) => setOcrAmount(normalizeDigits(event.target.value).slice(0, 6))}
                      placeholder="辨識後自動帶入"
                    />
                  </label>

                  {ocrCandidates.length > 0 ? (
                    <div className="candidate-group">
                      <span>辨識候選金額</span>
                      <div className="candidate-list">
                        {ocrCandidates.map((candidate) => (
                          <button
                            key={candidate}
                            type="button"
                            className={parseAmount(ocrAmount) === candidate ? 'candidate active' : 'candidate'}
                            onClick={() => setOcrAmount(String(candidate))}
                          >
                            {formatCurrency(candidate)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <button type="button" className="primary-button" onClick={handleAddOcrItem}>
                    加入辨識結果
                  </button>
                </div>
              </div>

              <p className="notice">{ocrNotice}</p>
              <details className="ocr-text">
                <summary>查看 OCR 文字結果</summary>
                <pre>{ocrText || '尚未產生辨識內容。'}</pre>
              </details>
            </section>
          )}
        </div>

        <aside className="side-column">
          <details className="panel list-panel mobile-details" open={window.innerWidth > 640}>
            <summary className="panel-heading list-summary">
              <div>
                <p className="eyebrow desktop-only">購物清單</p>
                <h2 className="desktop-only">可直接編輯或刪除</h2>
                <h2 className="mobile-only">購物清單 <span>({entries.length} 筆)</span></h2>
              </div>
              <div className="actions">
                <button type="button" className="ghost-button" onClick={handleExport} disabled={entries.length === 0}>
                  <span className="desktop-only">匯出紀錄</span>
                  <span className="mobile-only">匯出</span>
                </button>
                <button type="button" className="ghost-button danger-button" onClick={() => setEntries([])} disabled={entries.length === 0}>
                  <span className="desktop-only">清空清單</span>
                  <span className="mobile-only">清空</span>
                </button>
              </div>
            </summary>

            <div className="list list-content">
              {entries.length === 0 ? (
                <div className="empty-state">目前還沒有商品，先從手動輸入或拍照辨識開始。</div>
              ) : (
                entries.map((entry) => (
                  <article key={entry.id} className="list-item">
                    {editingId === entry.id ? (
                      <div className="edit-grid">
                        <input value={editName} onChange={(event) => setEditName(event.target.value)} />
                        <input
                          value={editAmount}
                          inputMode="numeric"
                          onChange={(event) => setEditAmount(normalizeDigits(event.target.value).slice(0, 6))}
                        />
                        <div className="item-actions">
                          <button type="button" className="ghost-button" onClick={saveEditing}>
                            儲存
                          </button>
                          <button type="button" className="ghost-button" onClick={() => setEditingId(null)}>
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <strong>{entry.name}</strong>
                          <p>
                            {entry.source === 'ocr' ? 'OCR 辨識' : '手動輸入'}・
                            {new Date(entry.createdAt).toLocaleTimeString('zh-TW', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                        <div className="list-item-right">
                          <span>{formatCurrency(entry.amount)}</span>
                          <div className="item-actions">
                            <button type="button" className="ghost-button" onClick={() => startEditing(entry)}>
                              編輯
                            </button>
                            <button
                              type="button"
                              className="ghost-button danger-button"
                              onClick={() =>
                                setEntries((current) => current.filter((item) => item.id !== entry.id))
                              }
                            >
                              刪除
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </article>
                ))
              )}
            </div>
          </details>

        </aside>
      </section>
    </main>
  )
}

export default App
