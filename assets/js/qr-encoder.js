/**
 * QR Code generator — byte mode, versions 1..20, all four ECC levels.
 * No dependencies, no network, no canvas required until you call drawToCanvas.
 *
 * Reference: ISO/IEC 18004. Capacity and alignment constants come from
 * ./qr-tables.js, which is generated from an authoritative implementation
 * rather than transcribed by hand.
 */

import { ALIGNMENT_CENTRES, RS_BLOCKS } from "./qr-tables.js";

const PAD_BYTES = [0xec, 0x11];
const ECC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

export const MAX_VERSION = RS_BLOCKS.length;

export class QrError extends Error {}

/** Expand the flat (count, total, data) runs for one version/level. */
function blockGroups(version, ecc) {
  const flat = RS_BLOCKS[version - 1][ECC_INDEX[ecc]];
  const groups = [];
  for (let i = 0; i < flat.length; i += 3) {
    groups.push({
      count: flat[i],
      total: flat[i + 1],
      data: flat[i + 2],
    });
  }
  return groups;
}

function dataCodewords(version, ecc) {
  return blockGroups(version, ecc).reduce(
    (sum, group) => sum + group.count * group.data,
    0,
  );
}

function charCountBits(version) {
  return version <= 9 ? 8 : 16;
}

export function utf8Bytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

function pickVersion(byteLength, ecc) {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const needed = 4 + charCountBits(version) + byteLength * 8;
    if (needed <= dataCodewords(version, ecc) * 8) return version;
  }
  throw new QrError(
    `النص أطول من سعة رمز QR القصوى (${dataCodewords(MAX_VERSION, "H")} بايت للمستوى الأعلى).`,
  );
}

function buildCodewords(bytes, version, ecc) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4);
  push(bytes.length, charCountBits(version));
  for (const b of bytes) push(b, 8);

  const capacityBits = dataCodewords(version, ecc) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  for (let pad = 0; codewords.length < capacityBits / 8; pad += 1) {
    codewords.push(PAD_BYTES[pad % 2]);
  }
  return codewords;
}

function reedSolomonDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = mulMod(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = mulMod(root, 0x02);
  }
  return result;
}

function mulMod(a, b) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((b >>> i) & 1) * a;
  }
  return z & 0xff;
}

function reedSolomonRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i += 1) {
      result[i] ^= mulMod(divisor[i], factor);
    }
  }
  return result;
}

function interleave(data, version, ecc) {
  const groups = blockGroups(version, ecc);
  const blockEccLen = groups[0].total - groups[0].data;
  const divisor = reedSolomonDivisor(blockEccLen);

  const blocks = [];
  let cursor = 0;
  for (const group of groups) {
    for (let n = 0; n < group.count; n += 1) {
      const dat = data.slice(cursor, cursor + group.data);
      cursor += group.data;
      blocks.push({ dat, eccBytes: reedSolomonRemainder(dat, divisor) });
    }
  }

  const result = [];
  const longestData = Math.max(...blocks.map((b) => b.dat.length));
  for (let i = 0; i < longestData; i += 1) {
    for (const block of blocks) {
      if (i < block.dat.length) result.push(block.dat[i]);
    }
  }
  for (let i = 0; i < blockEccLen; i += 1) {
    for (const block of blocks) result.push(block.eccBytes[i]);
  }
  return result;
}

function buildMatrix(version, ecc) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFn = (x, y, dark) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  for (const [originX, originY] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const x = originX + c;
        const y = originY + r;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const onRing = (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const onCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFn(x, y, onRing || onCore);
      }
    }
  }

  const centres = ALIGNMENT_CENTRES[version - 1] ?? [];
  for (const cy of centres) {
    for (const cx of centres) {
      if (reserved[cy][cx]) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const x = cx + c;
          const y = cy + r;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          setFn(x, y, r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i += 1) {
    if (!reserved[6][i]) setFn(i, 6, i % 2 === 0);
    if (!reserved[i][6]) setFn(6, i, i % 2 === 0);
  }
  drawFormatBits(modules, reserved, size, ecc, 0);
  if (version >= 7) {
    drawVersionBits(modules, reserved, size, version);
  }

  return { modules, reserved, size };
}

/**
 * The 15 format bits (2 ECC indicator + 3 mask, BCH(15,5) protected, then
 * masked with 0x5412) exist in two copies. Per ISO/IEC 18004 the first copy
 * runs down column 8 and the second runs leftwards along row 8, with different
 * skip positions around the top-left finder — getting these two transposed is
 * the classic way to produce a matrix that looks right and scans as garbage.
 */
function drawFormatBits(modules, reserved, size, ecc, mask) {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >>> i) & 1) === 1;
    const y = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    modules[y][8] = dark;
    reserved[y][8] = true;

    const x = i < 8 ? size - 1 - i : i === 8 ? 7 : 14 - i;
    modules[8][x] = dark;
    reserved[8][x] = true;
  }

  modules[size - 8][8] = true;
  reserved[size - 8][8] = true;
}

