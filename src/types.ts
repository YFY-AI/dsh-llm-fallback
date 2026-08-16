// 共享类型定义，供 Host / Client / 外部消费者复用

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
}

export interface LlmEmbeddingOptions {
  model?: string
  dimensions?: number
  encoding_format?: 'float' | 'base64'
}

export interface ProviderHealth {
  name: string
  healthy: boolean
  latency?: number
  lastCheck: number
}