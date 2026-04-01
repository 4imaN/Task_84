const nodeCrypto = require('node:crypto');

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = nodeCrypto;
}
