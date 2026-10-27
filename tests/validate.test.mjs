import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../", import.meta.url);
const sharedRoot = new URL("../shared/", import.meta.url);
const chromeRoot = new URL("../chrome/", import.meta.url);
const firefoxRoot = new URL("../firefox/", import.meta.url);

async function readPackageFile(root, file) {
  return readFile(new URL(file, root), "utf8");
}

async function isPresent(root, file) {
  try {
    await stat(new URL(file, root));
    return true;
  } catch {
    return false;
  }
}

function chromeExtensionId(publicKey) {
  const digest = createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest()
    .subarray(0, 16);
  return [...digest.toString("hex")]
    .map((value) => String.fromCharCode(97 + Number.parseInt(value, 16)))
    .join("");
}

test("build creates self-contained Chrome and Firefox extension packages", async () => {
  const packageFiles = [
    "manifest.json",
    "background.js",
    "platform.js",
    "newtab.html",
    "app.js",
    "styles.css",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
    ".ginger-dial-build",
  ];
  await Promise.all(
    [chromeRoot, firefoxRoot].flatMap((root) =>
      packageFiles.map((file) => stat(new URL(file, root))),
    ),
  );

  const backgrounds = [
    "lake-dawn.jpg",
    "quiet-forest.jpg",
    "sunrise-coast.jpg",
  ];
  for (const background of backgrounds) {
    if (await isPresent(sharedRoot, `backgrounds/${background}`)) {
      await Promise.all(
        [chromeRoot, firefoxRoot].map((root) =>
          stat(new URL(`backgrounds/${background}`, root)),
        ),
      );
    }
  }
});

test("browser manifests preserve only their compatible background and permission models", async () => {
  const chrome = JSON.parse(await readPackageFile(chromeRoot, "manifest.json"));
  const firefox = JSON.parse(
    await readPackageFile(firefoxRoot, "manifest.json"),
  );

  assert.equal(chrome.manifest_version, 3);
  assert.equal(chrome.background.service_worker, "background.js");
  assert.ok(chrome.permissions.includes("favicon"));
  assert.deepEqual(chrome.host_permissions, ["<all_urls>"]);
  assert.match(chrome.key, /^MIIB/);
  assert.equal(
    chromeExtensionId(chrome.key),
    "chbmgiegdjfjhkkeglbcffdinjcefehj",
  );

  assert.equal(firefox.manifest_version, 3);
  assert.deepEqual(firefox.background.scripts, ["background.js"]);
  assert.equal(firefox.permissions.includes("favicon"), false);
  assert.deepEqual(firefox.optional_host_permissions, ["<all_urls>"]);
  assert.deepEqual(
    firefox.browser_specific_settings.gecko.data_collection_permissions
      .required,
    ["none"],
  );
  assert.match(firefox.browser_specific_settings.gecko.id, /@/);
  assert.equal(firefox.chrome_url_overrides.newtab, "newtab.html");
  assert.equal(chrome.icons[128], "icons/icon-128.png");
  assert.equal(firefox.icons[128], "icons/icon-128.png");
});

test("build emits valid PNG manifest icons without versioning output binaries", async () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const root of [chromeRoot, firefoxRoot]) {
    for (const size of [16, 32, 48, 128]) {
      const icon = await readFile(new URL(`icons/icon-${size}.png`, root));
      assert.deepEqual(icon.subarray(0, 8), signature);
      assert.equal(icon.readUInt32BE(16), size);
      assert.equal(icon.readUInt32BE(20), size);
    }
  }
});

test("shared application remains local and gates Firefox URL-icon downloads behind a permission", async () => {
  const source = await readPackageFile(sharedRoot, "app.js");

  assert.match(
    source,
    /const extensionApi = globalThis\.browser \?\? globalThis\.chrome/,
  );
  assert.match(source, /extensionApi\.storage\.local/);
  assert.doesNotMatch(source, /storage\.sync/);
  assert.match(source, /async function hasIconHostPermission/);
  assert.match(source, /extensionApi\.permissions\.request\(permission\)/);
  assert.match(source, /const response = await fetch\(url\.href\)/);
  assert.doesNotMatch(source, /XMLHttpRequest|WebSocket/);
});

test("platform configuration keeps Chrome favicons and gives Firefox a local fallback", async () => {
  const [chromePlatform, firefoxPlatform, source] = await Promise.all([
    readPackageFile(chromeRoot, "platform.js"),
    readPackageFile(firefoxRoot, "platform.js"),
    readPackageFile(sharedRoot, "app.js"),
  ]);

  assert.match(chromePlatform, /nativeFavicons: true/);
  assert.match(firefoxPlatform, /nativeFavicons: false/);
  assert.match(firefoxPlatform, /optionalIconHostPermission: true/);
  assert.match(source, /platform\.nativeFavicons/);
  assert.match(source, /letter\.textContent = dial\.title\.slice\(0, 1\)/);
  assert.match(source, /function applyPlatformLabels/);
  assert.match(source, /Inicial del sitio/);
});

test("new-tab pages initialize platform behavior before the shared application", async () => {
  const markup = await readPackageFile(sharedRoot, "newtab.html");

  assert.match(
    markup,
    /<script src="platform\.js"><\/script>\s*<script src="app\.js"><\/script>/,
  );
});

test("shared UI restores bundled brand and wallpaper assets", async () => {
  const [markup, styles, build] = await Promise.all([
    readPackageFile(sharedRoot, "newtab.html"),
    readPackageFile(sharedRoot, "styles.css"),
    readFile(new URL("scripts/build.mjs", appRoot), "utf8"),
  ]);

  assert.match(markup, /<img src="icons\/icon-48\.png" alt=""/);
  assert.match(styles, /\.brand img/);
  for (const background of [
    "lake-dawn.jpg",
    "quiet-forest.jpg",
    "sunrise-coast.jpg",
  ]) {
    assert.match(styles, new RegExp(`url\\("backgrounds/${background}\\"\\)`));
  }
  assert.match(build, /copyIfPresent\([\s\S]*"backgrounds"/);
});

test("toolbar actions create a portable blank new-tab request", async () => {
  const [chromeBackground, firefoxBackground] = await Promise.all([
    readPackageFile(chromeRoot, "background.js"),
    readPackageFile(firefoxRoot, "background.js"),
  ]);

  for (const source of [chromeBackground, firefoxBackground]) {
    assert.match(source, /extensionApi\.tabs\.create\(\{\}\)/);
    assert.doesNotMatch(source, /chrome:\/\/newtab/);
  }
});

test("documentation describes the generated browser packages and local-only behavior", async () => {
  const readme = await readFile(new URL("README.md", appRoot), "utf8");

  assert.match(readme, /`chrome\//);
  assert.match(readme, /`firefox\//);
  assert.match(readme, /permiso opcional/);
  assert.doesNotMatch(readme, /ni permisos de host/);
  assert.match(readme, /iconos y fondos versionados se incluyen/);
  assert.match(readme, /Cargar complemento temporal/);
  assert.match(readme, /Firefox la elimina al reiniciarse/);
  assert.match(readme, /\.xpi/);
  assert.match(readme, /assets\/screenshots\/ginger-dial-firefox\.png/);
  assert.match(readme, /Paquetes incluidos en esta rama/);
  assert.match(readme, /\| Chrome \| `chrome\/` \|/);
  assert.match(readme, /\| Firefox \| `firefox\/` \|/);
  assert.match(readme, /Google Chrome 120 o posterior/);
  assert.match(readme, /Firefox 128 o posterior/);
});
