import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const marker = ".ginger-dial-build";
const sharedDirectory = join(appRoot, "shared");
const platformsDirectory = join(appRoot, "platforms");
const platforms = ["chrome", "firefox"];
const sharedFiles = ["app.js", "newtab.html", "styles.css"];
const iconSizes = [16, 32, 48, 128];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([typeBuffer, data])),
    8 + data.length,
  );
  return chunk;
}

function iconPixel(size, x, y) {
  const nx = (x + 0.5) / size;
  const ny = (y + 0.5) / size;
  const radius = 0.24;
  const dx = Math.max(Math.abs(nx - 0.5) - (0.5 - radius), 0);
  const dy = Math.max(Math.abs(ny - 0.5) - (0.5 - radius), 0);
  if (dx * dx + dy * dy > radius * radius) return [0, 0, 0, 0];

  const red = Math.round(244 - 27 * ny);
  const green = Math.round(170 - 74 * ny);
  const blue = Math.round(97 - 17 * nx);
  const distance = Math.hypot(nx - 0.5, ny - 0.5);
  const ring =
    distance >= 0.18 &&
    distance <= 0.32 &&
    !(nx > 0.52 && ny > 0.32 && ny < 0.49);
  const bar = nx >= 0.49 && nx <= 0.73 && ny >= 0.49 && ny <= 0.58;
  return ring || bar ? [255, 248, 241, 255] : [red, green, blue, 255];
}

function createPngIcon(size) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1);
    rows[rowOffset] = 0;
    for (let x = 0; x < size; x += 1) {
      const [red, green, blue, alpha] = iconPixel(size, x, y);
      const pixelOffset = rowOffset + 1 + x * 4;
      rows[pixelOffset] = red;
      rows[pixelOffset + 1] = green;
      rows[pixelOffset + 2] = blue;
      rows[pixelOffset + 3] = alpha;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyIfPresent(source, destination) {
  if (await exists(source)) {
    await cp(source, destination, { recursive: true });
  }
}

async function prepareOutput(platform) {
  const output = join(appRoot, platform);
  if (await exists(output)) {
    const outputMarker = join(output, marker);
    if (!(await exists(outputMarker))) {
      throw new Error(
        `Refusing to replace ${output}: it is not a Ginger Dial build output.`,
      );
    }
    await rm(output, { recursive: true, force: true });
  }
  await mkdir(output, { recursive: true });
  return output;
}

async function buildPlatform(platform) {
  const output = await prepareOutput(platform);
  await Promise.all(
    sharedFiles.map((file) =>
      cp(join(sharedDirectory, file), join(output, file)),
    ),
  );
  await copyIfPresent(
    join(sharedDirectory, "backgrounds"),
    join(output, "backgrounds"),
  );
  const platformDirectory = join(platformsDirectory, platform);
  const entries = await readdir(platformDirectory);
  await Promise.all(
    entries.map((entry) =>
      cp(join(platformDirectory, entry), join(output, entry), {
        recursive: true,
      }),
    ),
  );
  const iconsDirectory = join(output, "icons");
  await mkdir(iconsDirectory);
  await Promise.all(
    iconSizes.map(async (size) => {
      const iconName = `icon-${size}.png`;
      const localIcon = join(sharedDirectory, "icons", iconName);
      const generatedIcon = join(iconsDirectory, iconName);
      if (await exists(localIcon)) {
        await cp(localIcon, generatedIcon);
        return;
      }
      await writeFile(generatedIcon, createPngIcon(size));
    }),
  );
  await writeFile(join(output, marker), `${platform}\n`, "utf8");
}

await Promise.all(platforms.map(buildPlatform));
const chromeManifest = JSON.parse(
  await readFile(join(appRoot, "chrome", "manifest.json"), "utf8"),
);
const firefoxManifest = JSON.parse(
  await readFile(join(appRoot, "firefox", "manifest.json"), "utf8"),
);
if (
  chromeManifest.background?.service_worker !== "background.js" ||
  firefoxManifest.background?.scripts?.[0] !== "background.js"
) {
  throw new Error(
    "Generated browser manifests do not contain their expected background entry points.",
  );
}
