import OpenAI from 'openai'
import type {
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionCreateParams,
    ChatCompletionMessageParam
} from 'openai/resources/chat/completions'
import type {
    FunctionTool,
    Response as OpenAIResponse,
    ResponseCreateParams,
    ResponseFunctionToolCall,
    ResponseInputItem,
    ResponseOutputMessage,
    ResponseStreamEvent
} from 'openai/resources/responses/responses'
import type { Stream } from 'openai/streaming'
import * as types from './types'
import * as provider from './provider'
import * as utils from './utils'

type ClaudeStreamState = {
    textBlockOpen: boolean
    textBlockIndex: number
    toolUseBlockIndex: number
    stopReason: types.ClaudeStopReason
    usage: {
        input_tokens: number
        output_tokens: number
    }
}

function createClient(apiKey: string, baseUrl: string): OpenAI {
    return new OpenAI({
        apiKey: apiKey.startsWith('Bearer ') ? apiKey.slice('Bearer '.length) : apiKey,
        baseURL: baseUrl,
        timeout: 600_000,
        maxRetries: 0
    })
}

function systemText(system: types.ClaudeRequest['system']): string | undefined {
    if (!system) return undefined
    if (typeof system === 'string') return system
    return system
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n')
}

function contentToText(content: types.ClaudeContent): string {
    if (typeof content === 'string') return content

    return content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n')
}

function toolResultToText(content: string | unknown): string {
    return typeof content === 'string' ? content : JSON.stringify(content)
}

function stopReasonFromOpenAI(finishReason?: string | null): types.ClaudeStopReason {
    switch (finishReason) {
        case 'tool_calls':
        case 'function_call':
            return 'tool_use'
        case 'length':
            return 'max_tokens'
        case 'stop':
        default:
            return 'end_turn'
    }
}

function stopReasonFromResponseStatus(status?: string): types.ClaudeStopReason {
    return status === 'incomplete' ? 'max_tokens' : 'end_turn'
}

function parseToolArguments(args: string): unknown {
    return utils.safeJsonParse(args || '{}')
}

function initStreamState(): ClaudeStreamState {
    return {
        textBlockOpen: false,
        textBlockIndex: 0,
        toolUseBlockIndex: 0,
        stopReason: 'end_turn',
        usage: {
            input_tokens: 0,
            output_tokens: 0
        }
    }
}

function openTextBlockIfNeeded(events: string[], state: ClaudeStreamState): void {
    if (state.textBlockOpen) return
    events.push(utils.startTextBlock(state.textBlockIndex))
    state.textBlockOpen = true
}

function closeTextBlockIfNeeded(events: string[], state: ClaudeStreamState): void {
    if (!state.textBlockOpen) return
    events.push(utils.stopContentBlock(state.textBlockIndex))
    state.textBlockIndex++
    state.textBlockOpen = false
}

function enqueueEvents(controller: ReadableStreamDefaultController, events: string[]): void {
    for (const event of events) {
        utils.enqueueRawSse(controller, event)
    }
}

function errorToResponse(error: unknown): Response {
    if (error instanceof OpenAI.APIError) {
        const body = error.error ?? { error: { message: error.message, type: error.name } }
        return jsonResponse(body, error.status ?? 500)
    }

    console.error(error)
    return new Response('OpenAI SDK request failed', { status: 502 })
}

export class ChatCompletionsProvider implements provider.Provider {
    async handle(request: Request, baseUrl: string, apiKey: string): Promise<Response> {
        const claudeRequest = (await request.json()) as types.ClaudeRequest
        const openaiRequest = this.convertToOpenAIRequestBody(claudeRequest)
        const client = createClient(apiKey, baseUrl)

        try {
            if (claudeRequest.stream) {
                const stream = await client.chat.completions.create({
                    ...openaiRequest,
                    stream: true,
                    stream_options: {
                        include_usage: true
                    }
                } as ChatCompletionCreateParams)
                return this.convertStreamResponse(stream as Stream<ChatCompletionChunk>)
            }

            const completion = await client.chat.completions.create({
                ...openaiRequest,
                stream: false
            } as ChatCompletionCreateParams)
            return this.convertNormalResponse(completion as ChatCompletion)
        } catch (error) {
            return errorToResponse(error)
        }
    }

