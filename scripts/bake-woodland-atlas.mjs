/** Bake the distant grove with the same Three.js models, leaf geometry and cutout materials as the village.
 * Run from the repository root: node scripts/bake-woodland-atlas.mjs (requires Playwright Chromium).
 * Set CHROME_CHANNEL=chrome to use an installed Chrome instead.
 */
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const web = resolve('elsewhere/web');
const requireWeb = createRequire(resolve(web, 'package.json'));
const { createServer } = await import(
  pathToFileURL(
    requireWeb.resolve('vite/package.json').replace(/package\.json$/, 'dist/node/index.js'),
  )
);
const { default: appConfig } = await tsImport('../elsewhere/web/vite.config.ts', import.meta.url);
const server = await createServer({
  root: web,
  configFile: false,
  server: {
    host: '127.0.0.1',
    port: 0,
    // This offline build tool serves only public renderer inputs and dependencies.
    fs: { ...appConfig.server.fs, allow: [web, resolve('node_modules')] },
  },
  logLevel: 'error',
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || undefined });
  const page = await browser.newPage();
  await page.route('**/__woodland-bake', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Woodland bake</title>' }),
  );
  await page.goto(new URL('__woodland-bake', server.resolvedUrls.local[0]).href);
  const image = await page.evaluate(async () => {
    // Resolve the identical Three instance Vite used for the runtime's instanceof checks.
    const source = await (await fetch('/src/forest.ts')).text();
    const T = await import(source.match(/^import \* as THREE from "([^"]+)"/m)[1]);
    const { worldAssetLoader, WORLD_ASSETS } = await import('/src/worldAssets.ts');
    const { createEnvironmentMaterials } = await import('/src/materials.ts');
    const { addTreeCrowns } = await import('/src/treeCrowns.ts');
    const renderer = new T.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    const size = 384;
    renderer.setSize(size, size);
    renderer.setClearColor(0, 0);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    const scene = new T.Scene(),
      sun = new T.DirectionalLight(0xffecd7, 3.1);
    sun.position.set(-3, 8, 5);
    scene.add(sun, new T.HemisphereLight(0xeaf5ff, 0xbbc4a4, 2.3));
    const materials = createEnvironmentMaterials(renderer);
    const atlas = document.createElement('canvas');
    atlas.width = size * 3;
    atlas.height = size;
    const ctx = atlas.getContext('2d');
    let notify;
    const assets = worldAssetLoader(
      scene,
      () => true,
      ({ status }) => {
        if (status !== 'pending') notify(status);
      },
    );
    const models = [
      WORLD_ASSETS.forestTreeLow,
      WORLD_ASSETS.treeLow,
      WORLD_ASSETS.treeAlternativeLow,
    ];
    for (const [i, url] of models.entries()) {
      const root = new T.Group(),
        model = new T.Group();
      scene.add(root);
      root.add(model);
      const ready = new Promise((resolve) => {
        notify = resolve;
      });
      assets(model, url, { height: 1, anchorXZ: 'origin' });
      if (i !== 2) addTreeCrowns(root, [{ x: 0, y: 0, z: 0, height: 1 }], materials, i === 1);
      if (i === 1) root.children.find((child) => child.name === 'Orchard apples').visible = false;
      if ((await ready) !== 'loaded') throw Error('Tree model failed: ' + url);
      await materials.ready();
      // The asset loader enqueues attachment after its load notification.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      root.rotation.y = [0.5, -0.6, 1.88][i];
      root.updateMatrixWorld(true);
      const center = new T.Box3().setFromObject(root).getCenter(new T.Vector3());
      const camera = new T.OrthographicCamera(-0.81, 0.81, 1.06, -0.02, 0.01, 20);
      camera.position.set(center.x, 0, 4);
      camera.lookAt(center.x, 0, 0);
      renderer.render(scene, camera);
      ctx.drawImage(renderer.domElement, i * size, 0);
      root.removeFromParent();
    }
    return atlas.toDataURL('image/webp', 0.91).split(',')[1];
  });
  await writeFile(
    resolve(web, 'public/assets/polyhaven/models/woodland-horizon.webp'),
    Buffer.from(image, 'base64'),
  );
} finally {
  await browser?.close();
  await server.close();
}
