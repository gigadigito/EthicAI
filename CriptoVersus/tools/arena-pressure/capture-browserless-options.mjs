const ALLOWED_ARGUMENTS = new Set([
    'match-id', 'base-url', 'culture', 'duration', 'speed',
    'width', 'height', 'output'
]);

export function parseBrowserlessArgs(values) {
    if (values.length % 2 !== 0) {
        throw new Error('Arguments must be --name value pairs.');
    }

    const parsed = {};
    for (let index = 0; index < values.length; index += 2) {
        const token = values[index];
        const value = values[index + 1];
        const name = token?.startsWith('--') ? token.slice(2) : '';
        if (!ALLOWED_ARGUMENTS.has(name) || !value || parsed[name] !== undefined) {
            throw new Error(`Invalid, repeated or unsupported argument: ${token ?? ''}`);
        }
        parsed[name] = value;
    }
    return parsed;
}

export function parseMatchId(value) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
        throw new Error('--match-id must be a positive safe integer.');
    }
    const matchId = Number(value);
    if (!Number.isSafeInteger(matchId)) {
        throw new Error('--match-id must be a positive safe integer.');
    }
    return matchId;
}
