export interface JsonSchema {
    type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null'
    properties?: { [key: string]: JsonSchema }
    required?: string[]
    description?: string
    items?: JsonSchema
    enum?: Array<string | number | boolean | null>
    anyOf?: JsonSchema[]
    oneOf?: JsonSchema[]
    additionalProperties?: boolean | JsonSchema
}

export interface ClaudeTool {
    name: string
    description: string
    input_schema: JsonSchema
}

export type ClaudeContent =
    | string
    | Array<
          | { type: 'text'; text: string }
          | { type: 'tool_use'; id: string; name: string; input: any }
          | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
      >

export interface ClaudeMessage {
    role: 'user' | 'assistant'
    content: ClaudeContent
}

export interface ClaudeRequest {
    model: string
    messages: ClaudeMessage[]
    system?: string | Array<{ type: 'text'; text: string }>
    max_tokens?: number
    temperature?: number
    stream?: boolean
    tools?: ClaudeTool[]
}

export interface ClaudeResponse {
    id: string
    type: 'message'
    role: 'assistant'
    content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: any }>
    stop_reason?: ClaudeStopReason
    usage: {
        input_tokens: number
        output_tokens: number
    }
}

export type ClaudeStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'

export interface GeminiFunctionDeclaration {
    name: string
    description: string
    parameters: JsonSchema
}

export interface GeminiTool {
    functionDeclarations: GeminiFunctionDeclaration[]
}

export type GeminiPart =
    | { text: string }
    | { functionCall: { name: string; args: any } }
    | { functionResponse: { name: string; response: any } }

export interface GeminiContent {
    parts: GeminiPart[]
    role?: 'user' | 'model' | 'tool'
}

export interface GeminiRequest {
    model?: string
    contents: GeminiContent[]
    systemInstruction?: GeminiContent
    tools?: GeminiTool[]
    generationConfig?: {
        temperature?: number
        maxOutputTokens?: number
    }
}

export interface GeminiCandidate {
    content: {
        parts: GeminiPart[]
        role: 'model'
    }
    finishReason?: string
}

export interface GeminiResponse {
    candidates: GeminiCandidate[]
    usageMetadata?: {
        promptTokenCount: number
        candidatesTokenCount: number
        totalTokenCount: number
    }
}

export interface ClaudeStreamEvent {
    type:
        | 'message_start'
        | 'content_block_start'
        | 'content_block_delta'
        | 'content_block_stop'
        | 'message_delta'
        | 'message_stop'
    message?: Partial<ClaudeResponse>
    content_block?: {
        type: 'text' | 'tool_use'
        text?: string
        id?: string
        name?: string
        input?: any
    }
    delta?: {
        type: 'text_delta' | 'input_json_delta'
        text?: string
        partial_json?: string
    }
    index?: number
    usage?: {
        input_tokens: number
        output_tokens: number
    }
}

export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content?: string | null
    tool_calls?: OpenAIToolCall[]
    tool_call_id?: string
}

export interface OpenAIToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

export interface OpenAITool {
    type: 'function'
    function: {
        name: string
        description?: string
        parameters?: any
    }
}

export interface OpenAIRequest {
    model: string
    messages: OpenAIMessage[]
    tools?: OpenAITool[]
    temperature?: number
    max_tokens?: number
    stream?: boolean
}

export interface OpenAIResponsesRequest {
    model: string
    input: OpenAIResponsesInputItem[]
    instructions?: string
    tools?: OpenAIResponsesTool[]
    temperature?: number
    max_output_tokens?: number
    stream?: boolean
}

export type OpenAIResponsesInputItem =
    | {
          type: 'message'
          role: 'user' | 'assistant' | 'system'
          content: Array<{ type: 'input_text'; text: string } | { type: 'output_text'; text: string }>
      }
    | {
          type: 'function_call'
          call_id: string
          name: string
          arguments: string
      }
    | {
          type: 'function_call_output'
          call_id: string
          output: string
      }

export interface OpenAIResponsesTool {
    type: 'function'
    name: string
    description?: string
    parameters?: any
}

export interface OpenAIResponsesResponse {
    id: string
    output?: Array<
        | {
              type: 'message'
              content?: Array<{ type: 'output_text'; text: string } | { type: string; [key: string]: any }>
          }
        | {
              type: 'function_call'
              call_id: string
              name: string
              arguments: string
          }
        | { type: string; [key: string]: any }
    >
    output_text?: string
    status?: string
    usage?: {
        input_tokens?: number
        output_tokens?: number
    }
}

export interface OpenAIChoice {
    index: number
    message: OpenAIMessage
    finish_reason: string | null
}

export interface OpenAIResponse {
    id: string
    object: string
    created: number
    model: string
    choices: OpenAIChoice[]
    usage?: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
    }
}

export interface OpenAIStreamChoice {
    index: number
    delta: {
        role?: string
        content?: string
        tool_calls?: Array<{
            index: number
            id?: string
            type?: 'function'
            function?: {
                name?: string
                arguments?: string
            }
        }>
    }
    finish_reason?: string | null
}

export interface OpenAIStreamResponse {
    id: string
    object: string
    created: number
    model: string
    choices: OpenAIStreamChoice[]
}
