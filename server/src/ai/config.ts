import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface LLMConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
}

export interface AgentConfig {
  id: string
  name: string
  type: 'technical' | 'fundamental' | 'sentiment' | 'decision' | 'custom'
  enabled: boolean
  llmConfig?: LLMConfig
  systemPrompt?: string
  promptEnhancement?: string
}

export interface Strategy {
  id: string
  name: string
  description: string
  enabled: boolean
  defaultLLM?: LLMConfig
  promptEnhancement?: string
  agents: AgentConfig[]
}

const CONFIG_PATH = join(__dirname, '../../strategies.json')

const DEFAULT_STRATEGIES: Strategy[] = [
  {
    id: 'default',
    name: '综合分析',
    description: '包含技术面、基本面、情绪分析和综合决策的完整分析策略',
    enabled: true,
    defaultLLM: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', temperature: 0.3 },
    agents: [
      { id: 'technical', name: '技术分析Agent', type: 'technical', enabled: true },
      { id: 'fundamental', name: '基本面Agent', type: 'fundamental', enabled: true },
      { id: 'sentiment', name: '情绪分析Agent', type: 'sentiment', enabled: true },
      { id: 'decision', name: '综合决策Agent', type: 'decision', enabled: true, llmConfig: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', temperature: 0.5 } },
    ],
  },
]

function load(): Strategy[] {
  if (!existsSync(CONFIG_PATH)) {
    save(DEFAULT_STRATEGIES)
    return DEFAULT_STRATEGIES
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
}

function save(strategies: Strategy[]) {
  writeFileSync(CONFIG_PATH, JSON.stringify(strategies, null, 2))
}

export function getStrategies(): Strategy[] {
  return load()
}

export function getStrategy(id: string): Strategy | undefined {
  return load().find(s => s.id === id)
}

export function addStrategy(strategy: Strategy): Strategy {
  const list = load()
  list.push(strategy)
  save(list)
  return strategy
}

export function updateStrategy(id: string, patch: Partial<Strategy>): Strategy | null {
  const list = load()
  const idx = list.findIndex(s => s.id === id)
  if (idx === -1) return null
  list[idx] = { ...list[idx], ...patch, id }
  save(list)
  return list[idx]
}

export function deleteStrategy(id: string): boolean {
  const list = load()
  const filtered = list.filter(s => s.id !== id)
  if (filtered.length === list.length) return false
  save(filtered)
  return true
}
