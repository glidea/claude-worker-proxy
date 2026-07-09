export function generateId(): string {
    return crypto.randomUUID()
}

const encoder = new TextEncoder()

export function safeJsonParse(value: string): any {
    try {
        return JSON.parse(value)
    } catch {
        return {}
    }
}

export function sse(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function enqueueSse(controller: ReadableStreamDefaultController, event: string, data: unknown): void {
    controller.enqueue(encoder.encode(sse(event, data)))
}

export function enqueueRawSse(controller: ReadableStreamDefaultController, event: string): void {
    controller.enqueue(encoder.encode(event))
}

export function sendMessageStart(controller: ReadableStreamDefaultController): void {
    const event = sse('message_start', {
        type: 'message_start',
        message: {
            id: generateId(),
            type: 'message',
            role: 'assistant',
            content: []
        }
    })
    controller.enqueue(encoder.encode(event))
}

export function sendMessageDelta(controller: ReadableStreamDefaultController, stopReason: string): void {
    enqueueSse(controller, 'message_delta', {
        type: 'message_delta',
        delta: {
            stop_reason: stopReason,
            stop_sequence: null
        }
    })
}

export function sendMessageStop(controller: ReadableStreamDefaultController): void {
    const event = sse('message_stop', {
        type: 'message_stop'
    })
    controller.enqueue(encoder.encode(event))
}

export function startTextBlock(index: number): string {
    return sse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: {
            type: 'text',
            text: ''
        }
    })
}

export function textDelta(text: string, index: number): string {
    return sse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: {
            type: 'text_delta',
            text
        }
    })
}

export function stopContentBlock(index: number): string {
    return sse('content_block_stop', {
        type: 'content_block_stop',
        index
    })
}

export function processTextPart(text: string, index: number): string[] {
    const events: string[] = []

    events.push(startTextBlock(index))
    events.push(textDelta(text, index))
    events.push(stopContentBlock(index))

    return events
}

export function processToolUsePart(functionCall: { name: string; args: any }, index: number): string[] {
    const events: string[] = []
    const toolUseId = generateId()

    events.push(
        sse('content_block_start', {
            type: 'content_block_start',
            index,
            content_block: {
                type: 'tool_use',
                id: toolUseId,
                name: functionCall.name,
                input: {}
            }
        })
    )

    events.push(
        sse('content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: {
                type: 'input_json_delta',
                partial_json: JSON.stringify(functionCall.args)
            }
        })
    )

    events.push(stopContentBlock(index))

    return events
}

export function buildUrl(baseUrl: string, endpoint: string): string {
    let finalUrl = baseUrl
    if (!finalUrl.endsWith('/')) {
        finalUrl += '/'
    }
    return finalUrl + endpoint
}

export async function processProviderStream(
    providerResponse: Response,
    processLine: (
        jsonStr: string,
        textIndex: number,
        toolIndex: number
    ) => { events: string[]; textBlockIndex: number; toolUseBlockIndex: number; stopReason?: string } | null
): Promise<Response> {
    const stream = new ReadableStream({
        async start(controller) {
            const reader = providerResponse.body?.getReader()
            if (!reader) {
                controller.close()
                return
            }

            const decoder = new TextDecoder()
            let buffer = ''
            let textBlockIndex = 0
            let toolUseBlockIndex = 0
            let stopReason = 'end_turn'

            sendMessageStart(controller)

            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    const chunk = buffer + decoder.decode(value, { stream: true })
                    const lines = chunk.split('\n')

                    buffer = lines.pop() || ''

                    for (const line of lines) {
                        if (!line.trim() || !line.startsWith('data: ')) continue

                        const jsonStr = line.slice(6)
                        if (jsonStr === '[DONE]') continue

                        const result = processLine(jsonStr, textBlockIndex, toolUseBlockIndex)
                        if (result) {
                            textBlockIndex = result.textBlockIndex
                            toolUseBlockIndex = result.toolUseBlockIndex
                            stopReason = result.stopReason ?? stopReason

                            for (const event of result.events) {
                                controller.enqueue(encoder.encode(event))
                            }
                        }
                    }
                }
            } finally {
                if (buffer.trim() && buffer.startsWith('data: ')) {
                    const result = processLine(buffer.slice(6), textBlockIndex, toolUseBlockIndex)
                    if (result) {
                        stopReason = result.stopReason ?? stopReason
                        for (const event of result.events) {
                            controller.enqueue(encoder.encode(event))
                        }
                    }
                }
                reader.releaseLock()
                sendMessageDelta(controller, stopReason)
                sendMessageStop(controller)
                controller.close()
            }
        }
    })

    return new Response(stream, {
        status: providerResponse.status,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
        }
    })
}

export function cleanJsonSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') {
        return schema
    }

    const cleaned = { ...schema }

    for (const key in cleaned) {
        if (key === '$schema' || key === 'additionalProperties' || key === 'title' || key === 'examples') {
            delete cleaned[key]
        } else if (key === 'enum' && Array.isArray(cleaned[key])) {
            cleaned[key] = cleaned[key]
        } else if (key === 'format' && cleaned.type === 'string') {
            delete cleaned[key]
        } else if (key === 'properties' && typeof cleaned[key] === 'object') {
            cleaned[key] = cleanJsonSchema(cleaned[key])
        } else if (key === 'items' && typeof cleaned[key] === 'object') {
            cleaned[key] = cleanJsonSchema(cleaned[key])
        } else if (typeof cleaned[key] === 'object' && !Array.isArray(cleaned[key])) {
            cleaned[key] = cleanJsonSchema(cleaned[key])
        }
    }

    return cleaned
}
