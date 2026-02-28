import { ChatOpenAI } from '@langchain/openai'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import type { AgentConfig, Strategy } from './config'
import { allTools } from './tools'

const SYSTEM_PROMPTS: Record<string, string> = {
  technical: '你是一个专业的股票技术分析师。基于K线数据、均线、成交量等技术指标进行分析。给出技术面判断和趋势预测。回答要简洁专业。',
  fundamental: '你是一个基本面分析师。分析公司财务状况、行业地位、估值水平等。给出基本面评估。回答要简洁专业。',
  sentiment: '你是一个市场情绪分析师。分析市场情绪、资金流向、热点板块等。给出市场情绪判断。回答要简洁专业。',
  decision: '你是一个综合投资决策分析师。综合技术面、基本面、市场情绪等多维度分析结果，给出最终的投资建议和风险提示。回答要结构化、有条理。',
  custom: '你是一个AI助手，帮助用户分析股票市场。',
}

const TOOL_MAP: Record<string, typeof allTools> = {
  technical: allTools,
  fundamental: allTools,
  sentiment: allTools,
  decision: [],
  custom: allTools,
}

export function createAgent(agent: AgentConfig, strategy: Strategy) {
  const llmConfig = agent.llmConfig ?? strategy.defaultLLM
  if (!llmConfig) throw new Error(`Agent "${agent.name}" 没有LLM配置，策略也没有默认LLM`)

  const llm = new ChatOpenAI({
    configuration: { baseURL: llmConfig.baseUrl },
    apiKey: llmConfig.apiKey,
    model: llmConfig.model,
    temperature: llmConfig.temperature ?? 0.3,
  })

  let prompt = agent.systemPrompt || SYSTEM_PROMPTS[agent.type] || SYSTEM_PROMPTS.custom
  if (strategy.promptEnhancement) prompt += '\n' + strategy.promptEnhancement
  if (agent.promptEnhancement) prompt += '\n' + agent.promptEnhancement

  const tools = TOOL_MAP[agent.type] || allTools

  return createReactAgent({ llm, tools, prompt })
}
