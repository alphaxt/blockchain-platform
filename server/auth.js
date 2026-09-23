/*
 * CryptoHub - Wallet-based authentication (Sign-In With Ethereum style)
 * ------------------------------------------------------------------
 * Dependency-light auth that proves a user controls an Ethereum address:
 *
 *   1. GET  /api/auth/nonce?address=0x..   -> server returns a random nonce
 *   2. Client signs the login message (personal_sign) with that nonce
 *   3. POST /api/auth/verify {address, signature}
 *        -> server recovers the signer from the signature and, if it
 *           matches the claimed address, issues a signed session token
 *   4. Protected routes send `Authorization: Bearer <token>`; the token
 *        is an HMAC-signed payload carrying the address + expiry.
 *
 * Signature recovery uses the audited @noble/curves (secp256k1) and
 * @noble/hashes (keccak256) — no heavyweight web3 SDK required. Session
 * tokens are HMAC-SHA256 signed with a server secret (no JWT library).
 */
'use strict';

const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1');
const { keccak_256 } = require('@noble/hashes/sha3');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const NONCE_TTL_MS = 10 * 60 * 1000;      // 10m to complete the sign-in

// Secret for signing session tokens. Prefer the AUTH_SECRET env var; a
// durable secret can also be injected via configure() (persisted in the DB
// so tokens survive restarts). Falls back to an ephemeral per-process value.
let secret = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

// Default in-memory nonce store (address -> { nonce, expires }). It can be
// swapped for a persistent store (e.g. SQLite) via configure(), so sign-in
// survives restarts and works across multiple server instances.
const memNonces = new Map();
let nonceStore = {
  put(addr, nonce, expires) { memNonces.set(addr, { nonce, expires }); },
  get(addr) { return memNonces.get(addr) || null; },
  remove(addr) { memNonces.delete(addr); },
  cleanup(now) { for (const [k, v] of memNonces) if (v.expires < now) memNonces.delete(k); }
};

/**
 * Inject a persistent backend. Called once at startup by the server.
 * @param {object} [opts]
 * @param {object} [opts.nonceStore] { put(addr,nonce,expires), get(addr)->{nonce,expires}|null, remove(addr), cleanup(now) }
 * @param {string} [opts.secret] durable token-signing secret
 */
function configure(opts = {}) {
  if (opts.nonceStore) nonceStore = opts.nonceStore;
  if (opts.secret) secret = opts.secret;
}

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function isAddress(a) {
  return typeof a === 'string' && ADDR_RE.test(a);
}

function addressFromPublicKey(pubUncompressed) {
  // pubUncompressed: 65 bytes (0x04 || X || Y). Drop prefix, keccak256, last 20 bytes.
  const hash = keccak_256(pubUncompressed.slice(1));
  return '0x' + Buffer.from(hash.slice(-20)).toString('hex');
}

// EIP-191 personal_sign digest: keccak256("\x19Ethereum Signed Message:\n" + len + message)
function personalHash(message) {
  const msg = Buffer.from(message, 'utf8');
  const prefix = Buffer.from('\x19Ethereum Signed Message:\n' + msg.length, 'utf8');
  return keccak_256(Buffer.concat([prefix, msg]));
}

/** The exact message the client is asked to sign for a given nonce. */
function loginMessage(nonce) {
  return `CryptoHub wants you to sign in.\n\nThis request will not trigger a blockchain transaction or cost gas.\n\nNonce: ${nonce}`;
}

/** Issue (and store) a fresh nonce for an address. */
function issueNonce(address) {
  if (!isAddress(address)) throw new Error('Invalid address');
  const addr = address.toLowerCase();
  const nonce = crypto.randomBytes(16).toString('hex');
  try { nonceStore.cleanup(Date.now()); } catch (e) { /* optional */ }
  nonceStore.put(addr, nonce, Date.now() + NONCE_TTL_MS);
  return { nonce, message: loginMessage(nonce) };
}

/**
 * Recover the Ethereum address that produced `signature` over `message`.
 * @param {string} message the plain-text message that was signed
 * @param {string} signature 65-byte hex signature (r||s||v), 0x-prefixed
 * @returns {string} recovered address (lowercased) or throws
 */
function recoverAddress(message, signature) {
  const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
  const bytes = Buffer.from(sig, 'hex');
  if (bytes.length !== 65) throw new Error('Signature must be 65 bytes');
  const r = BigInt('0x' + bytes.slice(0, 32).toString('hex'));
  const s = BigInt('0x' + bytes.slice(32, 64).toString('hex'));
  let v = bytes[64];
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error('Invalid recovery id');
  const digest = personalHash(message);
  const recovered = new secp256k1.Signature(r, s).addRecoveryBit(v)
    .recoverPublicKey(digest).toRawBytes(false);
  return addressFromPublicKey(recovered).toLowerCase();
}

/**
 * Verify a sign-in: the signature must be over the message tied to the
 * address's outstanding nonce, and must recover to that same address.
 * On success the nonce is consumed and a session token returned.
 * @returns {{address:string, token:string, expires:number}}
 */
function verifySignature(address, signature) {
  if (!isAddress(address)) throw new Error('Invalid address');
  if (typeof signature !== 'string') throw new Error('Missing signature');
  const addr = address.toLowerCase();
  const record = nonceStore.get(addr);
  if (!record) throw new Error('No nonce issued for this address — request one first');
  if (Date.now() > record.expires) { nonceStore.remove(addr); throw new Error('Nonce expired — request a new one'); }

  const recovered = recoverAddress(loginMessage(record.nonce), signature);
  if (recovered !== addr) throw new Error('Signature does not match address');

  nonceStore.remove(addr); // one-time use
  return issueToken(addr);
}

// --- Session tokens: base64url(payload).hmac ------------------------
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function sign(payloadB64) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function issueToken(address) {
  const expires = Date.now() + TOKEN_TTL_MS;
  const payload = b64url(JSON.stringify({ address, expires }));
  const token = payload + '.' + sign(payload);
  return { address, token, expires };
}

/**
 * Validate a session token. Returns the address on success, or null.
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  // Constant-time compare of the HMAC.
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(b64urlDecode(payload).toString('utf8')); } catch (e) { return null; }
  if (!data || !isAddress(data.address) || Date.now() > data.expires) return null;
  return data.address.toLowerCase();
}

/**
 * Express middleware. Reads a Bearer token and sets req.user to the
 * authenticated address. If `required` is true, rejects unauthenticated
 * requests with 401; otherwise leaves req.user undefined and continues
 * (so routes can fall back to the shared 'demo' scope).
 */
function authMiddleware(required = false) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const address = token ? verifyToken(token) : null;
    if (address) req.user = address;
    if (required && !address) return res.status(401).json({ error: 'Authentication required' });
    next();
  };
}

module.exports = {
  configure,
  issueNonce,
  verifySignature,
  recoverAddress,
  verifyToken,
  issueToken,
  authMiddleware,
  loginMessage,
  isAddress
};
