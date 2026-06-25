export const MODEL_ALIASES: Record<string, string> = {
    'Claude Opus': 'deepseek-ai/deepseek-v4-pro',
    'Claude Sonnet': 'deepseek-ai/deepseek-v4-flash',
    'Claude Haiku': 'moonshotai/kimi-k2.6'
}

export function normalizeModelName(model: string): string {
    const lowercase = model.toLowerCase();
    if (lowercase.includes('opus')) {
        return 'Claude Opus';
    }
    if (lowercase.includes('sonnet')) {
        return 'Claude Sonnet';
    }
    if (lowercase.includes('haiku')) {
        return 'Claude Haiku';
    }
    return 'Claude Sonnet'; // Fallback
}

export function resolveModel(model: string, isDev: boolean = false): string {
    const normalizedName = normalizeModelName(model);
    const resolvedModel = MODEL_ALIASES[normalizedName] || MODEL_ALIASES['Claude Sonnet'];

    if (isDev) {
        console.log(`Incoming:\n${model}\n\nResolved:\n${normalizedName}\n\nForwarded:\n${resolvedModel}`);
    }

    return resolvedModel;
}
