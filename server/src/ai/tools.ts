import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { proxy } from '../services/dataApi'

export const getStockQuote = tool(
  async ({ symbol }) => {
    const data = await proxy(`/api/quote?symbol=${symbol}`)
    return JSON.stringify(data)
  },
  {
    name: 'getStockQuote',
    description: '获取股票实时报价，输入股票代码如 sh600519',
    schema: z.object({ symbol: z.string().describe('股票代码，如 sh600519') }),
  }
)

export const getStockHistory = tool(
  async ({ symbol, period, count }) => {
    const params = new URLSearchParams({ symbol, period: period || 'daily', count: String(count || 30) })
    const data = await proxy(`/api/history?${params}`)
    return JSON.stringify(data)
  },
  {
    name: 'getStockHistory',
    description: '获取股票历史K线数据',
    schema: z.object({
      symbol: z.string().describe('股票代码'),
      period: z.string().optional().describe('周期: daily/weekly/monthly'),
      count: z.number().optional().describe('数据条数，默认30'),
    }),
  }
)

export const getMarketIndices = tool(
  async () => {
    const data = await proxy('/api/indices')
    return JSON.stringify(data)
  },
  {
    name: 'getMarketIndices',
    description: '获取大盘指数数据（上证、深证、创业板等）',
    schema: z.object({}),
  }
)

export const allTools = [getStockQuote, getStockHistory, getMarketIndices]
