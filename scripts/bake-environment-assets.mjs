/** Offline CC0 asset bake. Restore source files listed in each shipped manifest.
 * Usage: node scripts/bake-environment-assets.mjs /tmp/elsewhere-ph-source [asset-id ...]
 * Metadata inputs are retained in each model's source-inputs/ directory.
 * Requires the locked pnpm development dependencies and Python 3 with Pillow 12.2.0,
 * libjpeg-turbo 3.1.4.1 and zlib 1.2.12 for the original lossless alpha-atlas bake.
 * No network access, executable asset content, or runtime compression is used.
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { externalizeModelTextures, texturePackaging } from './share-model-textures.mjs';

const catalog = {
  tree_small_02: { high: 0.1, highError: 0.003, low: 0.02, alphaMaterial: 'leaves' },
  fir_sapling: { node: 'fir_sapling_a', alphaMaterial: 'fir_sapling_twigs', high: 0.8, low: 0.2 },
  island_tree_02: { high: 0.28, low: 0.055, alphaMaterial: 'leaves' },
  fern_02: { node: 'fern_02_b', alphaMaterial: 'fern_02', high: 1, low: 0.5 },
  shrub_02: { alphaMaterial: '', high: 1, low: 0.5 },
  rock_07: { high: 1, low: 0.35 },
};
const sourceRoot = resolve(process.argv[2] || '/tmp/elsewhere-ph-source');
// An isolated output directory lets the complete bake be compared with shipped assets.
const outputRoot = resolve(
  process.env.ELSEWHERE_ASSET_OUTPUT_ROOT || 'elsewhere/web/public/assets/polyhaven/models',
);
const ids = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(catalog);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const python = spawnSync(
  'python3',
  [
    '-c',
    'import sys,json,zlib; from PIL import Image,features; print(json.dumps({"python":sys.version.split()[0],"pillow":Image.__version__,"zlib":zlib.ZLIB_RUNTIME_VERSION,"jpeg":features.version_codec("jpg"),"libjpegTurbo":features.version_feature("libjpeg_turbo")}))',
  ],
  { encoding: 'utf8' },
);
if (python.status !== 0 || python.error)
  throw Error(
    'Asset bake requires Python 3 and Pillow; see docs/asset-credits.md. ' +
      (python.error?.message ?? python.stderr),
  );
const imageToolchain = JSON.parse(python.stdout);
for (const [name, version] of Object.entries({
  pillow: '12.2.0',
  zlib: '1.2.12',
  libjpegTurbo: '3.1.4.1',
}))
  if (imageToolchain[name] !== version)
    throw Error(
      `For reproducible atlas bytes, ${name} must be ${version}; found ${imageToolchain[name]}`,
    );
await MeshoptSimplifier.ready;
function stats(document) {
  let triangles = 0,
    primitives = 0;
  for (const mesh of document.getRoot().listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      primitives++;
      triangles +=
        (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3;
    }
  const bounds = getBounds(document.getRoot().getDefaultScene());
  return {
    triangles,
    primitives,
    meshes: document.getRoot().listMeshes().length,
    bounds,
    nativeHeight: bounds.max[1] - bounds.min[1],
    authoredRootXZ: [0, 0],
  };
}
for (const id of ids) {
  if (!catalog[id]) throw new Error('Unknown explicit asset ' + id);
  const config = catalog[id],
    sourceDir = join(sourceRoot, id),
    outputDir = join(outputRoot, id);
  await mkdir(outputDir, { recursive: true });
  let previousManifest;
  try {
    previousManifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const buildInputs = [];
  async function metadataInput(file, url) {
    let bytes;
    try {
      bytes = await readFile(join(sourceDir, file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      bytes = await readFile(join(outputDir, 'source-inputs', file));
    }
    const expected = previousManifest?.buildInputs?.find((input) => input.file === file);
    if (expected && (expected.size !== bytes.length || expected.sha256 !== hash(bytes)))
      throw Error('Metadata checksum mismatch: ' + file);
    await mkdir(join(outputDir, 'source-inputs'), { recursive: true });
    await writeFile(join(outputDir, 'source-inputs', file), bytes);
    buildInputs.push({
      file,
      retainedPath: `source-inputs/${file}`,
      size: bytes.length,
      sha256: hash(bytes),
      ...(url ? { url } : {}),
    });
    return JSON.parse(bytes.toString('utf8'));
  }
  const provenance = await metadataInput('provenance.json');
  for (const file of provenance.files) {
    const bytes = await readFile(join(sourceDir, file.path));
    if (bytes.length !== file.size || hash(bytes) !== file.sha256)
      throw new Error('Source checksum mismatch: ' + file.path);
  }
  const artistMetadata = await metadataInput('info.json', `https://api.polyhaven.com/info/${id}`);
  const source = JSON.parse(await readFile(join(sourceDir, 'source.gltf'), 'utf8'));
  const modifications = [];
  if (config.alphaMaterial !== undefined) {
    let material = source.materials.find((m) =>
      m.name?.toLowerCase().includes(config.alphaMaterial),
    );
    if (id === 'island_tree_02') material = source.materials.find((m) => /leav/i.test(m.name));
    if (!material) throw new Error('No leaf material ' + id);
    const texture = source.textures[material.pbrMetallicRoughness.baseColorTexture.index];
    const image = source.images[texture.source];
    const diffusePath = join(sourceDir, image.uri),
      alphaPath = join(sourceDir, 'textures/original_alpha.png');
    const rgbaPath = join(sourceDir, 'textures/leaf_diffuse_rgba.png');
    const result = spawnSync(
      'python3',
      [
        '-c',
        'from PIL import Image; import sys; rgb=Image.open(sys.argv[1]).convert("RGB"); a=Image.open(sys.argv[2]).convert("L"); assert rgb.size==a.size; out=rgb.convert("RGBA"); out.putalpha(a); out.save(sys.argv[3],optimize=True); print(a.getextrema())',
        diffusePath,
        alphaPath,
        rgbaPath,
      ],
      { encoding: 'utf8' },
    );
    if (result.status) throw new Error(result.stderr);
    image.uri = 'textures/leaf_diffuse_rgba.png';
    image.mimeType = 'image/png';
    if (id === 'fir_sapling') {
      material.alphaMode = 'MASK';
      material.alphaCutoff = 0.5;
      material.doubleSided = true;
    }
    modifications.push({
      operation: 'restore-leaf-alpha',
      detail: 'Original artist alpha PNG packed losslessly into native JPG RGB; no RGB repainting.',
      material: material.name,
      alphaMode: material.alphaMode || 'OPAQUE',
      alphaRange: result.stdout.trim(),
    });
    // Preserve stable local atlas URLs used by the decorative vines.
    if (id === 'island_tree_02') {
      await copyFile(rgbaPath, join(outputDir, 'leaves-diffuse-alpha.png'));
      await copyFile(alphaPath, join(outputDir, 'leaves-alpha.png'));
    }
  }
  await writeFile(join(sourceDir, 'prepared.gltf'), JSON.stringify(source));
  const variants = [];
  for (const [level, ratio, error] of [
    ['high', config.high, config.highError ?? 0.001],
    ['low', config.low, 0.008],
  ]) {
    const doc = await io.read(join(sourceDir, 'prepared.gltf'));
    const scene = doc.getRoot().getDefaultScene();
    const desired = config.node
      ? doc
          .getRoot()
          .listNodes()
          .find((n) => n.getName() === config.node)
      : scene.listChildren()[0];
    if (!desired) throw new Error('Missing desired variant ' + id);
    for (const child of scene.listChildren()) if (child !== desired) child.dispose();
    desired.setTranslation([0, 0, 0]);
    await doc.transform(prune(), dedup(), weld());
    const original = stats(doc);
    if (ratio < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error }));
    await doc.transform(prune(), dedup());
    const file = `model-${level}.glb`,
      destination = join(outputDir, file);
    await io.write(destination, doc);
    const measured = stats(await io.read(destination));
    const shared = await externalizeModelTextures(destination, join(outputRoot, 'textures'));
    variants.push({
      file,
      selectedNode: desired.getName(),
      ...shared,
      inputTriangles: original.triangles,
      targetRatio: ratio,
      error,
      ...measured,
    });
    console.log(JSON.stringify({ id, level, ...variants.at(-1) }), true);
  }
  const manifest = {
    ...provenance,
    name: artistMetadata.name,
    authors: artistMetadata.authors,
    buildInputs,
    imageToolchain,
    infoURL: `https://api.polyhaven.com/info/${id}`,
    importedAt: '2026-11-08',
    transformation: {
      tool: '@gltf-transform/core/functions/extensions 4.5.1 + meshoptimizer 1.3.0',
      script: 'scripts/bake-environment-assets.mjs',
      operations: [
        'select one native variant; remove preview translation; preserve authored XZ origin',
        ...modifications,
        'prune unused variants, dedup, weld, simplify within reported error bound',
        'GLB geometry with shared byte-identical native PBR images in relative local files; no runtime decoder required',
      ],
      texturePackaging,
      sourceCache: 'not shipped; files and hashes recorded below',
    },
    variants,
  };
  if (id === 'island_tree_02')
    manifest.atlases = await Promise.all(
      ['leaves-diffuse-alpha.png', 'leaves-alpha.png'].map(async (file) => {
        const bytes = await readFile(join(outputDir, file));
        return { file, size: bytes.length, sha256: hash(bytes) };
      }),
    );
  await writeFile(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await copyFile(
    resolve('elsewhere/web/public/assets/polyhaven/LICENSE.txt'),
    join(outputDir, 'LICENSE.txt'),
  );
}
