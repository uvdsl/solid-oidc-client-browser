import { normalizeSessionName, storageKey, databaseName, SESSION_NAME_PATTERN } from '../../src/core/SessionName';

describe('normalizeSessionName', () => {
    it('returns undefined for undefined (the default session)', () => {
        expect(normalizeSessionName(undefined)).toBeUndefined();
    });

    it('returns undefined for the empty string, so an empty name cannot fork the storage namespace', () => {
        expect(normalizeSessionName('')).toBeUndefined();
    });

    it('returns a valid name unchanged', () => {
        expect(normalizeSessionName('left')).toBe('left');
        expect(normalizeSessionName('my-App_2')).toBe('my-App_2');
    });

    it('throws on a name outside the allowed charset', () => {
        expect(() => normalizeSessionName('left:idp')).toThrow(TypeError);
        expect(() => normalizeSessionName('a b')).toThrow(TypeError);
        expect(() => normalizeSessionName('soidc:x')).toThrow(TypeError);
        expect(() => normalizeSessionName('über')).toThrow(TypeError);
    });

    it('exposes the pattern names are validated against', () => {
        expect(SESSION_NAME_PATTERN.test('ok-name')).toBe(true);
        expect(SESSION_NAME_PATTERN.test('not ok')).toBe(false);
    });
});

describe('storageKey', () => {
    it('keeps the bare key for the default session - byte-identical to previous releases', () => {
        expect(storageKey(undefined, 'csrf_token')).toBe('csrf_token');
        expect(storageKey(undefined, 'idp')).toBe('idp');
    });

    it('prefixes the key for a named session', () => {
        expect(storageKey('left', 'csrf_token')).toBe('left:csrf_token');
    });

    it('cannot collide across names: every key ends in a fixed suffix', () => {
        // 'left' storing 'idp' vs a hypothetical name 'left:idp' is already
        // rejected by normalizeSessionName; with valid names, prefixed keys
        // of distinct names are always distinct.
        expect(storageKey('left', 'idp')).not.toBe(storageKey('right', 'idp'));
        expect(storageKey('left', 'idp')).not.toBe(storageKey(undefined, 'idp'));
    });
});

describe('databaseName', () => {
    it('keeps the default database for the default session - existing persisted sessions survive', () => {
        expect(databaseName(undefined)).toBe('soidc');
    });

    it('gives a named session its own database', () => {
        expect(databaseName('left')).toBe('soidc:left');
        expect(databaseName('right')).toBe('soidc:right');
    });
});
