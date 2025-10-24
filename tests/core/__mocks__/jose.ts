// Mock the SignJWT class to have a chainable interface, which is common for builders.
export const SignJWT = jest.fn().mockImplementation(() => ({
  setIssuedAt: jest.fn().mockReturnThis(),
  setJti: jest.fn().mockReturnThis(),
  setProtectedHeader: jest.fn().mockReturnThis(),
  sign: jest.fn().mockResolvedValue('mocked.dpop.token'),
}));

// Mock the other functions from 'jose' that your code uses.
export const generateKeyPair = jest.fn().mockResolvedValue({
  publicKey: 'mockPublicKey',
  privateKey: 'mockPrivateKey',
});

export const decodeJwt = jest.fn();
export const jwtVerify = jest.fn();
export const calculateJwkThumbprint = jest.fn();
export const createRemoteJWKSet = jest.fn();

export const exportJWK = jest.fn().mockImplementation(() => Promise.resolve({
    kty: 'EC',
    crv: 'P-256',
    x: 'mock-x',
    y: 'mock-y',
}));





