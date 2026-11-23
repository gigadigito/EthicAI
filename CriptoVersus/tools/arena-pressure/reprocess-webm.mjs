import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finiteNumber, processWebmToMp4, runCommand } from './capture-media.mjs';

const DEFAULTS = {
    width: 1280,
    height: 720,
    fps: 30,
    duration: 10,
    tolerance: 2,
    threads: 2
};

const VALUE_OPTIONS = new Set([
    'input', 'output', 'duration', 'tolerance', 'width', 'height', 'fps', 'threads'
]);

function usageText() {
    return [
        'Usage: node tools/arena-pressure/reprocess-webm.mjs --input <webm-path> [options]',
        '   or: node tools/arena-pressure/reprocess-webm.mjs <webm-path> [options]',
        '',
        'Options:',
        '  --input <path>        Path to an existing .webm or .failed.webm file (never modified)',
        '  --output <path>       Target .mp4 path (default: replace .failed.webm/.webm with .mp4; never overwrites)',
        '  --duration <sec|auto> Expected duration in seconds, or "auto" (default: 10)',
        '  --tolerance <sec>     Allowed duration tolerance in seconds (default: 2)',
        '  --width <px>          Expected/output video width (default: 1280)',
        '  --height <px>         Expected/output video height (default: 720)',
        '  --fps <rate>          Output constant frame rate (default: 30)',
        '  --threads <count>     FFmpeg libx264 thread limit (default: 2)',
        '  -h, --help            Show this usage message'
    ].join('\n');
}

export function defaultOutputPath(inputPath) {
    const resolved = resolve(inputPath);
    const directory = dirname(resolved);
    const file = basename(resolved);
    let stem;
    if (/\.failed\.webm$/i.test(file)) {
        stem = file.replace(/\.failed\.webm$/i, '');
    } else if (/\.webm$/i.test(file)) {
        stem = file.replace(/\.webm$/i, '');
    } else {
        stem = file;
    }
    return resolve(directory, `${stem || file}.mp4`);
}

function parsePositiveInt(name, raw) {
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
        throw new Error(`--${name} must be a positive integer.`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`--${name} must be a positive integer.`);
    }
    return value;
}

function parseDurationOption(raw) {
    if (raw === undefined) return DEFAULTS.duration;
    if (String(raw).toLowerCase() === 'auto') return null;
    const value = finiteNumber(raw);
    if (value === null || value <= 0) {
        throw new Error('--duration must be a positive number or "auto".');
    }
    return value;
}

function parseToleranceOption(raw) {
    if (raw === undefined) return DEFAULTS.tolerance;
    const value = finiteNumber(raw);
    if (value === null || value < 0) {
        throw new Error('--tolerance must be a non-negative number.');
    }
    return value;
}

export function parseReprocessArgs(argv) {
    const raw = {};
    let positionalInput = null;
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--help' || token === '-h') {
            return { help: true };
        }
        if (token.startsWith('--')) {
            const name = token.slice(2);
            if (!VALUE_OPTIONS.has(name)) {
                throw new Error(`Unsupported option: ${token}`);
            }
            if (raw[name] !== undefined) {
                throw new Error(`Repeated option: ${token}`);
            }
            const value = argv[index + 1];
            if (value === undefined || value === '' || value.startsWith('--')) {
                throw new Error(`Missing value for option: ${token}`);
            }
            raw[name] = value;
            index++;
            continue;
        }
        if (token.startsWith('-')) {
            throw new Error(`Unsupported option: ${token}`);
        }
        if (positionalInput !== null) {
            throw new Error(`Unexpected extra positional argument: ${token}`);
        }
        positionalInput = token;
    }

    if (raw.input && positionalInput) {
        throw new Error('Specify either --input <path> or a single positional <path>, not both.');
    }
    const input = raw.input ?? positionalInput;
    if (!input) {
        throw new Error('An input WebM file path is required.');
    }

    const inputPath = resolve(input);
    const outputPath = raw.output ? resolve(raw.output) : defaultOutputPath(inputPath);
    if (outputPath === inputPath) {
        throw new Error('Output MP4 path must differ from input WebM path.');
    }

    return {
        help: false,
        inputPath,
        outputPath,
        expectedDuration: parseDurationOption(raw.duration),
        toleranceSeconds: parseToleranceOption(raw.tolerance),
        width: raw.width !== undefined ? parsePositiveInt('width', raw.width) : DEFAULTS.width,
        height: raw.height !== undefined ? parsePositiveInt('height', raw.height) : DEFAULTS.height,
        fps: raw.fps !== undefined ? parsePositiveInt('fps', raw.fps) : DEFAULTS.fps,
        threads: raw.threads !== undefined ? parsePositiveInt('threads', raw.threads) : DEFAULTS.threads
    };
}

function isDirectExecution() {
    if (!process.argv[1]) return false;
    const entry = resolve(process.argv[1]);
    const self = fileURLToPath(import.meta.url);
    return process.platform === 'win32'
        ? entry.toLowerCase() === self.toLowerCase()
        : entry === self;
}

async function main() {
    let options;
    try {
        options = parseReprocessArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        console.error(usageText());
        process.exit(2);
    }

    if (options.help) {
        console.log(usageText());
        process.exit(0);
    }

    const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
    const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
    const log = message => {
        console.log(`${new Date().toISOString()} ${message}`);
    };

    try {
        await runCommand(ffmpeg, ['-version']);
        await runCommand(ffprobe, ['-version']);

        const mp4PartialPath = `${options.outputPath}.partial`;
        const result = await processWebmToMp4({
            inputPath: options.inputPath,
            outputPath: options.outputPath,
            mp4PartialPath,
            width: options.width,
            height: options.height,
            fps: options.fps,
            expectedDuration: options.expectedDuration,
            toleranceSeconds: options.toleranceSeconds,
            threads: options.threads,
            ffmpeg,
            ffprobe,
            run: runCommand,
            log
        });

        log(
            `Reprocessed ${result.webmValidation.frameCount} ` +
            `${String(result.webmValidation.stream?.codec_name ?? 'video').toUpperCase()} frames ` +
            `(${result.webmBytes} bytes -> ${result.mp4Bytes} bytes) in ` +
            `${result.conversionDurationSeconds.toFixed(2)}s: ${result.outputPath}`
        );
    } catch (error) {
        console.error(error?.message ?? String(error));
        process.exit(1);
    }
}

if (isDirectExecution()) {
    await main();
}
