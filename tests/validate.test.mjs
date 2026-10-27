import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the extension is a Manifest V3 new tab with user-selected image URL access", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.chrome_url_overrides.newtab, "newtab.html");
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("bookmarks"));
  assert.equal(manifest.permissions.includes("sessions"), false);
  assert.equal(manifest.permissions.includes("identity"), false);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
});

test("application code persists locally and only downloads user-selected icon URLs", async () => {
  const source = await readFile(new URL("app.js", root), "utf8");
  assert.match(source, /chrome\.storage\.local/);
  assert.doesNotMatch(source, /chrome\.storage\.sync/);
  assert.match(source, /async function selectDialIconUrl\(\)/);
  assert.match(source, /const response = await fetch\(url\)/);
  assert.doesNotMatch(source, /XMLHttpRequest|WebSocket/);
});

test("Speed Dial 2 exports preserve their groups and dials locally", async () => {
  const source = await readFile(new URL("app.js", root), "utf8");
  const markup = await readFile(new URL("newtab.html", root), "utf8");

  assert.match(source, /function convertSpeedDial2Export\(value\)/);
  assert.match(source, /String\(dial\?\.idgroup\)/);
  assert.match(source, /typeof value\.preferences === "object"/);
  assert.match(source, /value\.dials\.every\(\(dial\) => dial && dial\.idgroup !== undefined/);
  assert.match(source, /speed-dial-2-group-/);
  assert.match(source, /settings: state\.settings/);
  assert.match(source, /convertSpeedDial2Export\(imported\)/);
  assert.match(markup, /Importar copia o Speed Dial 2/);
});

test("bookmarks use the complete browser tree grouped by folders", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const source = await readFile(new URL("app.js", root), "utf8");
  const markup = await readFile(new URL("newtab.html", root), "utf8");
  const styles = await readFile(new URL("styles.css", root), "utf8");

  assert.ok(manifest.permissions.includes("bookmarks"));
  assert.equal(manifest.permissions.includes("sessions"), false);
  assert.match(source, /chrome\.bookmarks\.getTree\(\)/);
  assert.match(source, /function bookmarkFolder/);
  assert.doesNotMatch(source, /chrome\.sessions|getRecentlyClosed|slice\(0, 500\)/);
  assert.doesNotMatch(markup, /data-panel="recent"|Pestañas recientes/);
  assert.match(styles, /\.bookmark-folder/);
});