    async convertToProviderRequest(request: Request, baseUrl: string, apiKey: string): Promise<Request> {
        const claudeRequest = (await request.json()) as types.ClaudeRequest
        const openaiRequest = this.convertToOpenAIRequestBody(claudeRequest)
        const finalUrl = utils.buildUrl(baseUrl, 'chat/completions')

        const headers = new Headers(request.headers)
        headers.set('Authorization', apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`)
        headers.set('Content-Type', 'application/json')

        return new Request(finalUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(openaiRequest)
        })
    }

    async convertToClaudeResponse(openaiResponse: Response): Promise<Response> {
        if (!openaiResponse.ok) {
            return openaiResponse
        }

        const openaiData = (await openaiResponse.json()) as ChatCompletion
        return this.convertNormalResponse(openaiData)
    }

    private convertToOpenAIRequestBody(claudeRequest: types.ClaudeRequest): ChatCompletionCreateParams {
        const openaiRequest: ChatCompletionCreateParams = {
            model: claudeRequest.model,
            messages: this.convertMessages(claudeRequest),
            stream: claudeRequest.stream ?? false
        }

        if (claudeRequest.tools && claudeRequest.tools.length > 0) {
            openaiRequest.tools = claudeRequest.tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: utils.cleanJsonSchema(tool.input_schema)
                }
            }))
        }

        if (claudeRequest.temperature !== undefined) {
            openaiRequest.temperature = claudeRequest.temperature
        }

        if (claudeRequest.max_tokens !== undefined) {
            openaiRequest.max_tokens = claudeRequest.max_tokens
        }

        return openaiRequest
    }

    private convertMessages(claudeRequest: types.ClaudeRequest): ChatCompletionMessageParam[] {
        const openaiMessages: ChatCompletionMessageParam[] = []
        const system = systemText(claudeRequest.system)
        if (system) {
            openaiMessages.push({ role: 'system', content: system })
        }

        for (const message of claudeRequest.messages) {
            if (typeof message.content === 'string') {
                openaiMessages.push({
                    role: message.role === 'assistant' ? 'assistant' : 'user',
                    content: message.content
                })
                continue
            }

            const textContents: string[] = []
            const toolCalls: NonNullable<types.OpenAIMessage['tool_calls']> = []
            const toolResults: Array<{ tool_call_id: string; content: string }> = []

            for (const content of message.content) {
                switch (content.type) {
                    case 'text':
                        textContents.push(content.text)
                        break
                    case 'tool_use':
                        toolCalls.push({
                            id: content.id,
                            type: 'function',
                            function: {
                                name: content.name,
                                arguments: JSON.stringify(content.input)
                            }
                        })
                        break
                    case 'tool_result':
                        toolResults.push({
                            tool_call_id: content.tool_use_id,
                            content: toolResultToText(content.content)
                        })
                        break
                }
            }

            if (textContents.length > 0 || toolCalls.length > 0) {
                openaiMessages.push({
                    role: message.role === 'assistant' ? 'assistant' : 'user',
                    content: textContents.length > 0 ? textContents.join('\n') : null,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                } as ChatCompletionMessageParam)
            }

            for (const toolResult of toolResults) {
                openaiMessages.push({
                    role: 'tool',
                    tool_call_id: toolResult.tool_call_id,
                    content: toolResult.content
                })
            }
        }

        return openaiMessages
    }

    private convertNormalResponse(openaiData: ChatCompletion): Response {
        const claudeResponse: types.ClaudeResponse = {
            id: openaiData.id || utils.generateId(),
            type: 'message',
            role: 'assistant',
            content: [],
            usage: {
                input_tokens: 0,
                output_tokens: 0
            }
        }

        if (openaiData.choices && openaiData.choices.length > 0) {
            const choice = openaiData.choices[0]
            const message = choice.message

            if (message.content) {
                claudeResponse.content.push({
                    type: 'text',
                    text: message.content
                })
            }

            if (message.tool_calls) {
                for (const toolCall of message.tool_calls) {
                    if (toolCall.type !== 'function') continue
                    claudeResponse.content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: parseToolArguments(toolCall.function.arguments)
                    })
                }
            }

            claudeResponse.stop_reason = stopReasonFromOpenAI(choice.finish_reason)
        }

        if (openaiData.usage) {
            claudeResponse.usage = {
                input_tokens: openaiData.usage.prompt_tokens,
                output_tokens: openaiData.usage.completion_tokens
            }
        }

        return jsonResponse(claudeResponse, 200)
    }

    private convertStreamResponse(openaiStream: Stream<ChatCompletionChunk>): Response {
        const stream = new ReadableStream({
            async start(controller) {
                const state = initStreamState()
                const toolCallState = new Map<number, { id?: string; name?: string; args: string }>()

                utils.sendMessageStart(controller)

                try {
                    for await (const chunk of openaiStream) {
                        if (chunk.usage) {
                            state.usage = {
                                input_tokens: chunk.usage.prompt_tokens,
                                output_tokens: chunk.usage.completion_tokens
                            }
                        }

                        if (!chunk.choices || chunk.choices.length === 0) continue

                        const choice = chunk.choices[0]
                        const delta = choice.delta
                        const events: string[] = []

                        if (delta.content) {
                            openTextBlockIfNeeded(events, state)
                            events.push(utils.textDelta(delta.content, state.textBlockIndex))
                        }

                        if (delta.tool_calls) {
                            for (const toolCall of delta.tool_calls) {
                                const stateForTool = toolCallState.get(toolCall.index) ?? { args: '' }
                                stateForTool.id = toolCall.id ?? stateForTool.id
                                stateForTool.name = toolCall.function?.name ?? stateForTool.name
                                stateForTool.args += toolCall.function?.arguments ?? ''
                                toolCallState.set(toolCall.index, stateForTool)
                            }
                        }

                        if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call') {
                            closeTextBlockIfNeeded(events, state)
                            for (const [, toolCall] of [...toolCallState].sort(([a], [b]) => a - b)) {
                                if (!toolCall.name) continue
                                events.push(
                                    ...utils.processToolUsePart(
                                        {
                                            name: toolCall.name,
                                            args: parseToolArguments(toolCall.args)
                                        },
                                        state.toolUseBlockIndex
                                    )
                                )
                                state.toolUseBlockIndex++
                            }
                            state.stopReason = 'tool_use'
                        } else if (choice.finish_reason) {
                            closeTextBlockIfNeeded(events, state)
                            state.stopReason = stopReasonFromOpenAI(choice.finish_reason)
                        }

                        enqueueEvents(controller, events)
                    }
                } catch (error) {
                    console.error(error)
                    controller.error(error)
                    return
                } finally {
                    const events: string[] = []
                    closeTextBlockIfNeeded(events, state)
                    enqueueEvents(controller, events)
                    utils.sendMessageDelta(controller, state.stopReason, state.usage)
                    utils.sendMessageStop(controller)
                    controller.close()
                }
            }
        })

        return streamResponse(stream)
    }
}

export class ResponsesProvider implements provider.Provider {
    async handle(request: Request, baseUrl: string, apiKey: string): Promise<Response> {
        const claudeRequest = (await request.json()) as types.ClaudeRequest
        const openaiRequest = this.convertToResponsesRequestBody(claudeRequest)
        const client = createClient(apiKey, baseUrl)

        try {
            if (claudeRequest.stream) {
                const stream = await client.responses.create({
                    ...openaiRequest,
                    stream: true
                } as ResponseCreateParams)
                return this.convertStreamResponse(stream as Stream<ResponseStreamEvent>)
            }

            const response = await client.responses.create({
                ...openaiRequest,
                stream: false
            } as ResponseCreateParams)
            return this.convertNormalResponse(response as OpenAIResponse)
        } catch (error) {
            return errorToResponse(error)
        }
    }

    async convertToProviderRequest(request: Request, baseUrl: string, apiKey: string): Promise<Request> {
        const claudeRequest = (await request.json()) as types.ClaudeRequest
        const openaiRequest = this.convertToResponsesRequestBody(claudeRequest)
        const finalUrl = utils.buildUrl(baseUrl, 'responses')

        const headers = new Headers(request.headers)
        headers.set('Authorization', apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`)
        headers.set('Content-Type', 'application/json')

        return new Request(finalUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(openaiRequest)
        })
    }

    async convertToClaudeResponse(openaiResponse: Response): Promise<Response> {
        if (!openaiResponse.ok) {
            return openaiResponse
        }

        const openaiData = (await openaiResponse.json()) as OpenAIResponse
        return this.convertNormalResponse(openaiData)
    }

    private convertToResponsesRequestBody(claudeRequest: types.ClaudeRequest): ResponseCreateParams {
        const openaiRequest: ResponseCreateParams = {
            model: claudeRequest.model,
            input: this.convertInput(claudeRequest.messages),
            stream: claudeRequest.stream ?? false
        }

        const system = systemText(claudeRequest.system)
        if (system) {
            openaiRequest.instructions = system
        }

        if (claudeRequest.tools && claudeRequest.tools.length > 0) {
            openaiRequest.tools = claudeRequest.tools.map(tool => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: utils.cleanJsonSchema(tool.input_schema),
                strict: null
            })) as FunctionTool[]
        }

        if (claudeRequest.temperature !== undefined) {
            openaiRequest.temperature = claudeRequest.temperature
        }

        if (claudeRequest.max_tokens !== undefined) {
            openaiRequest.max_output_tokens = claudeRequest.max_tokens
        }

        return openaiRequest
    }

    private convertInput(messages: types.ClaudeMessage[]): ResponseInputItem[] {
        const input: ResponseInputItem[] = []

        for (const message of messages) {
            if (typeof message.content === 'string') {
                input.push({
                    type: 'message',
                    role: message.role,
                    content: [
                        {
                            type: message.role === 'assistant' ? 'output_text' : 'input_text',
                            text: message.content
                        }
                    ]
                } as ResponseInputItem)
                continue
            }

            const text = contentToText(message.content)
            if (text) {
                input.push({
                    type: 'message',
                    role: message.role,
                    content: [
                        {
                            type: message.role === 'assistant' ? 'output_text' : 'input_text',
                            text
                        }
                    ]
                } as ResponseInputItem)
            }

            for (const content of message.content) {
                if (content.type === 'tool_use') {
                    input.push({
                        type: 'function_call',
                        call_id: content.id,
                        name: content.name,
                        arguments: JSON.stringify(content.input)
                    } as ResponseInputItem)
                } else if (content.type === 'tool_result') {
                    input.push({
                        type: 'function_call_output',
                        call_id: content.tool_use_id,
                        output: toolResultToText(content.content)
                    } as ResponseInputItem)
                }
            }
        }

        return input
    }

    private convertNormalResponse(openaiData: OpenAIResponse): Response {
        const claudeResponse: types.ClaudeResponse = {
            id: openaiData.id || utils.generateId(),
            type: 'message',
            role: 'assistant',
            content: [],
            stop_reason: 'end_turn',
            usage: {
                input_tokens: 0,
                output_tokens: 0
            }
        }

        for (const output of openaiData.output ?? []) {
            if (output.type === 'message') {
                const message = output as ResponseOutputMessage
                for (const content of message.content ?? []) {
                    if (content.type === 'output_text') {
                        claudeResponse.content.push({ type: 'text', text: content.text })
                    }
                }
            } else if (output.type === 'function_call') {
                const toolCall = output as ResponseFunctionToolCall
                claudeResponse.content.push({
                    type: 'tool_use',
                    id: toolCall.call_id,
                    name: toolCall.name,
                    input: parseToolArguments(toolCall.arguments)
                })
                claudeResponse.stop_reason = 'tool_use'
            }
        }

        if (claudeResponse.content.length === 0 && openaiData.output_text) {
            claudeResponse.content.push({ type: 'text', text: openaiData.output_text })
        }

        if (openaiData.status === 'incomplete') {
            claudeResponse.stop_reason = 'max_tokens'
        }

        if (openaiData.usage) {
            claudeResponse.usage = {
                input_tokens: openaiData.usage.input_tokens ?? 0,
                output_tokens: openaiData.usage.output_tokens ?? 0
            }
        }

        return jsonResponse(claudeResponse, 200)
    }

    private convertStreamResponse(openaiStream: Stream<ResponseStreamEvent>): Response {
        const stream = new ReadableStream({
            async start(controller) {
                const state = initStreamState()
                const functionCalls = new Map<number, { name?: string; callId?: string; args: string }>()

                utils.sendMessageStart(controller)

                try {
                    for await (const event of openaiStream) {
                        const events: string[] = []

                        switch (event.type) {
                            case 'response.output_text.delta':
                                if (event.delta) {
                                    openTextBlockIfNeeded(events, state)
                                    events.push(utils.textDelta(event.delta, state.textBlockIndex))
                                }
                                break
                            case 'response.output_item.added':
                                if (event.item?.type === 'function_call') {
                                    const item = event.item as ResponseFunctionToolCall
                                    const index = event.output_index ?? functionCalls.size
                                    functionCalls.set(index, {
                                        name: item.name,
                                        callId: item.call_id,
                                        args: item.arguments ?? ''
                                    })
                                }
                                break
                            case 'response.function_call_arguments.delta': {
                                const call = functionCalls.get(event.output_index) ?? { args: '' }
                                call.args += event.delta ?? ''
                                functionCalls.set(event.output_index, call)
                                break
                            }
                            case 'response.output_item.done':
                                if (event.item?.type === 'function_call') {
                                    closeTextBlockIfNeeded(events, state)
                                    const item = event.item as ResponseFunctionToolCall
                                    const call = functionCalls.get(event.output_index) ?? { args: '' }
                                    call.name = item.name ?? call.name
                                    call.callId = item.call_id ?? call.callId
                                    call.args = item.arguments ?? call.args
                                    if (call.name) {
                                        events.push(
                                            ...utils.processToolUsePart(
                                                { name: call.name, args: parseToolArguments(call.args) },
                                                state.toolUseBlockIndex
                                            )
                                        )
                                        state.toolUseBlockIndex++
                                        state.stopReason = 'tool_use'
                                    }
                                }
                                break
                            case 'response.completed':
                                closeTextBlockIfNeeded(events, state)
                                state.stopReason = stopReasonFromResponseStatus(event.response.status)
                                if (event.response.usage) {
                                    state.usage = {
                                        input_tokens: event.response.usage.input_tokens ?? 0,
                                        output_tokens: event.response.usage.output_tokens ?? 0
                                    }
                                }
                                break
                            case 'response.incomplete':
                                closeTextBlockIfNeeded(events, state)
                                state.stopReason = 'max_tokens'
                                if (event.response.usage) {
                                    state.usage = {
                                        input_tokens: event.response.usage.input_tokens ?? 0,
                                        output_tokens: event.response.usage.output_tokens ?? 0
                                    }
                                }
                                break
                        }

                        enqueueEvents(controller, events)
                    }
                } catch (error) {
                    console.error(error)
                    controller.error(error)
                    return
                } finally {
                    const events: string[] = []
                    closeTextBlockIfNeeded(events, state)
                    enqueueEvents(controller, events)
                    utils.sendMessageDelta(controller, state.stopReason, state.usage)
                    utils.sendMessageStop(controller)
                    controller.close()
                }
            }
        })

        return streamResponse(stream)
    }
}

function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json'
        }
    })
}

function streamResponse(stream: ReadableStream): Response {
    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
        }
    })
}

export { ChatCompletionsProvider as impl }
