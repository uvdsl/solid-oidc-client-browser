import { TextEncoder, TextDecoder } from 'util';
// Import whatwg-fetch to polyfill fetch and related globals (Request, Response, Headers)
import 'whatwg-fetch';

// Import the mocked jose functions to reset them
// Adjust the path according to your actual __mocks__ location relative to root
import * as jose from './tests/core/__mocks__/jose';

// --- Environment Sanity Checks & Polyfills ---

// Ensure global.self exists for environments like Node + jsdom hybrid
if (typeof global.self === 'undefined') {
  (global as any).self = global;
}

// JSDOM doesn't include TextEncoder/TextDecoder by default
Object.defineProperty(global, 'TextEncoder', { value: TextEncoder });
Object.defineProperty(global, 'TextDecoder', { value: TextDecoder });

// JSDOM's crypto.subtle is missing or incomplete
Object.defineProperty(global.self, 'crypto', {
  value: {
    ...global.self.crypto, // Keep existing crypto parts if any
    subtle: {
      digest: jest.fn().mockResolvedValue(new ArrayBuffer(8)), // Mock digest for PKCE/ath
      // Add other subtle methods if needed by jose mocks or your code
    },
    randomUUID: jest.fn().mockReturnValue('mock-random-uuid'), // Mock randomUUID
  },
  writable: true // Ensure it can be modified if needed elsewhere
});

// Sanity check: Ensure fetch polyfill provided necessary globals
if (typeof Request === 'undefined' || typeof Response === 'undefined' || typeof Headers === 'undefined') {
    console.error('whatwg-fetch polyfill failed to attach Request, Response, or Headers to the global scope.');
    // Depending on strictness, you might throw an error here:
    // throw new Error('Fetch polyfill failed: Request, Response, or Headers not available globally.');
}


// --- Mock sessionStorage ---
const sessionStorageMock = (() => {
  let store: { [key: string]: string } = {};
  return {
    // Make methods jest.fn() so they can be spied on/asserted
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

// --- Mock window.location ---
// We delete and redefine location to make it writable for tests
const originalLocation = window.location;
delete (window as any).location;
Object.defineProperty(window, 'location', {
    writable: true,
    value: {
        ...originalLocation, // Spread existing properties like origin, pathname etc.
        href: '', // Start with empty href
        assign: jest.fn(),
        replace: jest.fn()
        // Add other methods/properties if your code uses them
    }
});


// --- Mock history ---
Object.defineProperty(window, 'history', {
    writable: true,
    value: {
        pushState: jest.fn(),
        replaceState: jest.fn()
        // Add other history methods if needed
    }
});

// Mock global fetch (already polyfilled, but we mock it for control)
// Default mock implementation
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200, // Added status
    json: () => Promise.resolve({}),
  })
) as jest.Mock;


// --- Global Test Hooks ---

beforeEach(() => {
  // Reset sessionStorage mock calls and clear its store
  sessionStorageMock.clear(); // Clears the internal store
  sessionStorageMock.getItem.mockClear();
  sessionStorageMock.setItem.mockClear();
  sessionStorageMock.removeItem.mockClear();

  // Reset history mock calls
  (window.history.pushState as jest.Mock).mockClear();
  (window.history.replaceState as jest.Mock).mockClear();

  // Reset fetch mock calls
  (fetch as jest.Mock).mockClear();
  // Apply a default successful mock implementation for fetch
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200, // Consistent default status
    json: () => Promise.resolve({}),
  });


  // Reset location href (if modified in a test) and assign/replace mocks
  window.location.href = '';
  (window.location.assign as jest.Mock).mockClear();
  (window.location.replace as jest.Mock).mockClear();


  // --- Reset Jose Mocks ---
  // Ensure the manual jose mocks are reset before each test
  (jose.SignJWT as jest.Mock).mockClear();
  // Reset the mock implementation's internal mocks too if necessary
   try {
    const signJwtInstance = (jose.SignJWT() as any); // Get an instance of the mock implementation
    if (signJwtInstance?.setIssuedAt?.mockClear) signJwtInstance.setIssuedAt.mockClear();
    if (signJwtInstance?.setJti?.mockClear) signJwtInstance.setJti.mockClear();
    if (signJwtInstance?.setProtectedHeader?.mockClear) signJwtInstance.setProtectedHeader.mockClear();
    if (signJwtInstance?.sign?.mockClear) signJwtInstance.sign.mockClear();
  } catch (e) {
      // Ignore if SignJWT() fails during reset (might happen if mock setup changes)
      console.warn("Could not reset SignJWT internal mocks during test setup.");
  }


  (jose.generateKeyPair as jest.Mock).mockClear();
  (jose.jwtVerify as jest.Mock).mockClear();
  (jose.calculateJwkThumbprint as jest.Mock).mockClear();
  (jose.exportJWK as jest.Mock).mockClear();
  (jose.createRemoteJWKSet as jest.Mock).mockClear();
  (jose.decodeJwt as jest.Mock).mockClear();

   // Re-apply default mock implementations for jose functions used across tests
   // Ensure these defaults match what's needed for most tests or configure in specific tests
   (jose.decodeJwt as jest.Mock).mockReturnValue({ webid: 'https://alice.example/card#me' });
   (jose.exportJWK as jest.Mock).mockImplementation(() => Promise.resolve({ kty: 'EC', crv: 'P-256', x: 'mock-x', y: 'mock-y'}));
   // Mocking calculateJwkThumbprint as a stand-in for _computeAth dependency
   (jose.calculateJwkThumbprint as jest.Mock).mockResolvedValue('mock-ath');

});
