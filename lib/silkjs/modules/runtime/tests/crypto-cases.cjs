// Prints one JSON line per case: what a runtime's crypto computes for hashes, HMAC, key
// derivation and the symmetric ciphers, and how each fails, for tests/crypto-differential.mjs to
// compare with Node's.
const crypto = require('crypto');
const out = [];
function record(name, fn) {
  try { out.push({ name, value: fn() }); }
  catch (e) { out.push({ name, error: { code: e.code, message: e.message, name: e.name } }); }
}
const big = Buffer.alloc(100003); for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 255;
const inputs = { empty: Buffer.alloc(0), abc: Buffer.from('abc'), big };
const hashes = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha512-224', 'sha512-256', 'sha3-224', 'sha3-256', 'sha3-384',
  'sha3-512', 'shake128', 'shake256', 'blake2b512', 'blake2s256', 'ripemd160', 'sm3', 'md5-sha1', 'SHA256', 'RSA-SHA256', 'sha-256', 'dss1', 'rmd160'];
for (const h of hashes) for (const [label, input] of Object.entries(inputs)) record(`hash ${h} ${label}`, () => crypto.createHash(h).update(input).digest('hex'));
for (const h of hashes) record(`hash ${h} split`, () => { const x = crypto.createHash(h); for (let i = 0; i < big.length; i += 9973) x.update(big.subarray(i, i + 9973)); return x.digest('base64'); });
for (const h of hashes) record(`hash one-shot ${h}`, () => crypto.hash(h, 'one shot', 'hex'));
record('hash copy', () => { const a = crypto.createHash('sha256').update('one'); const b = a.copy(); b.update('two'); return [a.digest('hex'), b.digest('hex')]; });
record('shake128 length', () => crypto.createHash('shake128', { outputLength: 100 }).update('x').digest('hex'));
record('shake256 length 0', () => crypto.createHash('shake256', { outputLength: 0 }).update('x').digest('hex'));
record('sha256 outputLength', () => crypto.createHash('sha256', { outputLength: 16 }).update('x').digest('hex'));
record('unknown hash', () => crypto.createHash('nope'));
record('hash digest twice', () => { const x = crypto.createHash('md5'); x.digest(); return x.digest(); });
for (const h of hashes.filter(h => !h.startsWith('shake'))) for (const key of ['', 'key', 'k'.repeat(200)]) record(`hmac ${h} key ${key.length}`, () => crypto.createHmac(h, key).update('message').update(big).digest('hex'));
record('hmac shake', () => crypto.createHmac('shake128', 'k').update('x').digest('hex'));
record('hmac digest twice', () => { const x = crypto.createHmac('sha1', 'k'); x.digest(); return x.digest('hex'); });
for (const h of ['sha1', 'sha256', 'sha512', 'md5', 'sha3-256']) for (const [i, len] of [[1, 20], [1000, 64], [2, 100]]) record(`pbkdf2 ${h} ${i} ${len}`, () => crypto.pbkdf2Sync('password', 'salt', i, len, h).toString('hex'));
record('pbkdf2 bad digest', () => crypto.pbkdf2Sync('p', 's', 1, 10, 'nope'));
for (const [N, r, p, len] of [[16, 1, 1, 64], [1024, 8, 1, 32], [256, 2, 3, 48]]) record(`scrypt ${N} ${r} ${p} ${len}`, () => crypto.scryptSync('password', 'NaCl', len, { N, r, p }).toString('hex'));
record('scrypt maxmem', () => crypto.scryptSync('p', 's', 16, { N: 1 << 20, maxmem: 1024 }));
for (const h of ['sha1', 'sha256', 'sha512', 'md5']) for (const len of [1, 42, 255]) record(`hkdf ${h} ${len}`, () => Buffer.from(crypto.hkdfSync(h, 'key', 'salt', 'info', len)).toString('hex'));
record('hkdf too long', () => crypto.hkdfSync('sha256', 'k', 's', 'i', 255 * 32 + 1));
const key = n => Buffer.alloc(n, 0x42), iv = n => Buffer.alloc(n, 0x24);
const plain = { short: Buffer.from('hello'), block: Buffer.alloc(32, 1), big };
for (const bits of [128, 192, 256]) for (const mode of ['ecb', 'cbc', 'cfb', 'cfb8', 'cfb1', 'ofb', 'ctr']) for (const [label, input] of Object.entries(plain)) {
  const name = `aes-${bits}-${mode}`, ivLength = mode === 'ecb' ? 0 : 16;
  record(`cipher ${name} ${label}`, () => {
    const c = crypto.createCipheriv(name, key(bits / 8), ivLength ? iv(ivLength) : null);
    const enc = Buffer.concat([c.update(input), c.final()]);
    const d = crypto.createDecipheriv(name, key(bits / 8), ivLength ? iv(ivLength) : null);
    const dec = Buffer.concat([d.update(enc), d.final()]);
    return [crypto.createHash('sha256').update(enc).digest('hex'), dec.equals(input)];
  });
}
for (const bits of [128, 256]) for (const ivLength of [12, 16, 1]) for (const tagLength of [16, 12, 4]) record(`gcm ${bits} iv ${ivLength} tag ${tagLength}`, () => {
  const name = `aes-${bits}-gcm`;
  const c = crypto.createCipheriv(name, key(bits / 8), iv(ivLength), { authTagLength: tagLength });
  c.setAAD(Buffer.from('header'));
  const enc = Buffer.concat([c.update(big), c.final()]); const tag = c.getAuthTag();
  const d = crypto.createDecipheriv(name, key(bits / 8), iv(ivLength), { authTagLength: tagLength });
  d.setAAD(Buffer.from('header')); d.setAuthTag(tag);
  const dec = Buffer.concat([d.update(enc), d.final()]);
  return [crypto.createHash('sha256').update(enc).digest('hex'), tag.toString('hex'), dec.equals(big)];
});
record('gcm bad tag', () => {
  const c = crypto.createCipheriv('aes-128-gcm', key(16), iv(12)); const enc = Buffer.concat([c.update('data'), c.final()]);
  const d = crypto.createDecipheriv('aes-128-gcm', key(16), iv(12)); d.setAuthTag(Buffer.alloc(16)); d.update(enc); return d.final();
});
record('chacha20-poly1305', () => {
  const c = crypto.createCipheriv('chacha20-poly1305', key(32), iv(12), { authTagLength: 16 }); c.setAAD(Buffer.from('aad'));
  const enc = Buffer.concat([c.update(big), c.final()]); const tag = c.getAuthTag();
  const d = crypto.createDecipheriv('chacha20-poly1305', key(32), iv(12), { authTagLength: 16 }); d.setAAD(Buffer.from('aad')); d.setAuthTag(tag);
  return [enc.subarray(0, 64).toString('hex'), tag.toString('hex'), Buffer.concat([d.update(enc), d.final()]).equals(big)];
});
record('chacha20', () => { const c = crypto.createCipheriv('chacha20', key(32), iv(16)); return Buffer.concat([c.update('stream cipher text'), c.final()]).toString('hex'); });
record('cbc no padding', () => { const c = crypto.createCipheriv('aes-128-cbc', key(16), iv(16)); c.setAutoPadding(false); return Buffer.concat([c.update(Buffer.alloc(32, 3)), c.final()]).toString('hex'); });
record('cbc no padding partial', () => { const c = crypto.createCipheriv('aes-128-cbc', key(16), iv(16)); c.setAutoPadding(false); c.update(Buffer.alloc(10)); return c.final(); });
record('cbc bad decrypt', () => { const d = crypto.createDecipheriv('aes-128-cbc', key(16), iv(16)); d.update(Buffer.alloc(16, 9)); return d.final(); });
record('cbc wrong key length', () => crypto.createCipheriv('aes-128-cbc', key(15), iv(16)));
record('cbc wrong iv length', () => crypto.createCipheriv('aes-128-cbc', key(16), iv(15)));
record('unknown cipher', () => crypto.createCipheriv('aes-128-xyz', key(16), iv(16)));
for (const name of ['aes-128-cbc', 'aes-256-gcm', 'id-aes128-gcm', 'aes128', 'chacha20-poly1305', 'chacha20', 'aes-192-ctr', 'aes-128-cfb8', 'nope']) record(`cipherInfo ${name}`, () => crypto.getCipherInfo(name) ?? null);
record('cipherInfo nid', () => crypto.getCipherInfo(419));
record('cipherInfo keyLength', () => [crypto.getCipherInfo('aes-128-cbc', { keyLength: 16 }), crypto.getCipherInfo('aes-128-cbc', { keyLength: 17 }) ?? null]);
record('random length', () => [crypto.randomBytes(0).length, crypto.randomBytes(33).length, crypto.randomUUID().length, crypto.getRandomValues(new Uint8Array(8)).length]);
record('timingSafeEqual', () => [crypto.timingSafeEqual(Buffer.from('ab'), Buffer.from('ab')), crypto.timingSafeEqual(Buffer.from('ab'), Buffer.from('ac'))]);
record('getHashes has', () => ['sha256', 'md5', 'sha3-512', 'shake256', 'RSA-SHA256'].map(h => crypto.getHashes().includes(h)));
record('getCiphers has', () => ['aes-128-cbc', 'aes-256-gcm', 'chacha20-poly1305'].map(c => crypto.getCiphers().includes(c)));
// Keys: fixed keys (tests/fixtures/crypto/keys.json), so exports and deterministic signatures compare.
const keys = require('./fixtures/crypto/keys.json');
const extras = require('./fixtures/crypto/extras.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
for (const [name, pem] of Object.entries(keys)) {
  record(`key ${name} details`, () => { const k = crypto.createPrivateKey(pem); return [k.type, k.asymmetricKeyType, k.asymmetricKeyDetails]; });
  for (const [type, format] of [['pkcs8', 'pem'], ['pkcs8', 'der']]) record(`key ${name} export ${type} ${format}`, () => sha(crypto.createPrivateKey(pem).export({ type, format })));
  record(`key ${name} public spki`, () => crypto.createPublicKey(pem).export({ type: 'spki', format: 'pem' }));
  record(`key ${name} public der`, () => sha(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })));
  record(`key ${name} jwk`, () => crypto.createPrivateKey(pem).export({ format: 'jwk' }));
  record(`key ${name} public jwk`, () => crypto.createPublicKey(pem).export({ format: 'jwk' }));
  record(`key ${name} roundtrip der`, () => sha(crypto.createPrivateKey({ key: crypto.createPrivateKey(pem).export({ type: 'pkcs8', format: 'der' }), format: 'der', type: 'pkcs8' }).export({ type: 'pkcs8', format: 'der' })));
  record(`key ${name} encrypted pkcs8`, () => { const enc = crypto.createPrivateKey(pem).export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' }); return sha(crypto.createPrivateKey({ key: enc, passphrase: 'pw' }).export({ type: 'pkcs8', format: 'der' })); });
  // A wrong passphrase decrypts to garbage that ends in valid padding about once in 256 random
  // salts, and then fails as an undecodable key (ERR_OSSL_UNSUPPORTED) instead of a bad decrypt,
  // in OpenSSL as in SilkCrypto: either is the refusal.
  record(`key ${name} wrong passphrase`, () => {
    const enc = crypto.createPrivateKey(pem).export({ type: 'pkcs8', format: 'pem', cipher: 'aes-128-cbc', passphrase: 'pw' });
    try { return crypto.createPrivateKey({ key: enc, passphrase: 'nope' }); }
    catch (error) { if (error.code === 'ERR_OSSL_BAD_DECRYPT' || error.code === 'ERR_OSSL_UNSUPPORTED') return 'refused'; throw error; }
  });
  record(`key ${name} missing passphrase`, () => { const enc = crypto.createPrivateKey(pem).export({ type: 'pkcs8', format: 'der', cipher: 'aes-128-cbc', passphrase: 'pw' }); return crypto.createPrivateKey({ key: enc, format: 'der', type: 'pkcs8' }); });
}
record('rsa pkcs1 export', () => [sha(crypto.createPrivateKey(keys.rsa).export({ type: 'pkcs1', format: 'pem' })), crypto.createPublicKey(keys.rsa).export({ type: 'pkcs1', format: 'pem' })]);
record('rsa pkcs1 import', () => sha(crypto.createPrivateKey(crypto.createPrivateKey(keys.rsa).export({ type: 'pkcs1', format: 'pem' })).export({ type: 'pkcs8', format: 'der' })));
record('rsa legacy encrypted', () => { const enc = crypto.createPrivateKey(keys.rsa).export({ type: 'pkcs1', format: 'pem', cipher: 'aes-128-cbc', passphrase: 'pw' }); return [enc.includes('DEK-Info: AES-128-CBC'), sha(crypto.createPrivateKey({ key: enc, passphrase: 'pw' }).export({ type: 'pkcs1', format: 'der' }))]; });
record('ec sec1 export', () => sha(crypto.createPrivateKey(keys['ec-prime256v1']).export({ type: 'sec1', format: 'der' })));
record('ec sec1 import', () => sha(crypto.createPrivateKey({ key: crypto.createPrivateKey(keys['ec-prime256v1']).export({ type: 'sec1', format: 'der' }), format: 'der', type: 'sec1' }).export({ type: 'pkcs8', format: 'der' })));
record('garbage key', () => crypto.createPrivateKey('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'));
record('public from private pem', () => crypto.createPublicKey(keys.ed25519).asymmetricKeyType);
for (const digest of ['sha1', 'sha256', 'sha384', 'sha512', 'sha3-256', 'md5']) {
  record(`rsa sign ${digest}`, () => crypto.sign(digest, Buffer.from('message'), keys.rsa).toString('base64'));
  record(`rsa verify ${digest}`, () => crypto.verify(digest, Buffer.from('message'), crypto.createPublicKey(keys.rsa), crypto.sign(digest, Buffer.from('message'), keys.rsa)));
}
record('rsa sign stream', () => crypto.createSign('SHA256').update('a').update('b').sign(keys.rsa, 'hex'));
record('rsa verify tampered', () => crypto.verify('sha256', Buffer.from('message!'), keys.rsa, crypto.sign('sha256', Buffer.from('message'), keys.rsa)));
for (const saltLength of [undefined, 0, 32]) record(`rsa pss ${saltLength}`, () => { const s = crypto.sign('sha256', Buffer.from('m'), { key: keys.rsa, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength }); return [s.length, crypto.verify('sha256', Buffer.from('m'), { key: keys.rsa, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength }, s)]; });
for (const curve of ['prime256v1', 'secp384r1', 'secp521r1', 'secp256k1']) for (const dsaEncoding of ['der', 'ieee-p1363']) record(`ecdsa ${curve} ${dsaEncoding}`, () => { const key = keys['ec-' + curve]; const s = crypto.sign('sha256', Buffer.from('m'), { key, dsaEncoding }); return [dsaEncoding === 'der' ? s[0] : s.length, crypto.verify('sha256', Buffer.from('m'), { key, dsaEncoding }, s), crypto.verify('sha256', Buffer.from('x'), { key, dsaEncoding }, s)]; });
record('ed25519 sign', () => { const s = crypto.sign(null, Buffer.from('m'), keys.ed25519); return [s.toString('hex'), crypto.verify(null, Buffer.from('m'), keys.ed25519, s), crypto.verify(null, Buffer.from('n'), keys.ed25519, s)]; });
record('x25519 derive', () => crypto.diffieHellman({ privateKey: crypto.createPrivateKey(keys.x25519), publicKey: crypto.createPublicKey(keys.x25519b) }).toString('hex'));
record('ecdh derive', () => crypto.diffieHellman({ privateKey: crypto.createPrivateKey(keys['ec-prime256v1']), publicKey: crypto.createPublicKey(keys['ec-prime256v1-b']) }).toString('hex'));
record('ecdh curve mismatch', () => crypto.diffieHellman({ privateKey: crypto.createPrivateKey(keys['ec-prime256v1']), publicKey: crypto.createPublicKey(keys['ec-secp384r1']) }));
for (const [padding, oaepHash] of [[crypto.constants.RSA_PKCS1_OAEP_PADDING, undefined], [crypto.constants.RSA_PKCS1_OAEP_PADDING, 'sha256'], [crypto.constants.RSA_NO_PADDING, undefined]]) record(`rsa crypt ${padding} ${oaepHash}`, () => { const data = padding === crypto.constants.RSA_NO_PADDING ? Buffer.alloc(256, 1) : Buffer.from('secret'); const enc = crypto.publicEncrypt({ key: keys.rsa, padding, oaepHash }, data); return [enc.length, crypto.privateDecrypt({ key: keys.rsa, padding, oaepHash }, enc).equals(data)]; });
record('rsa privateEncrypt', () => { const enc = crypto.privateEncrypt(keys.rsa, Buffer.from('hello')); return [enc.toString('base64'), crypto.publicDecrypt(keys.rsa, enc).toString()]; });
record('generate rsa', () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }); return [publicKey.asymmetricKeyDetails, crypto.verify('sha256', Buffer.from('m'), publicKey, crypto.sign('sha256', Buffer.from('m'), privateKey))]; });
for (const type of ['ec', 'ed25519', 'x25519']) record(`generate ${type}`, () => { const { publicKey, privateKey } = crypto.generateKeyPairSync(type, { namedCurve: 'P-256' }); return [publicKey.asymmetricKeyType, privateKey.asymmetricKeyDetails]; });
record('generate pem encodings', () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'sec1', format: 'pem' } }); return [publicKey.split('\n')[0], privateKey.split('\n')[0]]; });
record('jwk import', () => { const jwk = crypto.createPrivateKey(keys['ec-prime256v1']).export({ format: 'jwk' }); return sha(crypto.createPrivateKey({ key: jwk, format: 'jwk' }).export({ type: 'pkcs8', format: 'der' })); });
record('getCurves has', () => ['prime256v1', 'secp384r1', 'secp521r1', 'secp256k1'].map(c2 => crypto.getCurves().includes(c2)));
record('ecdh object', () => { const a = crypto.createECDH('prime256v1'), b = crypto.createECDH('prime256v1'); a.setPrivateKey(Buffer.alloc(32, 7)); b.setPrivateKey(Buffer.alloc(32, 9)); return [a.getPublicKey('hex'), a.getPublicKey('hex', 'compressed'), a.computeSecret(b.getPublicKey()).toString('hex'), a.getPrivateKey('hex')]; });
record('ecdh generate', () => { const a = crypto.createECDH('secp384r1'); a.generateKeys(); const b = crypto.createECDH('secp384r1'); b.generateKeys(); return a.computeSecret(b.getPublicKey()).equals(b.computeSecret(a.getPublicKey())); });
record('ecdh convertKey', () => crypto.ECDH.convertKey(crypto.createECDH('prime256v1').setPrivateKey(Buffer.alloc(32, 3)) ?? crypto.createECDH('prime256v1'), 'prime256v1'));
record('ecdh bad curve', () => crypto.createECDH('nope'));
record('dh group', () => { const a = crypto.getDiffieHellman('modp14'), b = crypto.getDiffieHellman('modp14'); a.generateKeys(); b.generateKeys(); return [a.verifyError, a.getPrime('hex').length, a.getGenerator('hex'), a.computeSecret(b.getPublicKey()).equals(b.computeSecret(a.getPublicKey()))]; });
record('dh legacy group', () => { const a = crypto.getDiffieHellman('modp2'); a.setPrivateKey(Buffer.alloc(32, 5)); a.generateKeys(); return a.getPublicKey('hex'); });
record('dh custom', () => { const prime = crypto.getDiffieHellman('modp5').getPrime(); const a = crypto.createDiffieHellman(prime, Buffer.from([2])); return [a.verifyError, a.getPrime().equals(prime)]; });
for (const type of ['ed448', 'x448']) record(`generate ${type}`, () => { const { publicKey, privateKey } = crypto.generateKeyPairSync(type); return [publicKey.asymmetricKeyType, privateKey.export({ format: 'der', type: 'pkcs8' }).length, publicKey.export({ format: 'der', type: 'spki' }).length]; });
record('ed448 sign', () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed448'); const s = crypto.sign(null, Buffer.from('m'), privateKey); return [s.length, crypto.verify(null, Buffer.from('m'), publicKey, s)]; });
record('x448 derive', () => { const a = crypto.generateKeyPairSync('x448'), b = crypto.generateKeyPairSync('x448'); return crypto.diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey }).equals(crypto.diffieHellman({ privateKey: b.privateKey, publicKey: a.publicKey })); });
for (const name of ['des-ede3-cbc', 'des-ede3']) record(`cipher ${name}`, () => { const c = crypto.createCipheriv(name, key(24), name === 'des-ede3' ? null : iv(8)); const enc = Buffer.concat([c.update(big), c.final()]); const d = crypto.createDecipheriv(name, key(24), name === 'des-ede3' ? null : iv(8)); return [sha(enc), Buffer.concat([d.update(enc), d.final()]).equals(big)]; });
for (const name of ['id-aes128-wrap', 'aes256-wrap', 'id-aes192-wrap-pad']) record(`cipher ${name}`, () => { const k = key(name.includes('128') ? 16 : name.includes('192') ? 24 : 32); const ivv = name.endsWith('pad') ? Buffer.from('a65959a6', 'hex') : Buffer.from('a6a6a6a6a6a6a6a6', 'hex'); const data = Buffer.alloc(name.endsWith('pad') ? 20 : 32, 0x11); const c = crypto.createCipheriv(name, k, ivv); const enc = Buffer.concat([c.update(data), c.final()]); const d = crypto.createDecipheriv(name, k, ivv); return [enc.toString('hex'), Buffer.concat([d.update(enc), d.final()]).equals(data)]; });
record('ccm', () => { const c = crypto.createCipheriv('aes-128-ccm', key(16), iv(12), { authTagLength: 16 }); c.setAAD(Buffer.from('aad'), { plaintextLength: 5 }); const enc = Buffer.concat([c.update('hello'), c.final()]); const tag = c.getAuthTag(); const d = crypto.createDecipheriv('aes-128-ccm', key(16), iv(12), { authTagLength: 16 }); d.setAuthTag(tag); d.setAAD(Buffer.from('aad'), { plaintextLength: 5 }); return [enc.toString('hex'), tag.toString('hex'), Buffer.concat([d.update(enc), d.final()]).toString()]; });
// The rest of the block ciphers: ARIA, Camellia, SM4, two-key and three-key DES, CTS, XTS, OCB.
for (const name of ['aria-128-ecb', 'aria-192-cbc', 'aria-256-ctr', 'aria-128-cfb', 'aria-128-cfb8', 'aria-128-cfb1', 'aria-256-ofb', 'aria128',
  'camellia-128-ecb', 'camellia-192-cbc', 'camellia-256-ctr', 'camellia-128-cfb', 'camellia-128-cfb8', 'camellia-128-cfb1', 'camellia-256-ofb', 'camellia256',
  'sm4', 'sm4-ecb', 'sm4-cbc', 'sm4-cfb', 'sm4-ofb', 'sm4-ctr', 'sm4-cfb128', 'des-ede', 'des-ede-cbc', 'des-ede-cfb', 'des-ede-ofb', 'des-ede3-cfb',
  'des-ede3-cfb1', 'des-ede3-cfb8', 'des-ede3-ofb']) record(`cipher ${name}`, () => {
  const info = crypto.getCipherInfo(name);
  const c = crypto.createCipheriv(name, key(info.keyLength), info.ivLength ? iv(info.ivLength) : null);
  const enc = Buffer.concat([c.update(big), c.final()]);
  const d = crypto.createDecipheriv(name, key(info.keyLength), info.ivLength ? iv(info.ivLength) : null);
  return [info, sha(enc), Buffer.concat([d.update(enc), d.final()]).equals(big)];
});
record('cipher sm4 bad final', () => { const d = crypto.createDecipheriv('sm4-cbc', key(16), iv(16)); d.update(Buffer.alloc(16, 9)); return d.final(); });
for (const name of ['aes-128-cbc-cts', 'aes-256-cbc-cts', 'camellia-192-cbc-cts']) for (const ctsMode of [undefined, 'CS1', 'CS2', 'CS3']) for (const length of [16, 32, 45]) record(`cipher ${name} ${ctsMode} ${length}`, () => {
  const k = key(crypto.getCipherInfo(name).keyLength), data = big.subarray(0, length);
  const c = crypto.createCipheriv(name, k, iv(16), ctsMode && { ctsMode }); const enc = Buffer.concat([c.update(data), c.final()]);
  const d = crypto.createDecipheriv(name, k, iv(16), ctsMode && { ctsMode }); return [enc.toString('hex'), Buffer.concat([d.update(enc), d.final()]).equals(data)];
});
record('cipher cts short', () => { const c = crypto.createCipheriv('aes-128-cbc-cts', key(16), iv(16)); return Buffer.concat([c.update(Buffer.alloc(5)), c.final()]); });
for (const name of ['aes-128-xts', 'aes-256-xts']) record(`cipher ${name}`, () => { const k = Buffer.concat([key(name.includes('128') ? 16 : 32), Buffer.alloc(name.includes('128') ? 16 : 32, 1)]); const c = crypto.createCipheriv(name, k, iv(16)); const enc = Buffer.concat([c.update(big.subarray(0, 1000)), c.final()]); const d = crypto.createDecipheriv(name, k, iv(16)); return [sha(enc), Buffer.concat([d.update(enc), d.final()]).equals(big.subarray(0, 1000))]; });
record('cipher xts duplicate keys', () => { const c = crypto.createCipheriv('aes-128-xts', key(32), iv(16)); return Buffer.concat([c.update(Buffer.alloc(32)), c.final()]); });
for (const [name, nonce, tagLength] of [['aes-128-ocb', 12, 16], ['aes-256-ocb', 7, 8], ['aes-192-ocb', 15, 12]]) record(`cipher ${name} ${nonce} ${tagLength}`, () => {
  const k = key(crypto.getCipherInfo(name).keyLength), o = { authTagLength: tagLength };
  const c = crypto.createCipheriv(name, k, iv(nonce), o); c.setAAD(Buffer.from('header')); const enc = Buffer.concat([c.update(big.subarray(0, 333)), c.final()]); const tag = c.getAuthTag();
  const d = crypto.createDecipheriv(name, k, iv(nonce), o); d.setAAD(Buffer.from('header')); d.setAuthTag(tag);
  const bad = crypto.createDecipheriv(name, k, iv(nonce), o); bad.setAAD(Buffer.from('header!')); bad.setAuthTag(tag); bad.update(enc);
  let failed = false; try { bad.final(); } catch { failed = true; }
  return [sha(enc), tag.toString('hex'), Buffer.concat([d.update(enc), d.final()]).equals(big.subarray(0, 333)), failed];
});
record('cipher des3-wrap', () => { const c = crypto.createCipheriv('des3-wrap', key(24), Buffer.alloc(0)); const w = c.update(Buffer.alloc(24, 3)); const d = crypto.createDecipheriv('des3-wrap', key(24), Buffer.alloc(0)); return [w.length, d.update(w).toString('hex')]; });
for (const name of ['aes-128-wrap', 'aes-256-wrap-pad', 'aes-128-ocb', 'aes-256-xts', 'aes-192-cbc-cts', 'camellia128', 'sm4-ofb128', 'des-ede-ecb', 'des3-wrap', 'id-smime-alg-cms3deswrap', 1066, 958, 913, 246, 32]) record(`cipher info ${name}`, () => crypto.getCipherInfo(name));
for (const name of ['RSA-SHA1-2', 'RSA-SHA512/224', 'sha256WithRSAEncryption', 'md5WithRSAEncryption', 'ripemd160WithRSA', 'ssl3-md5', 'ssl3-sha1', 'sm3WithRSAEncryption',
  'id-rsassa-pkcs1-v1_5-with-sha3-384', 'blake2b-512', 'blake2s-256', 'sha2-512/256', 'sha-512/224', 'ripemd-160']) record(`hash alias ${name}`, () => crypto.createHash(name).update('abc').digest('hex'));
