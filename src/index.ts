import * as provider from './provider'
import * as gemini from './gemini'
import * as openai from './openai'

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        try {
            return await handle(request)
        } catch (error) {
            console.error(error)
            return new Response('Internal server error', { status: 500 })
        }
    }
} satisfies ExportedHandler<Env>

async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 })
    }

    const { typeParam, baseUrl, err: pathErr } = parsePath(new URL(request.url))
    if (pathErr) {
        return pathErr
    }

    const { apiKey, mutatedHeaders, err: apiKeyErr } = getApiKey(request.headers)
    if (apiKeyErr) {
        return apiKeyErr
    }

    if (!apiKey || !typeParam || !baseUrl) {
        return new Response('Internal server error, missing params', { status: 500 })
    }

    let provider: provider.Provider
    switch (typeParam) {
        case 'gemini':
            provider = new gemini.impl()
            break
        case 'openai':
            provider = new openai.ChatCompletionsProvider()
            break
        case 'openai-responses':
        case 'responses':
            provider = new openai.ResponsesProvider()
            break
        default:
            return new Response('Unsupported type', { status: 400 })
    }

    const inboundRequest = new Request(request, { headers: mutatedHeaders })
    if (provider.handle) {
        return await provider.handle(inboundRequest, baseUrl, apiKey)
    }

    const providerRequest = await provider.convertToProviderRequest(inboundRequest, baseUrl, apiKey)
    const providerResponse = await fetch(providerRequest)
    return await provider.convertToClaudeResponse(providerResponse)
}

function parsePath(url: URL): { typeParam?: string; baseUrl?: string; err?: Response } {
    const pathname = url.pathname.replace(/^\/+|\/+$/g, '')
    const pathParts = pathname.split('/').filter(part => part !== '')
    if (pathParts.length < 3) {
        return {
            err: new Response('Invalid path format. Expected: /{type}/{provider_url}/v1/messages', { status: 400 })
        }
    }
    const lastTwoParts = pathParts.slice(-2)
    if (lastTwoParts[0] !== 'v1' || lastTwoParts[1] !== 'messages') {
        return { err: new Response('Path must end with /v1/messages', { status: 404 }) }
    }

    const typeParam = pathParts[0]
    const providerPath = pathParts.slice(1, -2).join('/')
    const baseUrl = providerPath.replace(/^(https?):\/(?!\/)/, '$1://')
    if (!typeParam || !baseUrl) {
        return { err: new Response('Missing type or provider_url in path', { status: 400 }) }
    }

    return { typeParam, baseUrl }
}

function getApiKey(headers: Headers): { apiKey?: string; mutatedHeaders?: Headers; err?: Response } {
    const mutatedHeaders = new Headers(headers)
    let apiKey = headers.get('x-api-key')
    if (apiKey) {
        mutatedHeaders.delete('x-api-key')
    } else {
        apiKey = mutatedHeaders.get('authorization')
        if (apiKey) {
            mutatedHeaders.delete('authorization')
        }
    }

    if (!apiKey) {
        return { err: new Response('Missing x-api-key or authorization header', { status: 401 }) }
    }

    return { apiKey, mutatedHeaders }
}
