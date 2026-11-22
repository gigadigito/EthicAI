import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBrowserlessArgs, parseMatchId } from './capture-browserless-options.mjs';

test('accepts historical Arena Pressure match IDs 46156 and 46324', () => {
    assert.equal(parseMatchId('46156'), 46156);
    assert.equal(parseMatchId('46324'), 46324);
});

test('rejects missing, non-positive, non-integer and injectable match IDs', () => {
    for (const value of [undefined, '', '0', '-1', '1.5', '1e3', '46324/match', 'https://example.test']) {
        assert.throws(() => parseMatchId(value), /positive safe integer/);
    }
    assert.throws(() => parseMatchId(String(Number.MAX_SAFE_INTEGER + 1)), /positive safe integer/);
});

test('rejects unexpected, repeated and malformed CLI parameters', () => {
    assert.throws(() => parseBrowserlessArgs(['--match-id', '46324', '--url', 'https://attacker.test']), /unsupported/);
    assert.throws(() => parseBrowserlessArgs(['--match-id', '46324', '--match-id', '46156']), /repeated/);
    assert.throws(() => parseBrowserlessArgs(['match-id', '46324']), /Invalid/);
    assert.throws(() => parseBrowserlessArgs(['--match-id']), /pairs/);
});

test('keeps the match ID as a scalar CLI value', () => {
    const args = parseBrowserlessArgs(['--match-id', '46324', '--culture', 'en']);
    assert.deepEqual(args, { 'match-id': '46324', culture: 'en' });
});
