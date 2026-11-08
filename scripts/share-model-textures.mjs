/** Lossless, offline GLB image sharing. No geometry decoding or image encoding.
 * Usage: node scripts/share-model-textures.mjs [polyhaven-models-directory]
 * Keeps every model URL; image URIs resolve relative to its containing directory.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, relative, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const align4 = (size) => Math.ceil(size / 4) * 4;
const supportedExtensions = new Set([
  'KHR_materials_ior',
  'KHR_materials_specular',
  'KHR_texture_transform',
]);

export function readGLB(bytes) {
  if (
    bytes.length < 28 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw Error('Invalid GLB header');
  const chunks = [];
  for (let offset = 12; offset < bytes.length; ) {
    const length = bytes.readUInt32LE(offset),
      type = bytes.readUInt32LE(offset + 4);
    if (length % 4 || offset + 8 + length > bytes.length) throw Error('Invalid GLB chunk');
    chunks.push({ type, bytes: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  if (chunks.length !== 2 || chunks[0].type !== 0x4e4f534a || chunks[1].type !== 0x004e4942)
    throw Error('Expected one JSON and one BIN chunk');
  const json = JSON.parse(chunks[0].bytes.toString('utf8'));
  for (const extension of json.extensionsUsed ?? [])
    if (!supportedExtensions.has(extension)) throw Error('Unreviewed GLB extension: ' + extension);
  if (
    json.buffers?.length !== 1 ||
    json.buffers[0].uri ||
    json.buffers[0].byteLength > chunks[1].bytes.length
  )
    throw Error('Expected one embedded GLB buffer');
  for (const view of json.bufferViews ?? [])
    if (
      view.buffer !== 0 ||
      !Number.isInteger(view.byteLength) ||
      (view.byteOffset ?? 0) < 0 ||
      (view.byteOffset ?? 0) + view.byteLength > json.buffers[0].byteLength
    )
      throw Error('Invalid bufferView');
  return { json, bin: chunks[1].bytes };
}

function writeGLB(json, bin) {
  const encoded = Buffer.from(JSON.stringify(json)),
    jsonChunk = Buffer.alloc(align4(encoded.length), 0x20),
    binChunk = Buffer.alloc(align4(bin.length));
  encoded.copy(jsonChunk);
  bin.copy(binChunk);
  const bytes = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binChunk.length);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonChunk.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(bytes, 20);
  const offset = 20 + jsonChunk.length;
  bytes.writeUInt32LE(binChunk.length, offset);
  bytes.writeUInt32LE(0x004e4942, offset + 4);
  binChunk.copy(bytes, offset + 8);
  return bytes;
}

function imageExtension(bytes, mime) {
  if (
    mime === 'image/png' &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png';
  if (mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpg';
  throw Error('Only unchanged, signature-checked PNG/JPEG images are supported');
}

function viewBytes(bin, view) {
  return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}

/** Length-framed hashes preserve bufferView boundaries as well as every data byte. */
function payloadHash(json, bin, excluded = new Set()) {
  const hash = createHash('sha256');
  for (const [index, view] of (json.bufferViews ?? []).entries())
    if (!excluded.has(index)) {
      const length = Buffer.alloc(8);
      length.writeBigUInt64LE(BigInt(view.byteLength));
      hash.update(length);
      hash.update(viewBytes(bin, view));
    }
  return hash.digest('hex');
}

