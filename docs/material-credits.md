# Architecture material sources

Elsewhere uses the following unmodified, photo-scanned 2K materials from [Poly Haven](https://polyhaven.com/). All are released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/), as confirmed by the [official asset license](https://polyhaven.com/license). Commercial use and redistribution are permitted; credits are retained for provenance.

| Material                                                     | Author credits                                               | Native tile coverage |
| ------------------------------------------------------------ | ------------------------------------------------------------ | -------------------- |
| [Stone Wall](https://polyhaven.com/a/stone_wall)             | Dario Barresi (processing), Charlotte Baglioni (photography) | 2 × 2 metres         |
| [Weathered Planks](https://polyhaven.com/a/weathered_planks) | Dario Barresi (processing), Dimitrios Savva (photography)    | 2 × 2 metres         |
| [Roof Tiles 14](https://polyhaven.com/a/roof_tiles_14)       | Rob Tuytel                                                   | 1.5 × 1.5 metres     |

Each material includes 2048 × 2048 JPG diffuse, OpenGL normal, and roughness maps. Nine files total 19,475,849 bytes (18.57 MiB). Diffuse maps use sRGB; normal and roughness maps contain linear data. The normal maps use the OpenGL positive-Y convention. Ambient occlusion and displacement maps are omitted.

Files live in `elsewhere/web/public/assets/polyhaven/materials/`. Its `manifest.json` records every original download URL, byte size, upstream MD5 and verified local SHA-256. Source metadata came from the official `api.polyhaven.com/files/{id}` and `api.polyhaven.com/info/{id}` endpoints on November 8, 2026, with an identifying Elsewhere user agent in accordance with the API terms. These shipped files require no runtime third-party requests.

`elsewhere/web/src/materials.ts` shares decoded source images and creates independent texture transforms for surfaces. The material scale above is a guide for UVs: photo textures must be applied to surface UVs rather than imported palette UVs. This material pack does not change simulation geometry or collision footprints.

Foliage models and any included alpha-cutout atlases are credited separately in [asset-credits.md](./asset-credits.md).
