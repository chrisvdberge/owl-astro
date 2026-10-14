/**
 * Links into AstroBin's search. Its search page takes the filters as `?p=`: a msgpack string holding a query string,
 * zlib-compressed and base64url-encoded. Filters are free for subjects and free text; equipment filters need a paid plan,
 * so gear goes into the free text (which also matches equipment names).
 */

/** zlib stream with a single stored (uncompressed) deflate block: valid input for any inflater, no compressor needed. */
function zlibStored(data: Uint8Array): Uint8Array {
  const n = data.length // a query string is far below a stored block's 65535-byte limit
  const out = new Uint8Array(2 + 5 + n + 4)
  out.set([0x78, 0x01, 0x01, n & 0xff, n >> 8, ~n & 0xff, (~n >> 8) & 0xff])
  out.set(data, 7)
  let a = 1, b = 0
  for (const x of data) { a = (a + x) % 65521; b = (b + a) % 65521 }
  new DataView(out.buffer).setUint32(7 + n, ((b << 16) | a) >>> 0)
  return out
}

/** msgpack string header + UTF-8 bytes. */
function msgpackStr(s: string): Uint8Array {
  const b = new TextEncoder().encode(s)
  const head = b.length < 32 ? [0xa0 | b.length] : b.length < 256 ? [0xd9, b.length] : [0xda, b.length >> 8, b.length & 0xff]
  const out = new Uint8Array(head.length + b.length)
  out.set(head); out.set(b, head.length)
  return out
}

function searchUrl(filters: Record<string, unknown>): string {
  const qs = Object.entries(filters).map(([k, v]) => `${k}=${encodeURIComponent(JSON.stringify(v))}`).join('&')
  const bytes = zlibStored(msgpackStr(qs))
  const p = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `https://app.astrobin.com/search?p=${p}`
}

/** All AstroBin images tagged with this subject, e.g. "M 81" or "NGC 2976". */
export const astrobinSubject = (subject: string) => searchUrl({ subjects: { value: [subject], matchType: null } })

/** AstroBin images matching every word, e.g. "M 81 Seestar S50 Pro". */
export const astrobinText = (text: string) => searchUrl({ text: { value: text, matchType: 'ALL' } })
