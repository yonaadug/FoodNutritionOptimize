/**
 * Server-side image checks before anything reaches a model. The browser already
 * downscales to JPEG, so this is the safety net for direct API calls and for
 * photos the browser couldn't shrink.
 *
 * - The type comes from the bytes, never the file name or the claimed type.
 * - Dimensions are read from the header before decoding, so a small file that
 *   decompresses to a huge bitmap is rejected without allocating it.
 * - JPEG metadata (EXIF, which can include GPS location) is removed.
 * - Oversized JPEGs are shrunk with jpeg-js (pure JS, no native code, keeping the
 *   Lambda bundle small). next.config.js deliberately excludes sharp. Other formats
 *   pass through when they fit, since Claude downsamples what it receives.
 */
import type { ImageMediaType } from './types';

/** Long edge sent to the model: legible for printed text, about 2,350 tokens. */
export const MAX_EDGE_PX = 1568;
/** Refuse to decode beyond this (a 12 MP phone photo is well under it). */
const MAX_DECODE_MEGAPIXELS = 40;
const MAX_DIMENSION_PX = 8000;
/** Bedrock's per-image limit for base64 images, applied to every provider. */
export const MAX_MODEL_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface ImageInfo { mediaType: ImageMediaType; width: number; height: number }

export class ImageError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = 'ImageError';
        this.status = status;
    }
}

function jpegInfo(b: Uint8Array): { width: number; height: number } | null {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let i = 2;
    while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        if (marker === 0xff) { i++; continue; }
        if (marker >= 0xd0 && marker <= 0xd9) { i += 2; continue; }
        const len = view.getUint16(i + 2);
        // SOF0-15 except DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
        }
        i += 2 + len;
    }
    return null;
}

function webpInfo(b: Uint8Array): { width: number; height: number } | null {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8X' && b.length >= 30) {
        return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
    if (chunk === 'VP8 ' && b.length >= 30) {
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L' && b.length >= 25) {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
}

/** HEIC/HEIF (iPhone default): an ISO-BMFF "ftyp" box with a HEIF brand. No model API accepts it. */
export function isHeif(b: Uint8Array): boolean {
    if (b.length < 12) return false;
    const box = String.fromCharCode(...b.subarray(4, 12));
    return box.startsWith('ftyp') && ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(box.slice(4));
}

/** Identify an image from its bytes. Null when it isn't a supported, readable image. */
export function sniffImage(b: Uint8Array): ImageInfo | null {
    if (b.length < 16) return null;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
        const d = jpegInfo(b);
        return d && { mediaType: 'image/jpeg', ...d };
    }
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b.length >= 24) {
        return { mediaType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
    }
    const ascii = String.fromCharCode(...b.subarray(0, 12));
    if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) {
        return { mediaType: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP' && b.length >= 30) {
        const d = webpInfo(b);
        return d && { mediaType: 'image/webp', ...d };
    }
    return null;
}

