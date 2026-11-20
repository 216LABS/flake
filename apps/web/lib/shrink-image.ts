/**
 * Pin photos are reference pictures, not evidence, so they can be shrunk. That keeps them under the host's request
 * limit and small on storage. Visit photos never come through here: those keep their original bytes.
 */
export async function shrinkImage(file: File, longEdge = 1600, quality = 0.82): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob ?? file;
  } catch {
    return file; // A format this browser can't decode. The server still tries, and says so if it can't.
  }
}

/** HEIC/HEIF brands an iPhone (or an Android set to "high efficiency") writes. The server can't decode these. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** True for a HEIC/HEIF file, by its bytes: phones don't always label the type, and a renamed file says nothing. */
export async function isHeif(file: Blob): Promise<boolean> {
  if (/^image\/hei[cf]/i.test(file.type)) return true;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = String.fromCharCode(...head);
  return text.slice(4, 8) === 'ftyp' && HEIF_BRANDS.has(text.slice(8, 12));
}

/**
 * A JPEG copy of a HEIC visit photo, for the office, the customer and the proof PDF, which can't show HEIC. The original
 * is still what's stored as evidence. Null for any other format, or when this browser can't decode HEIC either.
 */
export async function heifViewCopy(file: Blob): Promise<Blob | null> {
  try {
    if (!(await isHeif(file))) return null;
    const out = await shrinkImage(file as File, 1600, 0.82);
    return out !== file && out.type === 'image/jpeg' ? out : null;
  } catch {
    return null;
  }
}

export async function uploadPinPhoto(pinId: string, file: File) {
  const form = new FormData();
  form.set('file', await shrinkImage(file), 'pin.jpg');
  const res = await fetch(`/api/pins/${pinId}/photo`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'The photo did not upload.');
}
