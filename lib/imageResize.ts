// Shrink a photo in the browser before it goes up, and never let the shrink be
// the reason the upload fails.
//
// Receiving photos used to go through createImageBitmap → canvas only. When
// the browser can't decode the file — a HEIC straight off an iPhone opened on
// Windows, an odd camera format — that threw before any request was made, and
// the page just said "Upload failed" (Charlie, 2026-09-09: "Having trouble
// uploading pictures"; no upload request ever left the browser). Now:
//   1. createImageBitmap  (fast path)
//   2. <img> decode        (some formats the bitmap API refuses)
//   3. the original file   (the server stores it as-is; better than nothing)
// and the caller is told when it fell all the way through, so it can say why.

export type PreparedImage = { file: File; resized: boolean; undecodable: boolean }

const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)

function toJpeg(canvas: HTMLCanvasElement, name: string, quality: number): Promise<File> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => blob
      ? resolve(new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }))
      : reject(new Error('encode failed')), 'image/jpeg', quality))
}

function draw(source: CanvasImageSource, w0: number, h0: number, maxPx: number): HTMLCanvasElement {
  const scale = Math.min(1, maxPx / Math.max(w0, h0))
  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h })
  canvas.getContext('2d')!.drawImage(source, 0, 0, w, h)
  return canvas
}

async function viaBitmap(file: File, maxPx: number, quality: number): Promise<File> {
  const bitmap = await createImageBitmap(file)
  try { return await toJpeg(draw(bitmap, bitmap.width, bitmap.height, maxPx), file.name, quality) }
  finally { bitmap.close() }
}

async function viaImg(file: File, maxPx: number, quality: number): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode failed'))
      img.src = url
    })
    return await toJpeg(draw(img, img.naturalWidth, img.naturalHeight, maxPx), file.name, quality)
  } finally { URL.revokeObjectURL(url) }
}

export async function prepareImage(file: File, maxPx = 1920, quality = 0.82): Promise<PreparedImage> {
  try { return { file: await viaBitmap(file, maxPx, quality), resized: true, undecodable: false } } catch { /* next */ }
  try { return { file: await viaImg(file, maxPx, quality), resized: true, undecodable: false } } catch { /* next */ }
  return { file, resized: false, undecodable: true }
}

/** What to tell the person when the browser couldn't read the photo at all. */
export function undecodableNote(file: File): string {
  return isHeic(file)
    ? 'Saved the original, but this browser can’t read HEIC photos so there’s no preview. From the phone itself it uploads fine, or set the iPhone camera to “Most Compatible” (JPEG).'
    : 'Saved the original, but this browser couldn’t read it to make a preview.'
}
