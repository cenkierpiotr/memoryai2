import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const MARKER = 'enc:v1:';

// Key derived once at startup via scrypt — slow by design, runs exactly once
let _key: Buffer | null = null;

function getKey(): Buffer {
  if (_key) return _key;
  _key = scryptSync(config.security.encryptionKey, 'memoryai-cred-v1', 32);
  return _key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${MARKER}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(ciphertext: string): string {
  if (!isEncrypted(ciphertext)) return ciphertext;
  const raw = ciphertext.slice(MARKER.length);
  const parts = raw.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted content');
  const [ivHex, tagHex, dataHex] = parts;
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(MARKER);
}
