import { Router } from 'express'

const router = Router()
const API_BASE = 'https://jin.20021002.xyz/api.php'
const GOLD_TYPES = ['zs', 'ms', 'icbc', 'cgb', 'cib', 'gj']

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
}

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// 所有银行金价
router.get('/gold', async (_req, res) => {
  try {
    const results = await Promise.all(
      GOLD_TYPES.map(async (type) => {
        const resp = await fetch(`${API_BASE}?type=${type}`, {
          headers: HEADERS,
        })
        return resp.json()
      }),
    )
    res.json({ code: 200, data: results.map((r: any) => r.data) })
  } catch {
    res.status(500).json({ code: 500, msg: 'Failed to fetch gold prices' })
  }
})

// 单个银行金价
router.get('/gold/:type', async (req, res) => {
  try {
    const resp = await fetch(`${API_BASE}?type=${req.params.type}`, {
      headers: HEADERS,
    })
    const data = await resp.json()
    res.json(data)
  } catch {
    res.status(500).json({ code: 500, msg: 'Failed to fetch gold price' })
  }
})

// 所有银行走势图数据
router.get('/chart', async (_req, res) => {
  try {
    const results = await Promise.all(
      GOLD_TYPES.map(async (type) => {
        const resp = await fetch(`${API_BASE}?action=chart&type=${type}`, {
          headers: HEADERS,
        })
        const json = await resp.json()
        return { type, data: json.data || [] }
      }),
    )
    res.json({ code: 200, data: results })
  } catch {
    res.status(500).json({ code: 500, msg: 'Failed to fetch chart data' })
  }
})

// 单个走势图数据
router.get('/chart/:type', async (req, res) => {
  try {
    const resp = await fetch(
      `${API_BASE}?action=chart&type=${req.params.type}`,
      { headers: HEADERS },
    )
    const data = await resp.json()
    res.json(data)
  } catch {
    res.status(500).json({ code: 500, msg: 'Failed to fetch chart data' })
  }
})

// 情绪因子数据
router.get('/sentiment', async (_req, res) => {
  try {
    const goldResp = await fetch(`${API_BASE}?type=gj`, { headers: HEADERS })
    const goldData = await goldResp.json()

    const chartResp = await fetch(`${API_BASE}?action=chart&type=gj`, {
      headers: HEADERS,
    })
    const chartData = await chartResp.json()

    const goldPrice = goldData.data?.price || 0

    // 计算50日均线
    let ma50 = null
    if (chartData.code === 200 && chartData.data?.length > 0) {
      const prices = chartData.data.map((d: any) => d.p)
      if (prices.length >= 50) {
        const last50 = prices.slice(-50)
        ma50 = last50.reduce((a: number, b: number) => a + b, 0) / 50
      }
    }

    // 计算金价相对50日均线的位置
    let maSignal = null
    if (ma50 && goldPrice > 0) {
      maSignal = ((goldPrice - ma50) / ma50) * 100
    }

    res.json({
      code: 200,
      data: {
        goldPrice,
        goldChange: goldData.data?.change_pct || 0,
        ma50: ma50 ? Number(ma50.toFixed(2)) : null,
        maSignal: maSignal ? Number(maSignal.toFixed(2)) : null,
      },
    })
  } catch {
    res.status(500).json({ code: 500, msg: 'Failed to fetch sentiment data' })
  }
})

const VDJ_BASE = 'https://gold.vdj.me'
const VDJ_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://gold.vdj.me/zh',
  Accept: 'application/json, text/plain, */*',
}

// 代理 - 趋势预测
router.get('/vdj/predict', async (_req, res) => {
  try {
    const resp = await fetch(`${VDJ_BASE}/api/predict`, {
      headers: VDJ_HEADERS,
    })
    const data = await resp.json()
    res.json(data)
  } catch {
    res.status(500).json({ code: 500, msg: 'Failed to fetch predict data' })
  }
})

// 代理 - 全球报价
router.get('/vdj/quotes', async (_req, res) => {
  try {
    const resp = await fetch(`${VDJ_BASE}/api/prices?type=quotes`, {
      headers: VDJ_HEADERS,
    })
    const data = await resp.json()
    res.json(data)
  } catch {
    res.status(500).json({ code: 500, msg: 'Failed to fetch quotes data' })
  }
})

// 代理 - 宏观指标
router.get('/vdj/macro', async (_req, res) => {
  try {
    const resp = await fetch(`${VDJ_BASE}/api/macro`, { headers: VDJ_HEADERS })
    const data = await resp.json()
    res.json(data)
  } catch {
    res.status(500).json({ code: 500, msg: 'Failed to fetch macro data' })
  }
})

export default router
