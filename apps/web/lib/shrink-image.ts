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

export async function uploadPinPhoto(pinId: string, file: File) {
  const form = new FormData();
  form.set('file', await shrinkImage(file), 'pin.jpg');
  const res = await fetch(`/api/pins/${pinId}/photo`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'The photo did not upload.');
}
