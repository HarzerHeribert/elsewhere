# Elsewhere asset credits

Elsewhere includes selected 3D models by **Kenney**, from **Nature Kit 2.1**, under **Creative Commons Zero 1.0 Universal (CC0-1.0)**. Thank you to Kenney for making these assets freely available.

- Official creator and pack: https://kenney.nl/assets/nature-kit
- License: https://creativecommons.org/publicdomain/zero/1.0/
- Original license text: `elsewhere/web/public/assets/kenney/nature/License.txt`
- Import manifest, exact file hashes and dependencies: `elsewhere/web/public/assets/kenney/nature/manifest.json`
- Retrieved: November 8, 2026.

Kenney's official pack page identifies this pack as CC0. Its retained original license permits personal, educational and commercial use and says attribution is optional. We retain this credit and the license as provenance.

## Download provenance

The official archive is:

https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip

The creator-hosted download returned HTTP 403 in the build environment. The selected unmodified files were therefore retrieved from this public mirror, which retains the original Kenney license and archive provenance:

https://github.com/rajsinghtech/spurfire/tree/8792fe1404eabd93ff12dd0726460da5db648b02/game/assets/kenney/nature-kit

Mirror commit: `8792fe1404eabd93ff12dd0726460da5db648b02`.

This is a small selected import, not an entire third-party repository or archive. No downloaded installer, script or executable was run. Models are served locally; they do not require a CDN or runtime connection to the creator or mirror.

## Shipped models

| File               | Use                        |
| ------------------ | -------------------------- |
| `tree_default.glb` | Small broadleaf trees      |
| `tree_oak.glb`     | Larger oak silhouettes     |
| `rock_largeA.glb`  | Rocks near paths and water |
| `rock_smallA.glb`  | Smaller landscape stones   |
| `fence_simple.glb` | Low wooden fences          |
| `fence_gate.glb`   | Garden gates and entrances |
| `sign.glb`         | Landmark signposts         |
| `cactus_short.glb` | Small planting specimens   |
| `cactus_tall.glb`  | Taller planting specimens  |

All paths are under `elsewhere/web/public/assets/kenney/nature/`.

## Verification

All nine binaries passed GLB magic, version, declared-length and JSON-chunk checks. They also loaded successfully through the project’s actual Three.js GLTFLoader in Node, with non-empty meshes and finite scene bounding boxes. Every model declares glTF 2.0 and contains meshes and scenes. The selected models have no external buffer or image URIs and need no separately shipped textures. Individual SHA-256 hashes and byte sizes are recorded in the manifest.

The nine model files total **91,584 bytes**. The manifest's `sourceAccessorBounds` are mesh-accessor bounds, not fully transformed scene bounds; the renderer should normalize each loaded scene using its actual world-space bounding box. Suggested target heights are scene styling defaults and do not modify source binaries.

The project-authored terrain, paths, lighting, interface, characters and any remaining procedural geometry are separate from these imported assets.

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

## Kenney Fantasy Town Kit architecture and props

Twenty-three selected models from **Kenney Fantasy Town Kit 2.0** supply actual modular stone and timber walls, windows, open doorways, arches, roof pieces, pillars, a lantern, bench, stool, green market stall, fountain and watermill.

- Creator's official pack page: https://kenney.nl/assets/fantasy-town-kit
- Creator's OpenGameArt upload: https://opengameart.org/content/fantasy-town-kit
- Download used: https://opengameart.org/sites/default/files/kenney_fantasy-town-kit_2.0.zip
- Archive SHA-256: `1a7530c09f4d2fa2cdee259876f089334f8b1f27fa86a0c4f54ef86cdd8676ef`
- License: **CC0-1.0**, confirmed on the creator's page and in the archive's original `License.txt`.
- Files and original license: `elsewhere/web/public/assets/kenney/town/`.

Only explicitly selected archive entries were read; no archive was extracted wholesale and no downloaded code was executed. Each original `colormap.png` palette image was embedded into its corresponding GLB so the models are self-contained. Meshes, material settings and image pixels remain unchanged. The 23 GLBs total **599,840 bytes**.