/** Also supports already-shared GLBs, so rerunning never changes their bytes. */
export async function externalizeModelTextures(
  file,
  textureDirectory = join(dirname(dirname(file)), 'textures'),
) {
  const original = await readFile(file),
    { json, bin } = readGLB(original);
  const imageViews = new Set(
    (json.images ?? []).flatMap((image) =>
      image.bufferView === undefined ? [] : [image.bufferView],
    ),
  );
  const geometryBufferViewsSha256 = payloadHash(json, bin, imageViews);
  const dependencies = new Map();
  await mkdir(textureDirectory, { recursive: true });
  for (const image of json.images ?? []) {
    let bytes, destination;
    if (image.bufferView !== undefined) {
      const view = json.bufferViews[image.bufferView];
      if (!view) throw Error('Missing image bufferView');
      bytes = viewBytes(bin, view);
      const extension = imageExtension(bytes, image.mimeType);
      destination = join(textureDirectory, `${sha256(bytes)}.${extension}`);
      let existing;
      try {
        existing = await readFile(destination);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (existing && !existing.equals(bytes)) throw Error('Content-addressed image collision');
      if (!existing) await writeFile(destination, bytes, { flag: 'wx' });
      image.uri = relative(dirname(file), destination).split(sep).join('/');
      delete image.bufferView;
    } else {
      if (!image.uri || image.uri.includes('\\') || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(image.uri))
        throw Error('Image dependencies must be local relative paths');
      destination = resolve(dirname(file), image.uri);
      const local = relative(resolve(textureDirectory), destination);
      if (local.startsWith('..') || local === '' || local.includes(sep))
        throw Error('Image dependency escapes shared texture directory');
      bytes = await readFile(destination);
      const extension = imageExtension(bytes, image.mimeType);
      if (destination !== resolve(textureDirectory, `${sha256(bytes)}.${extension}`))
        throw Error('Image path does not match its content hash');
    }
    dependencies.set(image.uri, {
      uri: image.uri,
      size: bytes.length,
      sha256: sha256(bytes),
      mimeType: image.mimeType,
    });
  }
  if (imageViews.size) {
    const remap = new Map(),
      chunks = [];
    let byteLength = 0;
    const views = [];
    for (const [index, view] of json.bufferViews.entries())
      if (!imageViews.has(index)) {
        remap.set(index, views.length);
        const bytes = viewBytes(bin, view),
          chunk = Buffer.alloc(align4(bytes.length));
        bytes.copy(chunk);
        chunks.push(chunk);
        views.push({ ...view, byteOffset: byteLength });
        byteLength += chunk.length;
      }
    function remapReferences(value) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'bufferView') {
          if (!remap.has(child)) throw Error('An image bufferView is referenced by non-image data');
          value[key] = remap.get(child);
        } else remapReferences(child);
      }
    }
    remapReferences(json);
    json.bufferViews = views;
    json.buffers[0].byteLength = byteLength;
    const nextBin = Buffer.concat(chunks),
      repacked = writeGLB(json, nextBin),
      checked = readGLB(repacked);
    if (payloadHash(checked.json, checked.bin) !== geometryBufferViewsSha256)
      throw Error('Geometry payload changed');
    // Only the validated final model is replaced; shared images were written first.
    await writeFile(file, repacked);
  }
  const bytes = await readFile(file);
  return {
    size: bytes.length,
    sha256: sha256(bytes),
    geometryBufferViewsSha256,
    externalDependencies: [...dependencies.values()],
  };
}

export const texturePackaging = {
  method: 'Byte-identical PNG/JPEG images shared by SHA-256 filename; relative local image URIs',
  script: 'scripts/share-model-textures.mjs',
  preservation:
    'Every non-image bufferView byte, accessor, mesh, node, material, sampler and texture setting is retained; no image encoding or geometry transformation',
};

async function main() {
  const root = resolve(process.argv[2] ?? 'elsewhere/web/public/assets/polyhaven/models');
  for (const entry of (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== 'textures')
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = join(root, entry.name),
      path = join(directory, 'manifest.json'),
      manifest = JSON.parse(await readFile(path, 'utf8'));
    for (const variant of manifest.variants)
      Object.assign(
        variant,
        await externalizeModelTextures(join(directory, variant.file), join(root, 'textures')),
      );
    manifest.transformation.operations = manifest.transformation.operations.filter(
      (operation) => typeof operation !== 'string' || !operation.includes('plain GLB embedding'),
    );
    manifest.transformation.texturePackaging = texturePackaging;
    await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
    console.log(
      JSON.stringify({
        id: entry.name,
        variants: manifest.variants.map(({ file, size, sha256 }) => ({ file, size, sha256 })),
      }),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