test("closing the bookmarks panel restores focus before hiding it", async () => {
  const source = await readFile(new URL("app.js", root), "utf8");
  const markup = await readFile(new URL("newtab.html", root), "utf8");
  const closePanel = source.match(/function closePanel\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(markup, /<aside[^>]*id="side-panel"[^>]*\sinert(?:\s|>)/);
  assert.match(source, /elements\.panel\.inert = false/);
  assert.match(closePanel, /elements\.panel\.inert = true/);
  assert.ok(closePanel.indexOf("#bookmarks-button") < closePanel.indexOf('aria-hidden", "true"'));
});

test("custom backgrounds are optimized and remain local", async () => {
  const source = await readFile(new URL("app.js", root), "utf8");
  const markup = await readFile(new URL("newtab.html", root), "utf8");
  assert.match(source, /createImageBitmap/);
  assert.match(source, /toBlob\(resolve, "image\/webp"/);
  assert.match(source, /customBackground/);
  assert.match(markup, /accept="image\/png,image\/jpeg,image\/webp"/);
});

test("dials can use optimized local custom icons", async () => {
  const source = await readFile(new URL("app.js", root), "utf8");
  const markup = await readFile(new URL("newtab.html", root), "utf8");

  assert.match(markup, /id="dial-icon-mode"/);
  assert.match(markup, /id="dial-icon-file"[^>]*accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(markup, /id="dial-icon-url"/);
  assert.match(source, /MAX_DIAL_ICON_DATA_LENGTH = 128 \* 1024/);
  assert.match(source, /128 \/ bitmap\.width, 128 \/ bitmap\.height/);
  assert.match(source, /const iconUrl = dial\.icon \?\? faviconUrl\(dial\.url\)/);
  assert.match(source, /icon: iconMode === "custom" \? pendingDialIcon : null/);
  assert.match(source, /pendingDialIcon = await optimizeDialIcon\(await response\.blob\(\)\)/);
});

test("bundled image backgrounds are local and selectable", async () => {
  const source = await readFile(new URL("app.js", root), "utf8");
  const markup = await readFile(new URL("newtab.html", root), "utf8");
  const styles = await readFile(new URL("styles.css", root), "utf8");
  const presets = ["lake-dawn", "quiet-forest", "sunrise-coast"];

  await Promise.all(presets.map(async (preset) => {
    assert.match(source, new RegExp(`"${preset}"`));
    assert.match(markup, new RegExp(`value="${preset}"`));
    assert.match(styles, new RegExp(`backgrounds/${preset}\\.jpg`));
    assert.ok((await readFile(new URL(`backgrounds/${preset}.jpg`, root))).length > 100_000);
  }));
});

test("dialog close controls never submit their forms", async () => {
  const markup = await readFile(new URL("newtab.html", root), "utf8");
  const source = await readFile(new URL("app.js", root), "utf8");
  const closeButtons = [...markup.matchAll(/<button[^>]*data-close-dialog[^>]*>/g)].map(([button]) => button);
  assert.equal(closeButtons.length, 5);
  closeButtons.forEach((button) => assert.match(button, /type="button"/));
  assert.match(source, /closest\("dialog"\)\?\.close\("cancel"\)/);
});

test("settings uses a centered symmetric gear icon", async () => {
  const markup = await readFile(new URL("newtab.html", root), "utf8");
  assert.match(markup, /id="settings-button"[\s\S]*?<circle cx="12" cy="12" r="3"/);
  assert.match(markup, /class="settings-icon"/);
});

test("group management uses a geometrically centered ellipsis", async () => {
  const markup = await readFile(new URL("newtab.html", root), "utf8");
  const styles = await readFile(new URL("styles.css", root), "utf8");

  assert.match(markup, /id="manage-group-button"[\s\S]*?class="ellipsis-icon"/);
  assert.doesNotMatch(markup, /id="manage-group-button"[^>]*>•••<\/button>/);
  assert.match(styles, /\.manage-group\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;[\s\S]*?padding:\s*0;/);
  assert.match(styles, /\.ellipsis-icon\s*\{[\s\S]*?box-shadow:\s*-7px 0 currentColor, 7px 0 currentColor;/);
});

test("the add-site card centers its icon and label as one block", async () => {
  const styles = await readFile(new URL("styles.css", root), "utf8");

  assert.match(styles, /\.add-card\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;[\s\S]*?gap:\s*18px;/);
  assert.match(styles, /\.add-card span:first-child\s*\{[\s\S]*?line-height:\s*1;/);
});

test("dials support persisted manual, title, and domain ordering", async () => {
  const source = await readFile(new URL("app.js", root), "utf8");
  const markup = await readFile(new URL("newtab.html", root), "utf8");

  assert.match(markup, /id="dial-order-select"/);
  assert.match(markup, /value="manual"[\s\S]*?value="title"[\s\S]*?value="domain"/);
  assert.match(source, /dialOrder: \["manual", "title", "domain"\]/);
  assert.match(source, /leftValue\.localeCompare\(rightValue, "es", \{ sensitivity: "base", numeric: true \}\)/);
  assert.match(source, /card\.draggable = state\.settings\.dialOrder === "manual"/);
  assert.match(source, /state\.settings = \{\s*\.\.\.state\.settings,/);
});

test("manual dial reordering takes precedence over nested link dragging", async () => {
  const source = await readFile(new URL("app.js", root), "utf8");
  const styles = await readFile(new URL("styles.css", root), "utf8");

  assert.match(source, /link\.draggable = false/);
  assert.match(source, /favicon\.draggable = false/);
  assert.match(source, /event\.dataTransfer\?\.setData\("text\/plain", dial\.id\)/);
  assert.match(source, /effectAllowed = "move"/);
  assert.match(styles, /\.dial-link\s*\{[\s\S]*?-webkit-user-drag:\s*none;/);
  assert.match(styles, /\.dial-card\.drag-over/);
});

test("all manifest entry points exist", async () => {
  const files = ["newtab.html", "app.js", "styles.css", "service-worker.js"];
  await Promise.all(files.map(async (file) => assert.ok((await readFile(new URL(file, root))).length > 0)));
});
