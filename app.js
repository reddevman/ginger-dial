const STORAGE_KEY = "gingerDialState";
const BACKGROUND_PRESETS = new Set(["midnight", "aurora", "ember", "ocean", "meadow", "lake-dawn", "quiet-forest", "sunrise-coast", "plain", "custom"]);
const MAX_BACKGROUND_FILE_BYTES = 25 * 1024 * 1024;
const MAX_BACKGROUND_DATA_LENGTH = 8 * 1024 * 1024;
const MAX_DIAL_ICON_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DIAL_ICON_DATA_LENGTH = 128 * 1024;

const defaultState = {
  activeGroupId: "personal",
  groups: [
    { id: "personal", name: "Personal" },
    { id: "work", name: "Trabajo" },
    { id: "inspiration", name: "Inspiración" }
  ],
  dials: [
    { id: "gmail", groupId: "personal", title: "Gmail", url: "https://mail.google.com", color: "coral" },
    { id: "youtube", groupId: "personal", title: "YouTube", url: "https://youtube.com", color: "slate" },
    { id: "calendar", groupId: "personal", title: "Calendar", url: "https://calendar.google.com", color: "teal" },
    { id: "github", groupId: "work", title: "GitHub", url: "https://github.com", color: "slate" },
    { id: "drive", groupId: "work", title: "Google Drive", url: "https://drive.google.com", color: "amber" },
    { id: "figma", groupId: "inspiration", title: "Figma", url: "https://figma.com", color: "indigo" },
    { id: "dribbble", groupId: "inspiration", title: "Dribbble", url: "https://dribbble.com", color: "coral" }
  ],
  settings: { theme: "system", columns: 4, showUrls: true, backgroundPreset: "midnight", customBackground: null, backgroundShade: 28, dialOrder: "manual" }
};

const storage = {
  async get() {
    if (globalThis.chrome?.storage?.local) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] ?? structuredClone(defaultState);
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : structuredClone(defaultState);
  },
  async set(value) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: value });
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }
};

