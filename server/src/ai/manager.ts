import { getStrategy, getStrategies } from './config'
import { createAgent } from './agents'
import { HumanMessage } from '@langchain/core/messages'

export interface AgentResult {
  agentId: string
  name: string
  type: string
  response: string
  error?: boolean
}

export interface ChatResult {
  agents: AgentResult[]
  decision?: AgentResult
}

export class AgentManager {
  async chat(message: string, strategyId?: string): Promise<ChatResult> {
    const strategy = strategyId
      ? getStrategy(strategyId)
      : getStrategies().find(s => s.enabled)

    if (!strategy) {
      return { agents: [{ agentId: 'system', name: '系统', type: 'system', response: '未找到指定策略或没有启用的策略。' }] }
    }

    const agents = strategy.agents.filter(a => a.enabled)
    const workers = agents.filter(a => a.type !== 'decision')
    const decisionConfig = agents.find(a => a.type === 'decision')

    if (agents.length === 0) {
      return { agents: [{ agentId: 'system', name: '系统', type: 'system', response: '该策略没有启用的Agent，请先配置。' }] }
    }

    const results: AgentResult[] = await Promise.all(
      workers.map(async (config) => {
        try {
          const agent = createAgent(config, strategy)
          const res = await agent.invoke({ messages: [new HumanMessage(message)] })
          const last = res.messages[res.messages.length - 1]
          return { agentId: config.id, name: config.name, type: config.type, response: String(last.content) }
        } catch (e: any) {
          return { agentId: config.id, name: config.name, type: config.type, response: e.message, error: true }
        }
      })
    )

    if (!decisionConfig) return { agents: results }

    const summary = results.map(r => `【${r.name}】:\n${r.response}`).join('\n\n')
    const decisionPrompt = `以下是各分析Agent的分析结果，请综合给出最终投资建议：\n\n${summary}\n\n用户原始问题：${message}`

    let decision: AgentResult
    try {
      const agent = createAgent(decisionConfig, strategy)
      const res = await agent.invoke({ messages: [new HumanMessage(decisionPrompt)] })
      const last = res.messages[res.messages.length - 1]
      decision = { agentId: decisionConfig.id, name: decisionConfig.name, type: 'decision', response: String(last.content) }
    } catch (e: any) {
      decision = { agentId: decisionConfig.id, name: decisionConfig.name, type: 'decision', response: e.message, error: true }
    }

    return { agents: results, decision }
  }
}

export const agentManager = new AgentManager()
