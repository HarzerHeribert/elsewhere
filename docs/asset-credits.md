# Elsewhere asset credits

Elsewhere ships a small set of third-party CC0 assets: Poly Haven surface scans, sky, trees, plants and a rock, and one AssetQuest bird. Thank you to their authors for making them freely available. Everything else in the world is authored in this repository.

## Authored world objects

Furniture, lanterns, signs, the gate, tools, instruments, flowers, ground cover and meadow grass are built in code from the world's own design language (`elsewhere/web/src/worldStyle.ts`, `craft.ts`, `flora.ts`). They use the Poly Haven timber and stone scans listed below and the shared paint palette; no model pack supplies them. The Kenney Nature, Fantasy Town and Furniture models that earlier versions shipped have been removed.

## Poly Haven ground, path and stone textures

Three unmodified **1K diffuse/albedo JPEGs** from Poly Haven are included under **CC0-1.0**. The official asset license is https://polyhaven.com/license and the CC0 terms are https://creativecommons.org/publicdomain/zero/1.0/ . Credit is optional under CC0; we retain the original artists and sources below.

| Local file                           | Original asset                       | Intended use                |
| ------------------------------------ | ------------------------------------ | --------------------------- |
| `polyhaven/leafy_grass_diff_1k.jpg`  | https://polyhaven.com/a/leafy_grass  | Grass and ground detail     |
| `polyhaven/grass_path_2_diff_1k.jpg` | https://polyhaven.com/a/grass_path_2 | Earth and small-stone paths |
| `polyhaven/stone_wall_diff_1k.jpg`   | https://polyhaven.com/a/stone_wall   | Stone wall surfaces         |

Paths are relative to `elsewhere/web/public/assets/`. These three images total **2,748,379 bytes**, are each **1024 × 1024** pixels, and are served locally. No external CDN is needed at runtime. Their diffuse maps use sRGB color; the companion normal and roughness maps are listed below. Displacement maps are not shipped.

Original download URLs, API metadata endpoints, artist credits, byte sizes, upstream MD5 checksums and SHA-256 hashes are retained in `elsewhere/web/public/assets/polyhaven/manifest.json`. All three downloaded files match the official API's expected size and MD5 hash and passed JPEG signature checks. A source license declaration is retained in `elsewhere/web/public/assets/polyhaven/LICENSE.txt`.

The Poly Haven API was used only while importing these selected files; the deployed application does not call that API.

## Poly Haven PBR companion maps

The grass, path and stone materials also include the six original **1K OpenGL normal and roughness JPEGs** imported alongside their diffuse maps. These are linear data maps; the normal maps use OpenGL Y+ convention. Their original artists and CC0 license are the same as the corresponding diffuse textures above. Exact download URLs, upstream MD5 checksums, SHA-256 hashes and sizes are retained in `elsewhere/web/public/assets/polyhaven/pbr-manifest.json`. The six files total **4,618,061 bytes**.

## Poly Haven daylight sky and environment

The scene includes **Kloofendal 48d Partly Cloudy Pure Sky**, a 1K HDRI from Poly Haven, under **CC0-1.0**:

- Asset: https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
- License: https://polyhaven.com/license
- File: `elsewhere/web/public/assets/polyhaven/kloofendal_48d_partly_cloudy_puresky_1k.hdr`
- Provenance and original artist credits: `polyhaven/sky-manifest.json`.

The **1,435,119-byte**, **1024 × 512** HDR file matches the official API's size and MD5 checksum and was successfully decoded by Three.js RGBELoader. It is a linear HDR environment, not an sRGB albedo image, and is served locally with no runtime API or CDN dependency.

## Rendering references

The atmosphere uses the installed Three.js `HDRLoader` and `PMREMGenerator` for the local HDR background and environment lighting. Three.js's [HDR environment example](https://threejs.org/examples/webgl_materials_envmaps_hdr.html) and [Sky shader example](https://threejs.org/examples/webgl_shaders_sky.html) informed this setup. The analytic `Sky` addon supplies a loading/failure fallback. Three.js is distributed under the [MIT license](https://github.com/mrdoob/three.js/blob/dev/LICENSE).