const elements = {
  tabs: document.querySelector("#group-tabs"),
  grid: document.querySelector("#dial-grid"),
  empty: document.querySelector("#empty-state"),
  template: document.querySelector("#dial-template"),
  search: document.querySelector("#search-input"),
  dialDialog: document.querySelector("#dial-dialog"),
  dialForm: document.querySelector("#dial-form"),
  groupDialog: document.querySelector("#group-dialog"),
  groupForm: document.querySelector("#group-form"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  panel: document.querySelector("#side-panel"),
  panelTitle: document.querySelector("#panel-title"),
  panelContent: document.querySelector("#panel-content"),
  panelSearch: document.querySelector("#panel-search-input"),
  scrim: document.querySelector("#panel-scrim"),
  dialOrder: document.querySelector("#dial-order-select")
};

let state = structuredClone(defaultState);
let draggedDialId = null;
let bookmarkTree = [];
let pendingCustomBackground = null;
let pendingDialIcon = null;

function normalizeUrl(rawUrl) {
  const value = rawUrl.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  const url = new URL(candidate);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Solo se permiten direcciones HTTP o HTTPS.");
  return url.href;
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function faviconUrl(url, size = 64) {
  if (globalThis.chrome?.runtime?.getURL) {
    return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=${size}`);
  }
  return "";
}

function hostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function sanitizeState(value) {
  if (!value || !Array.isArray(value.groups) || !Array.isArray(value.dials)) throw new Error("La copia no tiene un formato válido.");
  const groups = value.groups
    .filter((group) => group && typeof group.id === "string" && typeof group.name === "string")
    .map((group) => ({ id: group.id.slice(0, 80), name: group.name.trim().slice(0, 28) }))
    .filter((group) => group.name);
  if (!groups.length) throw new Error("La copia debe contener al menos un grupo.");
  const groupIds = new Set(groups.map((group) => group.id));
  const dials = value.dials.flatMap((dial) => {
    if (!dial || typeof dial.title !== "string" || !groupIds.has(dial.groupId)) return [];
    try {
      return [{
        id: typeof dial.id === "string" ? dial.id.slice(0, 100) : makeId("dial"),
        groupId: dial.groupId,
        title: dial.title.trim().slice(0, 48),
        url: normalizeUrl(String(dial.url)),
        color: ["indigo", "teal", "coral", "amber", "slate"].includes(dial.color) ? dial.color : "indigo",
        icon: typeof dial.icon === "string" && /^data:image\/(?:png|jpeg|webp);base64,/i.test(dial.icon) && dial.icon.length <= MAX_DIAL_ICON_DATA_LENGTH ? dial.icon : null
      }];
    } catch { return []; }
  });
  const requestedShade = Number(value.settings?.backgroundShade);
  const settings = {
    theme: ["system", "dark", "light"].includes(value.settings?.theme) ? value.settings.theme : "system",
    columns: Math.min(6, Math.max(3, Number(value.settings?.columns) || 4)),
    showUrls: value.settings?.showUrls !== false,
    backgroundPreset: BACKGROUND_PRESETS.has(value.settings?.backgroundPreset) ? value.settings.backgroundPreset : "midnight",
    customBackground: typeof value.settings?.customBackground === "string" && /^data:image\/(?:png|jpeg|webp);base64,/i.test(value.settings.customBackground) && value.settings.customBackground.length <= MAX_BACKGROUND_DATA_LENGTH ? value.settings.customBackground : null,
    backgroundShade: Number.isFinite(requestedShade) ? Math.min(70, Math.max(0, requestedShade)) : 28,
    dialOrder: ["manual", "title", "domain"].includes(value.settings?.dialOrder) ? value.settings.dialOrder : "manual"
  };
  if (settings.backgroundPreset === "custom" && !settings.customBackground) settings.backgroundPreset = "midnight";
  return { groups, dials, settings, activeGroupId: groupIds.has(value.activeGroupId) ? value.activeGroupId : groups[0].id };
}

function convertSpeedDial2Export(value) {
  const hasSpeedDial2Shape = value
    && typeof value.preferences === "object"
    && !Array.isArray(value.preferences)
    && Array.isArray(value.groups)
    && Array.isArray(value.dials)
    && value.groups.length > 0
    && value.groups.every((group) => group && group.id !== undefined && group.id !== null && typeof group.title === "string")
    && value.dials.every((dial) => dial && dial.idgroup !== undefined && dial.idgroup !== null && typeof dial.title === "string" && typeof dial.url === "string");
  if (!hasSpeedDial2Shape) return null;

  const groupIds = new Map();
  const groups = value.groups.flatMap((group, index) => {
    if (!group || group.id === undefined || group.id === null || typeof group.title !== "string") return [];
    const sourceId = String(group.id);
    if (groupIds.has(sourceId)) return [];
    const id = `speed-dial-2-group-${index}`;
    groupIds.set(sourceId, id);
    return [{ id, name: group.title }];
  });
  if (!groups.length) throw new Error("El archivo de Speed Dial 2 no contiene grupos válidos.");

  const colors = ["indigo", "teal", "coral", "amber", "slate"];
  const dials = value.dials.flatMap((dial, index) => {
    const groupId = groupIds.get(String(dial?.idgroup));
    if (!groupId || typeof dial?.title !== "string") return [];
    return [{
      id: `speed-dial-2-dial-${index}`,
      groupId,
      title: dial.title,
      url: dial.url,
      color: colors[index % colors.length]
    }];
  });

  return { groups, dials, settings: state.settings, activeGroupId: groups[0].id };
}

async function persist() {
  await storage.set(state);
}

function applySettings() {
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.background = state.settings.backgroundPreset;
  document.documentElement.style.setProperty("--columns", state.settings.columns);
  document.documentElement.style.setProperty("--background-shade", String(state.settings.backgroundShade / 100));
  document.documentElement.style.setProperty("--wallpaper", state.settings.backgroundPreset === "custom" && state.settings.customBackground ? `url("${state.settings.customBackground}")` : "");
  document.body.classList.toggle("hide-urls", !state.settings.showUrls);
}

function renderTabs() {
  elements.tabs.replaceChildren();
  state.groups.forEach((group) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-tab";
    button.role = "tab";
    button.textContent = group.name;
    button.dataset.groupId = group.id;
    button.setAttribute("aria-selected", String(group.id === state.activeGroupId));
    button.addEventListener("click", async () => {
      state.activeGroupId = group.id;
      elements.search.value = "";
      await persist();
      render();
    });
    elements.tabs.append(button);
  });
}

function renderDials() {
  elements.grid.replaceChildren();
  const query = elements.search.value.trim().toLocaleLowerCase();
  const matchingDials = state.dials.filter((dial) => dial.groupId === state.activeGroupId && (!query || `${dial.title} ${dial.url}`.toLocaleLowerCase().includes(query)));
  const dials = state.settings.dialOrder === "manual" ? matchingDials : [...matchingDials].sort((left, right) => {
    const property = state.settings.dialOrder === "domain" ? "url" : "title";
    const leftValue = property === "url" ? hostLabel(left.url) : left.title;
    const rightValue = property === "url" ? hostLabel(right.url) : right.title;
    return leftValue.localeCompare(rightValue, "es", { sensitivity: "base", numeric: true });
  });

  dials.forEach((dial) => {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    card.dataset.dialId = dial.id;
    card.classList.add(`color-${dial.color}`);
    card.draggable = state.settings.dialOrder === "manual";
    if (card.draggable) card.title = "Arrastra para reordenar";
    const link = card.querySelector(".dial-link");
    link.href = dial.url;
    link.title = `Abrir ${dial.title}`;
    link.draggable = false;
    card.querySelector(".dial-title").textContent = dial.title;
    card.querySelector(".dial-url").textContent = hostLabel(dial.url);
    const letter = card.querySelector(".dial-letter");
    letter.textContent = dial.title.slice(0, 1).toLocaleUpperCase();
    const favicon = card.querySelector(".dial-favicon");
    favicon.draggable = false;
    const iconUrl = dial.icon ?? faviconUrl(dial.url);
    if (iconUrl) {
      favicon.hidden = false;
      favicon.src = iconUrl;
      favicon.addEventListener("load", () => { letter.hidden = true; });
      favicon.addEventListener("error", () => { favicon.hidden = true; });
    } else favicon.hidden = true;
    card.querySelector(".dial-menu").addEventListener("click", () => openDialDialog(dial));
    card.addEventListener("dragstart", (event) => {
      draggedDialId = dial.id;
      event.dataTransfer?.setData("text/plain", dial.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      draggedDialId = null;
      card.classList.remove("dragging");
      document.querySelectorAll(".dial-card.drag-over").forEach((item) => item.classList.remove("drag-over"));
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("dragenter", () => {
      if (draggedDialId && draggedDialId !== dial.id) card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", (event) => {
      if (!card.contains(event.relatedTarget)) card.classList.remove("drag-over");
    });
    card.addEventListener("drop", async (event) => {
      event.preventDefault();
      card.classList.remove("drag-over");
      if (!draggedDialId || draggedDialId === dial.id) return;
      const from = state.dials.findIndex((item) => item.id === draggedDialId);
      const to = state.dials.findIndex((item) => item.id === dial.id);
      const [moved] = state.dials.splice(from, 1);
      state.dials.splice(to, 0, moved);
      await persist();
      renderDials();
    });
    elements.grid.append(card);
  });

  if (!query) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "dial-card add-card";
    add.innerHTML = "<span aria-hidden=\"true\">＋</span><span>Añadir sitio</span>";
    add.addEventListener("click", () => openDialDialog());
    elements.grid.append(add);
  }
  elements.empty.hidden = dials.length > 0 || !query;
}

function render() {
  applySettings();
  elements.dialOrder.value = state.settings.dialOrder;
  renderTabs();
  renderDials();
}

function openDialDialog(dial) {
  document.querySelector("#dial-dialog-title").textContent = dial ? "Editar sitio" : "Añadir sitio";
  document.querySelector("#dial-id").value = dial?.id ?? "";
  document.querySelector("#dial-title").value = dial?.title ?? "";
  document.querySelector("#dial-url").value = dial?.url ?? "";
  document.querySelector("#dial-color").value = dial?.color ?? "indigo";
  pendingDialIcon = dial?.icon ?? null;
  document.querySelector("#dial-icon-mode").value = pendingDialIcon ? "custom" : "favicon";
  updateDialIconControls();
  document.querySelector("#delete-dial-button").hidden = !dial;
  elements.dialDialog.showModal();
  document.querySelector("#dial-title").focus();
}

async function deleteDial() {
  const id = document.querySelector("#dial-id").value;
  if (!id) return;
  state.dials = state.dials.filter((dial) => dial.id !== id);
  await persist();
  elements.dialDialog.close();
  renderDials();
}

async function saveDial(event) {
  event.preventDefault();
  try {
    const id = document.querySelector("#dial-id").value;
    const iconMode = document.querySelector("#dial-icon-mode").value;
    if (iconMode === "custom" && !pendingDialIcon) {
      updateDialIconControls("Elige una imagen para usar un icono personalizado.");
      return;
    }
    const next = {
      id: id || makeId("dial"),
      groupId: state.activeGroupId,
      title: document.querySelector("#dial-title").value.trim(),
      url: normalizeUrl(document.querySelector("#dial-url").value),
      color: document.querySelector("#dial-color").value,
      icon: iconMode === "custom" ? pendingDialIcon : null
    };
    if (!next.title) return;
    const index = state.dials.findIndex((dial) => dial.id === id);
    if (index >= 0) state.dials[index] = next;
    else state.dials.push(next);
    await persist();
    elements.dialDialog.close();
    renderDials();
  } catch (error) {
    document.querySelector("#dial-url").setCustomValidity(error.message);
    document.querySelector("#dial-url").reportValidity();
  }
}

async function saveGroup(event) {
  event.preventDefault();
  const name = document.querySelector("#group-name").value.trim();
  if (!name) return;
  const id = document.querySelector("#group-id").value;
  if (id) {
    const group = state.groups.find((item) => item.id === id);
    if (group) group.name = name;
  } else {
    const group = { id: makeId("group"), name };
    state.groups.push(group);
    state.activeGroupId = group.id;
  }
  await persist();
  elements.groupDialog.close();
  elements.groupForm.reset();
  render();
}

function openGroupDialog(group = null) {
  document.querySelector("#group-dialog-title").textContent = group ? "Editar grupo" : "Nuevo grupo";
  document.querySelector("#group-id").value = group?.id ?? "";
  document.querySelector("#group-name").value = group?.name ?? "";
  document.querySelector("#save-group-button").textContent = group ? "Guardar" : "Crear grupo";
  document.querySelector("#delete-group-button").hidden = !group || state.groups.length === 1;
  elements.groupDialog.showModal();
  document.querySelector("#group-name").focus();
}

async function deleteGroup() {
  const id = document.querySelector("#group-id").value;
  if (!id || state.groups.length === 1) return;
  state.groups = state.groups.filter((group) => group.id !== id);
  state.dials = state.dials.filter((dial) => dial.groupId !== id);
  state.activeGroupId = state.groups[0].id;
  await persist();
  elements.groupDialog.close();
  render();
}

function panelRow(item) {
  const link = document.createElement("a");
  link.className = "panel-item";
  link.href = item.url;
  const icon = document.createElement("img");
  icon.alt = "";
  icon.src = faviconUrl(item.url, 32);
  const copy = document.createElement("span");
  copy.className = "panel-item-copy";
  const title = document.createElement("strong");
  title.textContent = item.title || hostLabel(item.url);
  const url = document.createElement("small");
  url.textContent = hostLabel(item.url);
  copy.append(title, url);
  link.append(icon, copy);
  return link;
}

function filterBookmarkTree(nodes, query) {
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const matches = `${node.title ?? ""} ${node.url ?? ""}`.toLocaleLowerCase().includes(query);
    if (node.url) return matches ? [node] : [];
    const children = matches ? (node.children ?? []) : filterBookmarkTree(node.children ?? [], query);
    return children.length ? [{ ...node, children }] : [];
  });
}

function countBookmarks(nodes) {
  return nodes.reduce((total, node) => total + (node.url ? 1 : countBookmarks(node.children ?? [])), 0);
}

function bookmarkFolder(node, depth, forceOpen) {
  const details = document.createElement("details");
  details.className = "bookmark-folder";
  details.open = forceOpen || depth === 0;
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.className = "bookmark-folder-title";
  title.textContent = node.title || "Marcadores";
  const count = document.createElement("span");
  count.className = "bookmark-folder-count";
  count.textContent = String(countBookmarks(node.children ?? []));
  summary.append(title, count);
  const children = document.createElement("div");
  children.className = "bookmark-folder-children";
  (node.children ?? []).forEach((child) => {
    children.append(child.url ? panelRow(child) : bookmarkFolder(child, depth + 1, forceOpen));
  });
  details.append(summary, children);
  return details;
}

async function loadBookmarksPanel() {
  elements.panelTitle.textContent = "Marcadores";
  elements.panelContent.innerHTML = '<p class="panel-empty">Cargando…</p>';
  elements.panelSearch.value = "";
  elements.panel.inert = false;
  elements.panel.classList.add("open");
  elements.panel.setAttribute("aria-hidden", "false");
  elements.scrim.hidden = false;
  try {
    bookmarkTree = globalThis.chrome?.bookmarks ? await chrome.bookmarks.getTree() : [];
  } catch { bookmarkTree = []; }
  renderBookmarks();
}

function renderBookmarks() {
  const query = elements.panelSearch.value.trim().toLocaleLowerCase();
  const nodes = filterBookmarkTree(bookmarkTree, query);
  elements.panelContent.replaceChildren();
  if (!nodes.length || countBookmarks(nodes) === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = globalThis.chrome?.runtime ? "No hay marcadores que mostrar." : "Los marcadores estarán disponibles al cargar la extensión en Chrome.";
    elements.panelContent.append(empty);
    return;
  }
  nodes.forEach((node) => {
    if (!node.title && !node.url) {
      (node.children ?? []).forEach((child) => elements.panelContent.append(child.url ? panelRow(child) : bookmarkFolder(child, 0, Boolean(query))));
      return;
    }
    elements.panelContent.append(node.url ? panelRow(node) : bookmarkFolder(node, 0, Boolean(query)));
  });
}

function closePanel() {
  if (!elements.panel.classList.contains("open")) return;
  document.querySelector("#bookmarks-button").focus({ preventScroll: true });
  elements.panel.inert = true;
  elements.panel.classList.remove("open");
  elements.panel.setAttribute("aria-hidden", "true");
  elements.scrim.hidden = true;
}

function openSettings() {
  document.querySelector("#theme-select").value = state.settings.theme;
  pendingCustomBackground = state.settings.customBackground;
  updateCustomBackgroundControls();
  const selectedBackground = document.querySelector(`input[name="background-preset"][value="${state.settings.backgroundPreset}"]`);
  if (selectedBackground) selectedBackground.checked = true;
  document.querySelector("#background-shade").value = state.settings.backgroundShade;
  document.querySelector("#background-shade-output").value = `${state.settings.backgroundShade}%`;
  document.querySelector("#columns-range").value = state.settings.columns;
  document.querySelector("#columns-output").value = `${state.settings.columns} columnas`;
  document.querySelector("#show-urls").checked = state.settings.showUrls;
  elements.settingsDialog.showModal();
}

async function saveSettings(event) {
  event.preventDefault();
  const backgroundPreset = document.querySelector('input[name="background-preset"]:checked')?.value ?? "midnight";
  state.settings = {
    ...state.settings,
    theme: document.querySelector("#theme-select").value,
    columns: Number(document.querySelector("#columns-range").value),
    showUrls: document.querySelector("#show-urls").checked,
    backgroundPreset: backgroundPreset === "custom" && !pendingCustomBackground ? "midnight" : backgroundPreset,
    customBackground: pendingCustomBackground,
    backgroundShade: Number(document.querySelector("#background-shade").value)
  };
  await persist();
  elements.settingsDialog.close();
  render();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("No se pudo leer la imagen.")));
    reader.readAsDataURL(blob);
  });
}

async function optimizeBackground(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Selecciona una imagen PNG, JPEG o WebP.");
  if (file.size > MAX_BACKGROUND_FILE_BYTES) throw new Error("La imagen supera el límite de 25 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2560 / bitmap.width, 1440 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
  if (!blob) throw new Error("No se pudo optimizar la imagen.");
  const dataUrl = await blobToDataUrl(blob);
  if (dataUrl.length > MAX_BACKGROUND_DATA_LENGTH) throw new Error("La imagen optimizada sigue siendo demasiado grande. Prueba con otra de menor resolución.");
  return dataUrl;
}

function updateCustomBackgroundControls(message = "") {
  const choice = document.querySelector("#custom-background-choice");
  const swatch = document.querySelector("#custom-background-swatch");
  const removeButton = document.querySelector("#background-remove-button");
  choice.dataset.empty = String(!pendingCustomBackground);
  swatch.style.backgroundImage = pendingCustomBackground ? `url("${pendingCustomBackground}")` : "linear-gradient(135deg, #343747, #1a1c27)";
  removeButton.hidden = !pendingCustomBackground;
  document.querySelector("#background-status").textContent = message || (pendingCustomBackground ? "Imagen personalizada preparada y guardada solo localmente." : "PNG, JPEG o WebP; máximo 25 MB antes de optimizar.");
}

async function selectBackgroundFile(file) {
  if (!file) return;
  const status = document.querySelector("#background-status");
  status.textContent = "Optimizando imagen…";
  try {
    pendingCustomBackground = await optimizeBackground(file);
    document.querySelector('input[name="background-preset"][value="custom"]').checked = true;
    updateCustomBackgroundControls(`Imagen preparada: ${file.name}`);
  } catch (error) {
    updateCustomBackgroundControls(error.message);
  } finally {
    document.querySelector("#background-file").value = "";
  }
}

function removeCustomBackground() {
  pendingCustomBackground = null;
  document.querySelector('input[name="background-preset"][value="midnight"]').checked = true;
  updateCustomBackgroundControls("Imagen personalizada eliminada de esta configuración.");
}

function updateDialIconControls(message = "") {
  const custom = document.querySelector("#dial-icon-mode").value === "custom";
  const controls = document.querySelector("#dial-icon-custom-controls");
  const preview = document.querySelector("#dial-icon-preview");
  const removeButton = document.querySelector("#dial-icon-remove-button");
  controls.hidden = !custom;
  preview.hidden = !pendingDialIcon;
  if (pendingDialIcon) preview.src = pendingDialIcon;
  removeButton.hidden = !pendingDialIcon;
  document.querySelector("#dial-icon-status").textContent = message || (pendingDialIcon ? "Icono personalizado preparado y guardado solo localmente." : "PNG, JPEG o WebP; se optimizará a 128 × 128 px.");
}

async function optimizeDialIcon(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Selecciona una imagen PNG, JPEG o WebP.");
  if (file.size > MAX_DIAL_ICON_FILE_BYTES) throw new Error("La imagen supera el límite de 5 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 128 / bitmap.width, 128 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d", { alpha: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("No se pudo optimizar la imagen.");
  const nextDialIcon = await blobToDataUrl(blob);
  if (nextDialIcon.length > MAX_DIAL_ICON_DATA_LENGTH) throw new Error("La imagen optimizada sigue siendo demasiado grande. Prueba con otra más sencilla.");
  return nextDialIcon;
}

async function selectDialIconFile(file) {
  if (!file) return;
  try {
    pendingDialIcon = await optimizeDialIcon(file);
    updateDialIconControls();
  } catch (error) {
    updateDialIconControls(error.message);
  } finally {
    document.querySelector("#dial-icon-file").value = "";
  }
}

async function selectDialIconUrl() {
  const input = document.querySelector("#dial-icon-url");
  try {
    const url = normalizeUrl(input.value);
    updateDialIconControls("Descargando imagen…");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo descargar la imagen (${response.status}).`);
    pendingDialIcon = await optimizeDialIcon(await response.blob());
    input.value = "";
    updateDialIconControls();
  } catch (error) {
    updateDialIconControls(error.message);
  }
}

function removeDialIcon() {
  pendingDialIcon = null;
  document.querySelector("#dial-icon-mode").value = "favicon";
  updateDialIconControls();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ginger-dial-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    const speedDial2State = convertSpeedDial2Export(imported);
    state = sanitizeState(speedDial2State ?? imported);
    await persist();
    elements.settingsDialog.close();
    render();
    if (speedDial2State) alert(`Importados ${state.groups.length} grupos y ${state.dials.length} diales de Speed Dial 2.`);
  } catch (error) {
    alert(`No se pudo importar la copia: ${error.message}`);
  } finally {
    document.querySelector("#import-file").value = "";
  }
}

