import * as types from './types'
import * as provider from './provider'
import * as utils from './utils'

export class impl implements provider.Provider {
    async convertToProviderRequest(request: Request, baseUrl: string, apiKey: string): Promise<Request> {
        const claudeRequest = (await request.json()) as types.ClaudeRequest
        const geminiRequest = this.convertToGeminiRequestBody(claudeRequest)

        const endpoint = `models/${claudeRequest.model}:${claudeRequest.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`
        const finalUrl = utils.buildUrl(baseUrl, endpoint)

        const headers = new Headers(request.headers)
        headers.set('x-goog-api-key', apiKey)
        headers.set('Content-Type', 'application/json')

        return new Request(finalUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(geminiRequest)
        })
    }

    async convertToClaudeResponse(geminiResponse: Response): Promise<Response> {
        if (!geminiResponse.ok) {
            return geminiResponse
        }

        const contentType = geminiResponse.headers.get('content-type') || ''
        const isStream = contentType.includes('text/event-stream')

        if (isStream) {
            return this.convertStreamResponse(geminiResponse)
        } else {
            return this.convertNormalResponse(geminiResponse)
        }
    }

    private convertToGeminiRequestBody(claudeRequest: types.ClaudeRequest): types.GeminiRequest {
        const toolUseMap = this.buildToolUseMap(claudeRequest.messages)
        const contents = this.convertMessages(claudeRequest.messages, toolUseMap)
        const systemInstruction = this.convertSystemInstruction(claudeRequest.system)

        const geminiRequest: types.GeminiRequest = {
            model: claudeRequest.model,
            contents
        }

        if (systemInstruction) {
            geminiRequest.systemInstruction = systemInstruction
        }

        if (claudeRequest.tools && claudeRequest.tools.length > 0) {
            geminiRequest.tools = [
                {
                    functionDeclarations: claudeRequest.tools.map(tool => ({
                        name: tool.name,
                        description: tool.description,
                        parameters: utils.cleanJsonSchema(tool.input_schema)
                    }))
                }
            ]
        }

        if (claudeRequest.temperature !== undefined || claudeRequest.max_tokens !== undefined) {
            geminiRequest.generationConfig = {}
            if (claudeRequest.temperature !== undefined) {
                geminiRequest.generationConfig.temperature = claudeRequest.temperature
            }
            if (claudeRequest.max_tokens !== undefined) {
                geminiRequest.generationConfig.maxOutputTokens = claudeRequest.max_tokens
            }
        }

        return geminiRequest
    }

    private convertSystemInstruction(system: types.ClaudeRequest['system']): types.GeminiContent | undefined {
        if (!system) return undefined
        const text =
            typeof system === 'string'
                ? system
                : system
                      .filter(part => part.type === 'text')
                      .map(part => part.text)
                      .join('\n')

        if (!text) return undefined
        return {
            parts: [{ text }]
        }
    }

    private buildToolUseMap(messages: types.ClaudeMessage[]): Map<string, string> {
        const toolUseMap = new Map<string, string>()

        for (const message of messages) {
            if (typeof message.content === 'string') continue

            for (const content of message.content) {
                if (content.type === 'tool_use') {
                    toolUseMap.set(content.id, content.name)
                }
            }
        }

        return toolUseMap
    }

    private convertMessages(messages: types.ClaudeMessage[], toolUseMap: Map<string, string>): types.GeminiContent[] {
        const contents: types.GeminiContent[] = []

        for (const message of messages) {
            if (typeof message.content === 'string') {
                contents.push({
                    parts: [{ text: message.content }],
                    role: message.role === 'assistant' ? 'model' : 'user'
                })
                continue
            }

            const textParts: types.GeminiPart[] = []
            const toolUseParts: types.GeminiPart[] = []
            const toolResultParts: types.GeminiPart[] = []

            for (const content of message.content) {
                switch (content.type) {
                    case 'text':
                        textParts.push({ text: content.text })
                        break
                    case 'tool_use':
                        toolUseParts.push({
                            functionCall: {
                                name: content.name,
                                args: content.input
                            }
                        })
                        break
                    case 'tool_result':
                        const functionName = toolUseMap.get(content.tool_use_id)
                        if (functionName) {
                            toolResultParts.push({
                                functionResponse: {
                                    name: functionName,
                                    response: { content: content.content }
                                }
                            })
                        }
                        break
                }
            }

            if (textParts.length > 0 || toolUseParts.length > 0) {
                contents.push({
                    parts: [...textParts, ...toolUseParts],
                    role: message.role === 'assistant' ? 'model' : 'user'
                })
            }

            if (toolResultParts.length > 0) {
                contents.push({
                    parts: toolResultParts,
                    role: 'tool'
                })
            }
        }

        return contents
    }

    private async convertNormalResponse(geminiResponse: Response): Promise<Response> {
        const geminiData = (await geminiResponse.json()) as types.GeminiResponse

        const claudeResponse: types.ClaudeResponse = {
            id: utils.generateId(),
            type: 'message',
            role: 'assistant',
            content: [],
            usage: {
                input_tokens: 0,
                output_tokens: 0
            }
        }

        if (geminiData.candidates && geminiData.candidates.length > 0) {
            const candidate = geminiData.candidates[0]
            let hasToolUse = false

            for (const part of candidate.content.parts) {
                if ('text' in part) {
                    claudeResponse.content.push({
                        type: 'text',
                        text: part.text
                    })
                } else if ('functionCall' in part) {
                    hasToolUse = true
                    claudeResponse.content.push({
                        type: 'tool_use',
                        id: utils.generateId(),
                        name: part.functionCall.name,
                        input: part.functionCall.args
                    })
                }
            }

            if (hasToolUse) {
                claudeResponse.stop_reason = 'tool_use'
            } else if (candidate.finishReason === 'MAX_TOKENS') {
                claudeResponse.stop_reason = 'max_tokens'
            } else {
                claudeResponse.stop_reason = 'end_turn'
            }
        }

        if (geminiData.usageMetadata) {
            claudeResponse.usage = {
                input_tokens: geminiData.usageMetadata.promptTokenCount,
                output_tokens: geminiData.usageMetadata.candidatesTokenCount
            }
        }

        return new Response(JSON.stringify(claudeResponse), {
            status: geminiResponse.status,
            headers: {
                'Content-Type': 'application/json'
            }
        })
    }

    private async convertStreamResponse(geminiResponse: Response): Promise<Response> {
        let textBlockOpen = false

        return utils.processProviderStream(geminiResponse, (jsonStr, textBlockIndex, toolUseBlockIndex) => {
            const geminiData = JSON.parse(jsonStr) as types.GeminiResponse
            if (!geminiData.candidates || geminiData.candidates.length === 0) {
                return null
            }

            const candidate = geminiData.candidates[0]
            const events: string[] = []
            let currentTextIndex = textBlockIndex
            let currentToolIndex = toolUseBlockIndex
            let stopReason: types.ClaudeStopReason | undefined

            if (candidate.content) {
                for (const part of candidate.content.parts) {
                    if ('text' in part && part.text) {
                        if (!textBlockOpen) {
                            events.push(utils.startTextBlock(currentTextIndex))
                            textBlockOpen = true
                        }
                        events.push(utils.textDelta(part.text, currentTextIndex))
                    } else if ('functionCall' in part) {
                        if (textBlockOpen) {
                            events.push(utils.stopContentBlock(currentTextIndex))
                            currentTextIndex++
                            textBlockOpen = false
                        }
                        events.push(
                            ...utils.processToolUsePart(
                                { name: part.functionCall.name, args: part.functionCall.args ?? {} },
                                currentToolIndex
                            )
                        )
                        currentToolIndex++
                    }
                }
            }

            if (candidate.finishReason) {
                if (textBlockOpen) {
                    events.push(utils.stopContentBlock(currentTextIndex))
                    currentTextIndex++
                    textBlockOpen = false
                }
                stopReason = candidate.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn'
            }

            return {
                events,
                textBlockIndex: currentTextIndex,
                toolUseBlockIndex: currentToolIndex,
                stopReason
            }
        })
    }
}
