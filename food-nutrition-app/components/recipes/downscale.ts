/**
 * Shrink a photo in the browser before upload: at most 1568 px on the long edge,
 * JPEG quality 85. A phone photo goes from several MB to a few hundred KB, which
 * saves upload time and model tokens. Drawing to a canvas applies the EXIF
 * orientation and drops all metadata, including GPS location.
 *
 * If the browser can't decode the file (HEIC outside Safari, say), the original is
 * returned and the server decides whether it can read it.
 */
const MAX_EDGE = 1568;
const QUALITY = 0.85;

export async function downscaleForUpload(file: File): Promise<Blob> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        return file;
    }
    try {
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
        return blob ?? file;
    } finally {
        bitmap.close();
    }
}