function drawVersionBits(modules, reserved, size, version) {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) === 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    modules[b][a] = bit;
    reserved[b][a] = true;
    modules[a][b] = bit;
    reserved[a][b] = true;
  }
}

function drawCodewords(modules, reserved, size, codewords) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!reserved[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i += 1;
        }
      }
    }
  }
}

function maskCondition(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

function penalty(modules, size) {
  let score = 0;

  const runScore = (run) => (run >= 5 ? 3 + (run - 5) : 0);

  for (let y = 0; y < size; y += 1) {
    let run = 1;
    for (let x = 1; x < size; x += 1) {
      if (modules[y][x] === modules[y][x - 1]) run += 1;
      else { score += runScore(run); run = 1; }
    }
    score += runScore(run);
  }
  for (let x = 0; x < size; x += 1) {
    let run = 1;
    for (let y = 1; y < size; y += 1) {
      if (modules[y][x] === modules[y - 1][x]) run += 1;
      else { score += runScore(run); run = 1; }
    }
    score += runScore(run);
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const v = modules[y][x];
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) {
        score += 3;
      }
    }
  }

  const pattern = [true, false, true, true, true, false, true];
  const hasAt = (get, i) => {
    for (let k = 0; k < 7; k += 1) if (get(i + k) !== pattern[k]) return false;
    return true;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x + 7 <= size; x += 1) {
      if (hasAt((i) => modules[y][i], x)) score += 40;
    }
  }
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y + 7 <= size; y += 1) {
      if (hasAt((i) => modules[i][x], y)) score += 40;
    }
  }

  let dark = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (modules[y][x]) dark += 1;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

function applyMask(modules, reserved, size, mask) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!reserved[y][x] && maskCondition(mask, x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

/**
 * @param {string} text
 * @param {{ ecc?: 'L'|'M'|'Q'|'H', minVersion?: number, mask?: 'auto'|number }} options
 *   `mask` pins a mask pattern instead of scoring all eight; pinning makes the
 *   output byte-for-byte deterministic, which is what the oracle tests use.
 * @returns {{ size: number, modules: boolean[][], version: number, ecc: string, mask: number }}
 */
export function encode(text, { ecc = "M", minVersion = 1, mask = "auto" } = {}) {
  if (!Object.hasOwn(ECC_INDEX, ecc)) throw new QrError(`مستوى تصحيح غير معروف: ${ecc}`);
  const bytes = utf8Bytes(text);
  const version = Math.max(pickVersion(bytes.length, ecc), minVersion);
  const codewords = interleave(buildCodewords(bytes, version, ecc), version, ecc);

  const render = (maskIndex) => {
    const { modules, reserved, size } = buildMatrix(version, ecc);
    drawCodewords(modules, reserved, size, codewords);
    applyMask(modules, reserved, size, maskIndex);
    drawFormatBits(modules, reserved, size, ecc, maskIndex);
    return { modules, size, score: penalty(modules, size) };
  };

  let best;
  if (mask === "auto") {
    best = null;
    for (let m = 0; m < 8; m += 1) {
      const candidate = render(m);
      if (!best || candidate.score < best.score) best = { ...candidate, mask: m };
    }
  } else {
    const pinned = render(mask);
    best = { ...pinned, mask };
  }

  return { size: best.size, modules: best.modules, version, ecc, mask: best.mask };
}

/** Render to a path string; caller injects the colour so it stays themeable. */
export function toPath(matrix) {
  const parts = [];
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (matrix.modules[y][x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join("");
}

export function drawToCanvas(canvas, matrix, { scale = 6, margin = 4 } = {}) {
  const dim = (matrix.size + margin * 2) * scale;
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = "#000000";
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (matrix.modules[y][x]) {
        ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
      }
    }
  }
  return canvas;
}