function bindEvents() {
  elements.search.addEventListener("input", renderDials);
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      elements.search.focus();
    }
    if (event.key === "Escape") closePanel();
  });
  document.querySelector("#add-group-button").addEventListener("click", () => openGroupDialog());
  document.querySelector("#manage-group-button").addEventListener("click", () => openGroupDialog(state.groups.find((group) => group.id === state.activeGroupId)));
  document.querySelector("#settings-button").addEventListener("click", openSettings);
  document.querySelector("#bookmarks-button").addEventListener("click", loadBookmarksPanel);
  document.querySelector("#close-panel").addEventListener("click", closePanel);
  elements.scrim.addEventListener("click", closePanel);
  elements.panelSearch.addEventListener("input", renderBookmarks);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close("cancel"));
  });
  elements.dialForm.addEventListener("submit", saveDial);
  elements.groupForm.addEventListener("submit", saveGroup);
  document.querySelector("#delete-dial-button").addEventListener("click", deleteDial);
  document.querySelector("#delete-group-button").addEventListener("click", deleteGroup);
  elements.settingsForm.addEventListener("submit", saveSettings);
  document.querySelector("#dial-url").addEventListener("input", (event) => event.currentTarget.setCustomValidity(""));
  document.querySelector("#columns-range").addEventListener("input", (event) => { document.querySelector("#columns-output").value = `${event.currentTarget.value} columnas`; });
  document.querySelector("#background-shade").addEventListener("input", (event) => { document.querySelector("#background-shade-output").value = `${event.currentTarget.value}%`; });
  document.querySelector("#background-upload-button").addEventListener("click", () => document.querySelector("#background-file").click());
  document.querySelector("#background-remove-button").addEventListener("click", removeCustomBackground);
  document.querySelector("#background-file").addEventListener("change", (event) => selectBackgroundFile(event.currentTarget.files[0]));
  document.querySelector("#dial-icon-mode").addEventListener("change", () => updateDialIconControls());
  document.querySelector("#dial-icon-upload-button").addEventListener("click", () => document.querySelector("#dial-icon-file").click());
  document.querySelector("#dial-icon-remove-button").addEventListener("click", removeDialIcon);
  document.querySelector("#dial-icon-file").addEventListener("change", (event) => selectDialIconFile(event.currentTarget.files[0]));
  document.querySelector("#dial-icon-url-button").addEventListener("click", selectDialIconUrl);
  elements.dialOrder.addEventListener("change", async (event) => {
    state.settings.dialOrder = event.currentTarget.value;
    await persist();
    renderDials();
  });
  document.querySelector("#export-button").addEventListener("click", exportBackup);
  document.querySelector("#import-button").addEventListener("click", () => document.querySelector("#import-file").click());
  document.querySelector("#import-file").addEventListener("change", (event) => importBackup(event.currentTarget.files[0]));
}

async function init() {
  document.querySelector("#today").textContent = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  try { state = sanitizeState(await storage.get()); }
  catch { state = structuredClone(defaultState); }
  bindEvents();
  render();
}

init();