The continuous distant terrain and instanced forest silhouettes are project-authored geometry. Imported close-up assets, local sky imagery and their licenses are listed above. Daylight is currently a stable visual setting; the background does not simulate the displayed character clock's day/night cycle.

## AssetQuest bird

The local `assetquest/brown-bird.glb` is **Brown Bird by AssetQuest**, from the [creator's Poly Pizza upload](https://poly.pizza/m/aDrUGRtDcm), declared **Public Domain / CC0 1.0**. The creator's website is https://assetquest.itch.io/ . License terms and the source declaration are retained in `assetquest/LICENSE.txt`; the source URL, exact SHA-256, file size and scene bounds are in `assetquest/manifest.json`.

The original unmodified GLB is 15,596 bytes and 194 triangles, with one embedded PNG palette and no external dependencies. Geometry loaded through Three.js GLTFLoader using a Node-only image placeholder for bounds; the embedded PNG signature and dimensions were verified separately. Actual palette decoding is checked in the browser. Runtime scaling and non-metallic material styling are separate from the source binary. This static model has no authored animation clips; behavior animation is supplied by the renderer.

## Original Hubert creature

Hubert's continuous body mesh, paddle feet, feelers, facial details, skin pattern, movement poses and SVG portrait are original work authored in this project. Their shared shape and palette are defined in `characters/hubert/appearance.json`. The implementation is in `elsewhere/web/src/HubertCreature.ts` and `HubertPortrait.tsx`. Human visitor models remain separate from Hubert's creature design.

## Detailed Poly Haven trees, plants and rock

Six additional official **Poly Haven CC0** assets supply modeled trunks and branches, cutout foliage and scanned surfaces. Files live under `elsewhere/web/public/assets/polyhaven/models/<id>/`; each folder retains `model-high.glb`, `model-low.glb`, a source/derived-file manifest and the license declaration. These GLBs reference native 1K PBR images through relative local `../textures/<sha256>.jpg` or `.png` URLs. The 33 content-addressed images are shared across high and low detail. No runtime CDN, decoder extension or Poly Haven API is required. All twelve model URLs remain available, including the fern, shrub and rock low models retained as an asset library.

| Asset and source                                         | Original artists          | High / low triangles |
| -------------------------------------------------------- | ------------------------- | -------------------: |
| [Small Tree 02](https://polyhaven.com/a/tree_small_02)   | Rico Cilliers             |     205,063 / 41,225 |
| [Island Tree 02](https://polyhaven.com/a/island_tree_02) | Rob Tuytel; Rico Cilliers |     295,043 / 56,896 |
| [Fir Sapling](https://polyhaven.com/a/fir_sapling)       | Rob Tuytel; Rico Cilliers |     125,919 / 31,312 |
| [Fern 02](https://polyhaven.com/a/fern_02)               | Rob Tuytel; Rico Cilliers |        2,384 / 1,192 |
| [Shrub 02](https://polyhaven.com/a/shrub_02)             | Rico Cilliers             |        7,590 / 3,792 |
| [Rock 07](https://polyhaven.com/a/rock_07)               | Jenelle van Heerden       |       14,844 / 5,194 |

License: https://polyhaven.com/license and https://creativecommons.org/publicdomain/zero/1.0/ . Source URLs, official API byte sizes and MD5 checksums, original SHA-256 hashes, artists, selected variants, bake ratios/error limits, output hashes and native geometry bounds are recorded in each `manifest.json`. Each model variant also lists every relative image dependency with its size, MIME type and SHA-256, plus a length-framed hash of its non-image bufferView bytes.

The offline project-authored `scripts/bake-environment-assets.mjs` uses glTF Transform 4.5.1 and meshoptimizer 1.3.0 to select one native variant, remove preview translations, prune unused variants, weld/deduplicate and simplify geometry. Tree trunk XZ origins are preserved; the renderer positions and scales the measured base and height. Island Tree 02 starts at 1,072,213 triangles and the selected fir at 157,402. Native source geometry and textures are retained in a temporary build cache. To reproduce the bake, restore the exact source files listed in each manifest into `<source-cache>/<id>/`, install the locked pnpm development dependencies, then run `node scripts/bake-environment-assets.mjs <source-cache>`. The script checks source sizes and SHA-256 hashes before transforming them. Each model's `source-inputs/provenance.json` and `source-inputs/info.json` retain the two additional metadata inputs; their hashes and retained paths are recorded in `buildInputs`. These retained copies are used when the source cache does not contain them. No download is performed by either bake script.

Alpha-atlas preparation requires Python 3 and **Pillow 12.2.0**, with **libjpeg-turbo 3.1.4.1** and **zlib 1.2.12** for matching JPEG decode and PNG encode bytes. The bake checks these versions before writing assets, and each manifest records the observed Python, Pillow, JPEG and zlib versions in `imageToolchain`. The retained bake used Python 3.14.7. An isolated reproduction can set `ELSEWHERE_ASSET_OUTPUT_ROOT=/tmp/elsewhere-rebake/models`; source metadata must be present in the source cache when using an empty output directory.

`node scripts/share-model-textures.mjs` can also repack existing baked models offline without any original source cache, Python or image encoder. It checks GLB headers, embedded ranges and PNG/JPEG signatures; copies each image byte-for-byte to its SHA-256 filename; remaps bufferViews; and verifies the unchanged geometry payload before replacing a model. Rerunning it preserves already shared model and image bytes. This packaging pass preserves all accessors, meshes, nodes, material parameters, samplers, texture transforms and image bytes. It does not simplify geometry or recompress textures.

The official glTF transport uses JPEG diffuse maps even for foliage whose source has an alpha channel. The bake therefore packs each original artist's separate 1K alpha PNG into its corresponding native diffuse RGB, losslessly producing an RGBA PNG. No colors were repainted. Fern and shrub retain their native MASK materials; broadleaf leaves retain their native BLEND material. The fir twig material explicitly uses MASK at 0.5 with double-sided leaves to restore the source cutouts. Normal/ARM maps and other native material parameters remain intact. The broadleaf also provides `leaves-diffuse-alpha.png` and original `leaves-alpha.png` for local decorative vine cards.

All twelve repacked GLBs passed header/length, local-dependency/hash and actual Three.js GLTFLoader geometry checks. Every non-image bufferView, image byte, accessor, node and material setting was compared against the previous embedded models; geometry and image content are identical. All 33 shared images decoded successfully with Pillow. Node geometry validation substitutes texture objects solely because Node has no browser image decoder; browser image decoding is a separate check. Bounds in the manifest are tight transformed mesh bounds; Three.js `Box3.setFromObject()` may conservatively overestimate rotated shrub bounds, so runtime normalization uses the loaded scene bounds.

The twelve former embedded GLBs totaled **82,149,252 bytes**. Their geometry GLBs now total **40,137,544 bytes**, plus **21,006,362 bytes** of shared image files: **21,005,346 bytes** saved with unchanged geometry and pixels. This is a retained-library file budget, including all low models; actual scene transfer depends on which variants load. Metadata, licenses and the stable vine-atlas URLs are counted separately.

The newer 2K masonry, timber and roof materials are documented separately in [material-credits.md](material-credits.md).

The lush green **Small Tree 02** supplement starts at 2,062,487 native triangles and retains separate branch, leaf and trunk primitives with original PBR maps. Its high bake targets 10% geometry with a 0.003 error threshold, and its low bake targets 2% with a 0.008 threshold. Both geometry GLBs and their shared images total **18,522,350 bytes**, replacing **24,820,240 bytes** of embedded GLBs without changing either level's triangle count. Original leaf diffuse/alpha inspection found a full 0–255 alpha range, 63.1% opaque atlas coverage and green-dominant color in 89.6% of opaque pixels; no recoloring was applied. It keeps the native BLEND leaf material and restored artist alpha. The existing Island Tree 02 remains available for orchard variation.

## Wooded horizon

The distant tree atlas at `elsewhere/web/public/assets/polyhaven/models/woodland-horizon.webp` contains three transparent views of the shipped Poly Haven Tree Small 02, Island Tree 02 and Fir Sapling under the CC0 license documented above. The two broadleaf views include the village's leaf clusters, positioned at the source models' branch tips. The playable trees retain their three-dimensional trunks and crowns. To regenerate the atlas locally from the checked-in models and materials, run `node scripts/bake-woodland-atlas.mjs` from the repository root with Playwright Chromium installed. Set `CHROME_CHANNEL=chrome` to use the installed Chrome browser.
