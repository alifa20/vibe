/**
 * Minimal PNG encoder for 1-bit greyscale images.
 *
 * The qrcode package's own PNG writer goes through pngjs and node streams,
 * which is a lot of Node surface to drag into a Worker. A QR code is pure
 * black and white, so bit depth 1 / colour type 0 encodes it exactly, and the
 * runtime's CompressionStream emits the zlib stream that IDAT wants.
 */

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32 (bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk (type, data) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

async function deflate (bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * @param {number} width
 * @param {number} height
 * @param {(y: number) => Uint8Array} scanline packed row, 1 bit per pixel, 1 = white
 * @returns {Promise<Uint8Array>} a complete PNG file
 */
export async function encodeMonoPng (width, height, scanline) {
  const stride = (width + 7) >> 3
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter type 0 (None)
    raw.set(scanline(y), y * (stride + 1) + 1)
  }

  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 1 // bit depth
  ihdr[9] = 0 // colour type: greyscale
  // ihdr[10..12] = 0: deflate, adaptive filtering, no interlace

  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))]
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}