// DSA.
record('dsa key', () => { const k = crypto.createPrivateKey(keys.dsa); return [k.asymmetricKeyType, k.asymmetricKeyDetails, sha(k.export({ type: 'pkcs8', format: 'der' })), sha(crypto.createPublicKey(k).export({ type: 'spki', format: 'der' }))]; });
record('dsa verify node signature', () => [crypto.verify('sha256', Buffer.from('message'), crypto.createPublicKey(keys.dsa), Buffer.from(extras['dsa-signature'], 'base64')), crypto.verify('sha256', Buffer.from('massage'), crypto.createPublicKey(keys.dsa), Buffer.from(extras['dsa-signature'], 'base64'))]);
for (const dsaEncoding of ['der', 'ieee-p1363']) record(`dsa sign ${dsaEncoding}`, () => { const s = crypto.sign('sha1', Buffer.from('m'), { key: keys.dsa, dsaEncoding }); return [dsaEncoding === 'der' ? s[0] : s.length, crypto.verify('sha1', Buffer.from('m'), { key: keys.dsa, dsaEncoding }, s)]; });
record('dsa jwk', () => crypto.createPrivateKey(keys.dsa).export({ format: 'jwk' }));
record('dsa generate small', () => crypto.generateKeyPairSync('dsa', { modulusLength: 512 }));
record('dsa generate divisor', () => crypto.generateKeyPairSync('dsa', { modulusLength: 1024, divisorLength: 200 }));
record('dsa generate', () => crypto.generateKeyPairSync('dsa', { modulusLength: 1024 }).privateKey.asymmetricKeyDetails);
// RSA-PSS keys.
for (const name of ['rsa-pss', 'rsa-pss-plain']) record(`${name} key`, () => { const k = crypto.createPrivateKey(keys[name]); const s = crypto.sign(null, Buffer.from('m'), k); return [k.asymmetricKeyType, k.asymmetricKeyDetails, sha(k.export({ type: 'pkcs8', format: 'der' })), sha(crypto.createPublicKey(k).export({ type: 'spki', format: 'der' })), s.length, crypto.verify(null, Buffer.from('m'), crypto.createPublicKey(k), s)]; });
for (const options of [{}, { hashAlgorithm: 'sha256' }, { hashAlgorithm: 'sha512', mgf1HashAlgorithm: 'sha256', saltLength: 10 }, { saltLength: 4 }]) record(`rsa-pss generate ${JSON.stringify(options)}`, () => { const k = crypto.generateKeyPairSync('rsa-pss', { modulusLength: 1024, ...options }); return [k.publicKey.asymmetricKeyDetails, k.publicKey.export({ type: 'spki', format: 'der' }).subarray(0, 24).toString('hex')]; });
record('rsa-pss encrypt', () => crypto.publicEncrypt(crypto.createPublicKey(keys['rsa-pss']), Buffer.from('x')));
// DH keys.
record('dh keys', () => { const a = crypto.createPrivateKey(keys.dh), b = crypto.createPrivateKey(keys['dh-b']); return [a.asymmetricKeyType, a.asymmetricKeyDetails, sha(a.export({ type: 'pkcs8', format: 'der' })), sha(crypto.createPublicKey(a).export({ type: 'spki', format: 'der' })), sha(crypto.diffieHellman({ privateKey: a, publicKey: crypto.createPublicKey(b) }))]; });
record('dh generate', () => { const a = crypto.generateKeyPairSync('dh', { group: 'modp14' }), b = crypto.generateKeyPairSync('dh', { group: 'modp14' }); return crypto.diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey }).equals(crypto.diffieHellman({ privateKey: b.privateKey, publicKey: a.publicKey })); });
record('dh generate prime', () => { const prime = crypto.getDiffieHellman('modp2').getPrime(); const a = crypto.generateKeyPairSync('dh', { prime, generator: 2 }); const spki = a.publicKey.export({ type: 'spki', format: 'der' }); return [a.privateKey.asymmetricKeyType, spki.length >= 290 && spki.length <= 292, crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }).asymmetricKeyType]; });
// ML-DSA and ML-KEM.
for (const name of ['ml-dsa-44', 'ml-dsa-87', 'ml-kem-768']) record(`${name} key`, () => { const k = crypto.createPrivateKey(keys[name]); const pub = crypto.createPublicKey(k); return [k.asymmetricKeyType, k.asymmetricKeyDetails, sha(k.export({ type: 'pkcs8', format: 'der' })), sha(pub.export({ type: 'spki', format: 'der' })), sha(pub.export({ format: 'raw-public' })), sha(k.export({ format: 'raw-seed' })), k.export({ format: 'jwk' }).kty]; });
record('ml-dsa verify node signature', () => { const pub = crypto.createPublicKey(keys['ml-dsa-44']); const s = Buffer.from(extras['ml-dsa-44-signature'], 'base64'); return [crypto.verify(null, Buffer.from('message'), pub, s), crypto.verify(null, Buffer.from('messages'), pub, s)]; });
record('ml-dsa sign', () => { const s = crypto.sign(null, Buffer.from('m'), keys['ml-dsa-87']); return [s.length, crypto.verify(null, Buffer.from('m'), crypto.createPublicKey(keys['ml-dsa-87']), s)]; });
record('ml-dsa context', () => { const s = crypto.sign(null, Buffer.from('m'), { key: keys['ml-dsa-44'], context: Buffer.from('ctx') }); const pub = crypto.createPublicKey(keys['ml-dsa-44']); return [crypto.verify(null, Buffer.from('m'), { key: pub, context: Buffer.from('ctx') }, s), crypto.verify(null, Buffer.from('m'), pub, s)]; });
record('ml-kem decapsulate node', () => crypto.decapsulate(keys['ml-kem-768'], Buffer.from(extras['ml-kem-768-ciphertext'], 'base64')).toString('base64') === extras['ml-kem-768-shared']);
record('ml-kem encapsulate', () => { const { sharedKey, ciphertext } = crypto.encapsulate(crypto.createPublicKey(keys['ml-kem-768'])); return [sharedKey.length, ciphertext.length, crypto.decapsulate(keys['ml-kem-768'], ciphertext).equals(sharedKey)]; });
record('ml generate', () => ['ml-dsa-65', 'ml-kem-512', 'ml-kem-1024'].map(t => { const k = crypto.generateKeyPairSync(t); return [k.publicKey.asymmetricKeyType, k.publicKey.export({ type: 'spki', format: 'der' }).length, k.privateKey.export({ type: 'pkcs8', format: 'der' }).length]; }));
record('ml raw import', () => { const seed = Buffer.alloc(32, 1); const k = crypto.createPrivateKey({ key: seed, format: 'raw-seed', asymmetricKeyType: 'ml-dsa-44' }); return sha(crypto.createPublicKey(k).export({ format: 'raw-public' })); });
// Certificates and SPKAC.
const ca = new crypto.X509Certificate(extras['cert-ca1-cert']);
for (const name of ['agent1-cert', 'ca1-cert', 'ec-cert', 'rsa_pss_cert_2048_sha256_sha256_16', 'agent6-cert']) record(`x509 ${name}`, () => {
  const x = new crypto.X509Certificate(extras['cert-' + name]);
  return [x.subject, x.issuer, x.subjectAltName, x.infoAccess, x.validFrom, x.validTo, x.validToDate.toISOString(), x.fingerprint, x.fingerprint256, x.fingerprint512, x.serialNumber, x.signatureAlgorithm, x.signatureAlgorithmOid,
    x.ca, x.keyUsage, x.publicKey.asymmetricKeyType, x.publicKey.asymmetricKeyDetails, x.checkIssued(ca), x.verify(ca.publicKey), x.checkHost('agent1'), x.checkHost('localhost'), x.checkHost('www.example.com'), x.checkHost('a.b', { subject: 'always' }),
    x.checkEmail('ry@tinyclouds.org'), x.checkEmail('nobody@example.com'), x.checkIP('127.0.0.1'), sha(x.raw), x.toString().split('\n')[0], Object.keys(x.toLegacyObject()).sort().join(), x.toLegacyObject().bits, x.toLegacyObject().asn1Curve];
});
record('x509 der input', () => new crypto.X509Certificate(ca.raw).subject);
record('x509 garbage', () => new crypto.X509Certificate('not a certificate'));
record('x509 bad pem', () => new crypto.X509Certificate('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n'));
record('x509 checkIP invalid', () => ca.checkIP('not an ip'));
record('spkac', () => [crypto.Certificate.verifySpkac(Buffer.from(extras.spkac)), crypto.Certificate.verifySpkac(Buffer.from(extras['spkac-invalid'])), crypto.Certificate.exportChallenge(extras.spkac).toString(), crypto.Certificate.exportPublicKey(extras.spkac).toString()]);
// Argon2 (RFC 9106 5.1-5.3 parameters, and small ones).
const argon2Parameters = { message: Buffer.alloc(32, 1), nonce: Buffer.alloc(16, 2), secret: Buffer.alloc(8, 3), associatedData: Buffer.alloc(12, 4), parallelism: 4, tagLength: 32, memory: 32, passes: 3 };
for (const algorithm of ['argon2d', 'argon2i', 'argon2id']) record(`argon2 ${algorithm} rfc`, () => crypto.argon2Sync(algorithm, argon2Parameters).toString('hex'));
for (const [parallelism, tagLength, memory, passes] of [[1, 4, 8, 1], [2, 100, 64, 2], [1, 32, 1000, 1]]) record(`argon2id ${parallelism} ${tagLength} ${memory} ${passes}`, () => crypto.argon2Sync('argon2id', { message: Buffer.from('password'), nonce: Buffer.from('somesalt'), parallelism, tagLength, memory, passes }).toString('hex'));
for (const set of ['44', '65', '87']) record(`ml-dsa-${set} expanded only`, () => { const k = crypto.createPrivateKey(extras[`ml_dsa_${set}_private_priv_only`]); const pub = crypto.createPublicKey(k); const s = crypto.sign(null, Buffer.from('m'), k); return [pub.equals(crypto.createPublicKey(extras[`ml_dsa_${set}_public`])), crypto.verify(null, Buffer.from('m'), pub, s), sha(k.export({ type: 'pkcs8', format: 'der' }))]; });
// createMac.
record('getMacs', () => crypto.getMacs());
for (const [algorithm, keyLength, options] of [['hmac', 32, { digest: 'sha256' }], ['hmac', 200, { digest: 'sha3-512' }], ['kmac128', 32, {}], ['kmac256', 16, { customization: Buffer.from('c'), outputLength: 20 }],
  ['kmac-128', 32, { outputLength: 0 }], ['cmac', 16, { cipher: 'aes-128-cbc' }], ['cmac', 32, { cipher: 'aes-256-cbc' }], ['cmac', 24, { cipher: 'des-ede3-cbc' }], ['gmac', 16, { cipher: 'aes-128-gcm', iv: Buffer.alloc(12, 1) }],
  ['gmac', 32, { cipher: 'aes-256-gcm', iv: Buffer.alloc(16, 2) }], ['poly1305', 32, {}], ['siphash', 16, {}], ['siphash', 16, { outputLength: 8 }], ['blake2bmac', 64, {}],
  ['blake2bmac', 16, { outputLength: 32, salt: Buffer.alloc(16, 3), customization: Buffer.alloc(16, 4) }], ['blake2smac', 32, {}], ['blake2smac', 16, { outputLength: 16, salt: Buffer.alloc(8, 5) }]]) {
  for (const [label, data] of [['empty', Buffer.alloc(0)], ['abc', Buffer.from('abc')], ['big', big]]) record(`mac ${algorithm} ${keyLength} ${JSON.stringify(Object.keys(options))} ${label}`, () => crypto.createMac(algorithm, key(keyLength), options).update(data).final('hex'));
}
record('mac stream', () => { const m = crypto.createMac('cmac', key(16), { cipher: 'aes-128-cbc' }); for (let i = 0; i < 1000; i += 7) m.update(big.subarray(i, i + 7)); return m.final('base64'); });
for (const [algorithm, options] of [['nope', {}], ['hmac', {}], ['hmac', { digest: 'nope' }], ['hmac', { digest: 'sha256', cipher: 'aes-128-cbc' }], ['cmac', {}], ['cmac', { cipher: 'aes-256-cbc', iv: Buffer.alloc(16) }],
  ['gmac', { cipher: 'aes-256-gcm' }], ['poly1305', { customization: Buffer.alloc(0) }], ['siphash', { outputLength: 12 }], ['blake2bmac', { outputLength: 65 }], ['kmac128', { digest: 'sha256' }]]) record(`mac error ${algorithm} ${JSON.stringify(options)}`, () => crypto.createMac(algorithm, key(32).subarray(0, algorithm === 'siphash' ? 16 : 32), options));