/**
 * Remove APP1 (EXIF, XMP) and APP13 (IPTC, Photoshop) segments from a JPEG. The
 * pixels aren't touched. This also drops the orientation tag, so a directly
 * uploaded phone photo may reach the model rotated; the browser path re-encodes
 * upright first, and Claude can read rotated text.
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const keep: Uint8Array[] = [b.subarray(0, 2)];
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
        const marker = b[i + 1];
        if (marker === 0xda) break; // Start of scan: the rest is image data.
        if (marker === 0xff) { i++; continue; }
        if (marker >= 0xd0 && marker <= 0xd9) { keep.push(b.subarray(i, i + 2)); i += 2; continue; }
        const end = i + 2 + view.getUint16(i + 2);
        if (end > b.length) return b; // Malformed: don't guess.
        if (marker !== 0xe1 && marker !== 0xed) keep.push(b.subarray(i, end));
        i = end;
    }
    keep.push(b.subarray(i));
    const out = new Uint8Array(keep.reduce((s, k) => s + k.length, 0));
    let offset = 0;
    for (const k of keep) { out.set(k, offset); offset += k.length; }
    return out;
}

/** Average source pixels into each target pixel (RGBA). Good for large reductions; no ringing on text. */
export function boxDownscale(src: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number): Uint8Array {
    const dst = new Uint8Array(dstW * dstH * 4);
    for (let y = 0; y < dstH; y++) {
        const y0 = Math.floor((y * srcH) / dstH);
        const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / dstH));
        for (let x = 0; x < dstW; x++) {
            const x0 = Math.floor((x * srcW) / dstW);
            const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / dstW));
            let r = 0, g = 0, b = 0, n = 0;
            for (let sy = y0; sy < y1; sy++) {
                for (let sx = x0; sx < x1; sx++) {
                    const p = (sy * srcW + sx) * 4;
                    r += src[p]; g += src[p + 1]; b += src[p + 2];
                    n++;
                }
            }
            const q = (y * dstW + x) * 4;
            dst[q] = r / n; dst[q + 1] = g / n; dst[q + 2] = b / n; dst[q + 3] = 255;
        }
    }
    return dst;
}

/** Target size that fits the long edge, or null if the image already fits. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } | null {
    const long = Math.max(width, height);
    if (long <= maxEdge) return null;
    const scale = maxEdge / long;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface PreparedImage {
    base64: string;
    mediaType: ImageMediaType;
    width: number;
    height: number;
    downscaled: boolean;
}

/** Validate and shrink an uploaded image. Throws ImageError with a message for the user. */
export async function prepareImage(bytes: Uint8Array, maxUploadBytes: number = DEFAULT_MAX_UPLOAD_BYTES): Promise<PreparedImage> {
    if (bytes.length > maxUploadBytes) {
        throw new ImageError(413, `That photo is too large. The limit is ${Math.floor(maxUploadBytes / (1024 * 1024))} MB.`);
    }
    const info = sniffImage(bytes);
    if (!info && isHeif(bytes)) {
        throw new ImageError(415, 'That\'s an HEIC photo, which we can\'t read yet. Please send it as a JPEG: on an iPhone, share or export it as JPEG, or set Camera > Formats to Most Compatible.');
    }
    if (!info) throw new ImageError(415, 'We can read JPEG, PNG, WebP or GIF photos. Please try one of those.');
    const { mediaType, width, height } = info;
    if (!(width > 0 && height > 0) || width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX || (width * height) / 1e6 > MAX_DECODE_MEGAPIXELS) {
        throw new ImageError(413, 'That photo\'s dimensions are too large. Please use a smaller one.');
    }

    let out = bytes;
    let w = width;
    let h = height;
    let downscaled = false;
    if (mediaType === 'image/jpeg') {
        const target = fitWithin(width, height, MAX_EDGE_PX);
        if (target) {
            const jpeg = (await import('jpeg-js')).default;
            let decoded: { data: Uint8Array; width: number; height: number };
            try {
                decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512, maxResolutionInMP: MAX_DECODE_MEGAPIXELS });
            } catch {
                throw new ImageError(415, 'We couldn\'t read that photo. It may be damaged. Please try another.');
            }
            const data = boxDownscale(decoded.data, decoded.width, decoded.height, target.width, target.height);
            out = jpeg.encode({ data, width: target.width, height: target.height }, 85).data;
            w = target.width;
            h = target.height;
            downscaled = true;
        } else {
            out = stripJpegMetadata(bytes);
        }
    }
    if (out.length > MAX_MODEL_IMAGE_BYTES) {
        throw new ImageError(413, 'That photo is too large to read. Please save it as a JPEG or use a smaller one.');
    }
    return { base64: Buffer.from(out).toString('base64'), mediaType, width: w, height: h, downscaled };
}

/** Rough vision tokens for a size: one per 28x28 px patch. */
export function imageTokenEstimate(width: number, height: number): number {
    return Math.ceil(width / 28) * Math.ceil(height / 28);
}

