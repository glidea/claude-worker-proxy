export interface Provider {
    handle?(request: Request, baseUrl: string, apiKey: string): Promise<Response>
    convertToProviderRequest(request: Request, baseUrl: string, apiKey: string): Promise<Request>
    convertToClaudeResponse(providerResponse: Response): Promise<Response>
}