let pending = 0;
function later(name, start) { pending++; start((e, v) => { out.push(e ? { name, error: { code: e.code, message: e.message } } : { name, value: v }); if (--pending === 0) finish(); }); }
later('pbkdf2 async', cb => crypto.pbkdf2('p', 's', 10, 16, 'sha256', (e, k) => cb(e, k && k.toString('hex'))));
later('scrypt async', cb => crypto.scrypt('p', 's', 16, (e, k) => cb(e, k && k.toString('hex'))));
later('hkdf async', cb => crypto.hkdf('sha256', 'k', 's', 'i', 16, (e, k) => cb(e, k && Buffer.from(k).toString('hex'))));
later('randomBytes async', cb => crypto.randomBytes(16, (e, b) => cb(e, b && b.length)));
later('keygen async', cb => crypto.generateKeyPair('ed25519', (e, pub, priv) => cb(e, pub && [pub.asymmetricKeyType, priv.type])));
later('subtle ecdsa', cb => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']).then(async k => { const s = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.privateKey, Buffer.from('m')); return [s.byteLength, await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.publicKey, s, Buffer.from('m'))]; }).then(v => cb(null, v), cb));
later('subtle digest', cb => crypto.subtle.digest('SHA-384', Buffer.from('abc')).then(d => cb(null, Buffer.from(d).toString('hex')), cb));
later('subtle turboshake', cb => Promise.all([{ name: 'TurboSHAKE128', outputLength: 256 }, { name: 'TurboSHAKE256', outputLength: 512, domainSeparation: 0x0b }, { name: 'KT128', outputLength: 256 }, { name: 'KT256', outputLength: 512, customization: Buffer.from('c') }].map(a => crypto.subtle.digest(a, big).then(d => Buffer.from(d).toString('hex'), e => e.message))).then(v => cb(null, v), cb));
later('subtle cshake', cb => Promise.all([{ name: 'cSHAKE128', outputLength: 256 }, { name: 'cSHAKE256', outputLength: 512, customization: Buffer.from('custom') }].map(a => crypto.subtle.digest(a, Buffer.from('abc')).then(d => Buffer.from(d).toString('hex'), e => e.message))).then(v => cb(null, v), cb));
later('subtle kmac', cb => Promise.all(['KMAC128', 'KMAC256'].map(name => crypto.subtle.importKey('raw-secret', Buffer.alloc(32, 1), { name }, false, ['sign']).then(k => crypto.subtle.sign({ name, outputLength: 256, customization: Buffer.from('c') }, k, Buffer.from('abc'))).then(d => Buffer.from(d).toString('hex'), e => e.message))).then(v => cb(null, v), cb));
later('subtle argon2', cb => crypto.subtle.importKey('raw-secret', Buffer.from('pw'), { name: 'Argon2id' }, false, ['deriveBits']).then(k => crypto.subtle.deriveBits({ name: 'Argon2id', nonce: Buffer.alloc(16, 2), parallelism: 1, memory: 16, passes: 2 }, k, 256)).then(d => cb(null, Buffer.from(d).toString('hex')), e => cb(null, e.message)));
later('argon2 async', cb => crypto.argon2('argon2i', { message: Buffer.from('p'), nonce: Buffer.alloc(8), parallelism: 1, tagLength: 16, memory: 8, passes: 1 }, (e, k) => cb(e, k && k.toString('hex'))));
function finish() { for (const line of out) console.log(JSON.stringify(line, (k, v) => typeof v === "bigint" ? `${v}n` : v)); }
