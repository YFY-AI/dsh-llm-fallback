// 共享类型定义,供 Host / 外部消费者复用

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_calls?: any[]
  tool_call_id?: string
}

export interface LlmChatOptions {
  model?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  stream?: boolean
  tools?: any[]
  tool_choice?: any
  /** 内部字段:超时/取消用 AbortSignal 传导到上游 provider 调用 */
  signal?: AbortSignal
}

export interface LlmEmbeddingOptions {
  model?: string
  dimensions?: number
  encoding_format?: 'float' | 'base64'
  /** 内部字段:同 LlmChatOptions.signal */
  signal?: AbortSignal
}

/**
 * 可回退的 LLM 提供商(鸭子类型:带 name + chat 即视为 provider)。
 * healthCheck 可选:实现方返回是否健康,用于周期探测。
 */
export interface LlmProvider {
  name: string
  chat(messages: LlmMessage[], options?: LlmChatOptions): Promise<unknown>
  embeddings?(input: string[], options?: LlmEmbeddingOptions): Promise<unknown>
  healthCheck?(): Promise<boolean> | boolean
}

/** 单 provider 的健康/熔断状态(外部可读) */
export interface ProviderHealth {
  name: string
  healthy: boolean
  latency?: number
  lastCheck: number
  consecutiveFailures: number
  /** 熔断冷却截止时间戳;undefined = 未熔断 */
  downUntil?: number
}