`town/manifest.json` records original archive entries, original and transformed file hashes, actual scene bounds and triangle counts. The actual Three.js GLTFLoader loaded their scene graphs and geometry for bounds; a placeholder texture hook was used for that Node-only bounds pass because Node has no image decoder. Embedded PNG signatures were checked independently, and normal browser loading uses the original palette images.

The modules are small and have purposeful pivots. Native wall pieces lie in the YZ plane, typically span 1 unit in Y and Z, and sit at X=0.4 to 0.5. Positioning should use measured bounds and preserve door openings; decorative art does not change authoritative collision geometry.

## Kenney Furniture Pack props

Eleven selected models from the creator's **Furniture Pack 1.0** upload supply a bench, two bookcases, books, chair, table, desk, potted plant, floor lamp, box and radio.

- Creator's current furniture page: https://kenney.nl/assets/furniture-kit
- Creator's OpenGameArt upload: https://opengameart.org/content/furniture-kit
- Original download: https://opengameart.org/sites/default/files/kenney_furniturePack.zip
- Original license retained at `elsewhere/web/public/assets/kenney/furniture/License.txt`.
- License: **CC0-1.0**, as stated in the actual downloaded archive.

This older creator upload contains OBJ geometry and MTL colors. The selected models were converted to self-contained GLB with the project's Three.js OBJLoader, MTLLoader and GLTFExporter. Mesh geometry and source colors were preserved; Phong materials were mapped to rough, non-metallic standard materials for glTF compatibility. No downloaded scripts or installers were run. All eleven exported GLBs were loaded again through the actual GLTFLoader and passed header, dependency and finite-bounds checks. They total **219,396 bytes**.

`furniture/manifest.json` records archive provenance, source OBJ/MTL hashes, converted GLB hashes and actual scene bounds. Furniture uses larger source units and offset pivots; normalize the loaded group by its measured bounds rather than sharing the town kit's scale.

## Poly Haven daylight sky and environment

The scene includes **Kloofendal 48d Partly Cloudy Pure Sky**, a 1K HDRI from Poly Haven, under **CC0-1.0**:

- Asset: https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
- License: https://polyhaven.com/license
- File: `elsewhere/web/public/assets/polyhaven/kloofendal_48d_partly_cloudy_puresky_1k.hdr`
- Provenance and original artist credits: `polyhaven/sky-manifest.json`.

The **1,435,119-byte**, **1024 × 512** HDR file matches the official API's size and MD5 checksum and was successfully decoded by Three.js RGBELoader. It is a linear HDR environment, not an sRGB albedo image, and is served locally with no runtime API or CDN dependency.

## Additional Nature Kit ground foliage

Eight more unmodified **Kenney Nature Kit 2.1** models add small-scale vegetation and pond detail: `grass.glb`, `grass_large.glb`, `grass_leafsLarge.glb`, `plant_bushDetailed.glb`, `flower_redA.glb`, `flower_yellowA.glb`, `lily_large.glb` and `mushroom_redGroup.glb`. They are under `elsewhere/web/public/assets/kenney/nature/` and total **91,388 bytes**.

These files came directly from the creator's OpenGameArt upload, https://opengameart.org/content/nature-kit , using https://opengameart.org/sites/default/files/Nature%20Kit%20%282.1%29.zip . The downloaded archive's SHA-256 is `fa7974a0d342bfe63c38664ba9f8ec1a4aab8ea25f099bdc56870e33588c4d9d`, matching the original Nature Kit archive provenance above. The retained CC0 license applies to these models too.

Only the eight explicit GLB entries were read from the archive. All passed GLB header/length/JSON checks and loaded through the actual Three.js GLTFLoader with finite non-empty bounds. They contain no external buffer or image references. Source entry names, file hashes, actual scene bounds and suggested scale are included in the existing nature manifest.

Their source feet sit at Y=-0.05; the renderer should normalize the actual base before placing them. `grass_leafsLarge` is a low, spreading leafy clump, not a tall reed. Lily pads should be scaled by their footprint as well as height when arranging the pond surface. Decorative foliage does not change authoritative walkable paths or collision geometry.

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
