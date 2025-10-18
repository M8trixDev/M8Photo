// EXIF orientation parsing and canvas transformation utilities
// Supports reading EXIF orientation from JPEG files and applying the correct
// transform to a canvas when drawing the image.

function getArrayBuffer(input) {
  if (!input) return Promise.resolve(null);
  if (input instanceof ArrayBuffer) return Promise.resolve(input);
  if (input.buffer instanceof ArrayBuffer) return Promise.resolve(input.buffer);
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return input.arrayBuffer();
  }
  return Promise.resolve(null);
}

function getUint16(view, offset, little) {
  try {
    return view.getUint16(offset, little);
  } catch (e) {
    return 0;
  }
}

function getUint32(view, offset, little) {
  try {
    return view.getUint32(offset, little);
  } catch (e) {
    return 0;
  }
}

export async function readEXIFOrientation(input) {
  try {
    const buffer = await getArrayBuffer(input);
    if (!buffer || buffer.byteLength < 12) {
      return 1;
    }

    const view = new DataView(buffer);

    // JPEG SOI marker
    if (getUint16(view, 0, false) !== 0xffd8) {
      return 1;
    }

    let offset = 2;
    const length = view.byteLength;

    while (offset + 4 < length) {
      const marker = getUint16(view, offset, false);
      offset += 2;

      // Start of Scan - no more metadata
      if (marker === 0xffda) {
        break;
      }

      const size = getUint16(view, offset, false);
      if (size < 2) break;

      if (marker === 0xffe1) {
        // APP1 - EXIF
        const exifHeader = [
          view.getUint8(offset + 2),
          view.getUint8(offset + 3),
          view.getUint8(offset + 4),
          view.getUint8(offset + 5),
          view.getUint8(offset + 6),
        ];
        const isExif =
          exifHeader[0] === 0x45 && // E
          exifHeader[1] === 0x78 && // x
          exifHeader[2] === 0x69 && // i
          exifHeader[3] === 0x66 && // f
          exifHeader[4] === 0x00; // NUL

        if (!isExif) {
          offset += size;
          continue;
        }

        const tiffOffset = offset + 8;
        const endianness = getUint16(view, tiffOffset, false);
        const little = endianness === 0x4949; // 'II'
        if (endianness !== 0x4949 && endianness !== 0x4d4d) {
          return 1;
        }

        const fixed = getUint16(view, tiffOffset + 2, little);
        if (fixed !== 0x002a) {
          return 1;
        }

        const firstIFDOffset = getUint32(view, tiffOffset + 4, little);
        if (firstIFDOffset <= 0) {
          return 1;
        }

        let dirOffset = tiffOffset + firstIFDOffset;
        if (dirOffset + 2 > length) {
          return 1;
        }

        const entries = getUint16(view, dirOffset, little);
        for (let i = 0; i < entries; i += 1) {
          const entryOffset = dirOffset + 2 + i * 12;
          if (entryOffset + 12 > length) break;
          const tag = getUint16(view, entryOffset, little);

          // Orientation tag 0x0112
          if (tag === 0x0112) {
            const type = getUint16(view, entryOffset + 2, little);
            const count = getUint32(view, entryOffset + 4, little);
            if (type === 3 && count === 1) {
              const value = getUint16(view, entryOffset + 8, little);
              if (value >= 1 && value <= 8) {
                return value;
              }
            } else {
              // In some files, value may be stored out-of-line
              const valueOffset = getUint32(view, entryOffset + 8, little);
              const raw = getUint16(view, tiffOffset + valueOffset, little);
              if (raw >= 1 && raw <= 8) {
                return raw;
              }
            }
          }
        }

        // If reached here, orientation not found in EXIF
        return 1;
      } else {
        // Skip marker payload
        offset += size;
      }
    }
  } catch (error) {
    // Ignore malformed EXIF
  }

  return 1;
}

export function applyOrientationToCanvas(image, orientation = 1) {
  const sourceWidth = image.naturalWidth || image.videoWidth || image.width;
  const sourceHeight = image.naturalHeight || image.videoHeight || image.height;

  const swap = orientation >= 5 && orientation <= 8;
  const targetWidth = swap ? sourceHeight : sourceWidth;
  const targetHeight = swap ? sourceWidth : sourceHeight;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, targetWidth);
  canvas.height = Math.max(1, targetHeight);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Apply EXIF orientation transform
  switch (orientation) {
    case 2: // horizontal flip
      ctx.translate(targetWidth, 0);
      ctx.scale(-1, 1);
      break;
    case 3: // 180 rotate
      ctx.translate(targetWidth, targetHeight);
      ctx.rotate(Math.PI);
      break;
    case 4: // vertical flip
      ctx.translate(0, targetHeight);
      ctx.scale(1, -1);
      break;
    case 5: // transpose
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6: // rotate 90 CW
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -targetWidth);
      break;
    case 7: // transverse
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(targetHeight, -targetWidth);
      ctx.scale(-1, 1);
      break;
    case 8: // rotate 90 CCW
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-targetHeight, 0);
      break;
    default:
      break;
  }

  ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  return canvas;
}

export async function loadImageElementFromFile(file) {
  return new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
        resolve(img);
      };
      img.onerror = (e) => {
        try {
          URL.revokeObjectURL(url);
        } catch (err) {}
        reject(new Error("Failed to load image"));
      };
      img.src = url;
    } catch (error) {
      reject(error);
    }
  });
}
