(() => {
  "use strict";

  const API = ""; // same origin — change to "http://<server-ip>:4000" for LAN/mobile access
  const POLL_MS = 4000; // background refresh, so a second tab/device stays in sync

  let allItems = [];
  let currentFolderId = null;
  let currentView = "files";
  let viewMode = "grid";
  let searchTerm = "";
  let folderStack = [];
  let backupsLog = [];
  let selectedIds = new Set();
  let storageUsed = 0;
  let storageQuota = 10 * 1024 * 1024 * 1024;
  let isOnline = false;

  /* ---------------- API helpers ---------------- */

  async function api(path, opts = {}) {
    const res = await fetch(API + path, opts);
    if (!res.ok) {
      const err = new Error(`${opts.method || "GET"} ${path} failed: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res;
  }

  async function refreshFromServer() {
    try {
      const [items, storage, backups] = await Promise.all([
        api("/api/items"),
        api("/api/storage"),
        api("/api/backups"),
      ]);

      allItems = Array.isArray(items) ? items : [];

      storageUsed = Number(storage?.used) || 0;
      storageQuota = Number(storage?.quota) || 0;

      backupsLog = Array.isArray(backups) ? backups : [];

      setOnline(true);

      return true;
    } catch (err) {
      console.error("Safe Haven sync error:", err);
      setOnline(false);
      return false;
    }
  }

  function setOnline(state) {
    if (state === isOnline) return;
    isOnline = state;
    const el = document.getElementById("connStatus");
    const text = document.getElementById("connText");
    if (el) { el.classList.toggle("online", state); el.classList.toggle("offline", !state); }
    if (text) text.textContent = state ? "Live — synced to server" : "Server unreachable";
    if (!state) toast("Can't reach the Haven server — is it running?", "error");
  }

  /* ---------------- Utilities ---------------- */

  function fmtBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return "Today, " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name);
    return m ? m[1].toLowerCase() : "";
  }

  function kindOf(item) {
    if (item.type === "folder") return "folder";
    const ext = extOf(item.name);
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
    if (["pdf", "doc", "docx", "txt", "md", "rtf"].includes(ext)) return "doc";
    if (["mp3", "wav", "flac", "m4a"].includes(ext)) return "audio";
    if (["mp4", "mov", "avi", "mkv"].includes(ext)) return "video";
    if (["zip", "rar", "7z"].includes(ext)) return "archive";
    return "file";
  }

  const ICONS = {
    folder: `<svg viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="1.7"/></svg>`,
    image: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10" r="1.6" stroke="currentColor" stroke-width="1.5"/><path d="m5 17 5-5 3 3 3-4 4 6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    doc: `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7"/><path d="M14 3v4h4" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 13h6M8.5 16.5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    audio: `<svg viewBox="0 0 24 24" fill="none"><path d="M9 17V6l10-2v11" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="6.5" cy="17" r="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="16.5" cy="15" r="2.5" stroke="currentColor" stroke-width="1.7"/></svg>`,
    video: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="13" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="m16 10 5-3v10l-5-3" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
    archive: `<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M10 4v3m0 3v2m0 2v2m0 2v2" stroke="currentColor" stroke-width="1.6"/></svg>`,
    file: `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7"/><path d="M14 3v4h4" stroke="currentColor" stroke-width="1.7"/></svg>`,
  };

  function toast(msg, kind = "") {
    const stack = document.getElementById("toastStack");
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 2600);
  }

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- Data helpers (read-only, local mirror) ---------------- */

  function children(parentId, { includeTrashed = false } = {}) {
    return allItems.filter(i => i.parentId === parentId && (includeTrashed || !i.trashed));
  }
  function findItem(id) { return allItems.find(i => i.id === id); }
  function isAncestorTrashed(item) {
    if (item.parentId == null) return false;
    const parent = findItem(item.parentId);
    return !!(parent && parent.trashed);
  }

  /* ---------------- Mutating actions → backend ---------------- */

  async function createFolder(name, parentId) {
    await api("/api/folder", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    await refreshFromServer();
  }

  async function uploadFiles(fileList, parentId) {
    const form = new FormData();
    Array.from(fileList).forEach(f => form.append("files", f));
    form.append("parentId", parentId == null ? "null" : parentId);
    await api("/api/upload", { method: "POST", body: form });
    await refreshFromServer();
  }

  async function uploadStructured(entries, parentId) {
    // entries: [{file, relPath}] — used for folder uploads, builds real folder tree first
    const folderCache = new Map();
    for (const { file, relPath } of entries) {
      const parts = relPath.split("/").filter(Boolean);
      parts.pop(); // filename
      let curParent = parentId, pathAcc = "";
      for (const part of parts) {
        pathAcc += "/" + part;
        if (folderCache.has(pathAcc)) {
          curParent = folderCache.get(pathAcc);
        } else {
          const res = await api("/api/folder", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: part, parentId: curParent }),
          });
          folderCache.set(pathAcc, res.id);
          curParent = res.id;
        }
      }
      const form = new FormData();
      form.append("files", file);
      form.append("parentId", curParent == null ? "null" : curParent);
      await api("/api/upload", { method: "POST", body: form });
    }
    await refreshFromServer();
  }

  async function renameItem(id, name) {
    await api(`/api/rename/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await refreshFromServer();
  }

  async function moveToTrash(id) {
    await api(`/api/trash/${id}`, { method: "POST" });
    await refreshFromServer();
  }
  async function restoreItem(id) {
    await api(`/api/restore/${id}`, { method: "POST" });
    await refreshFromServer();
  }
  async function deleteForever(id) {
    await api(`/api/delete/${id}`, { method: "DELETE" });
    await refreshFromServer();
  }

  function downloadItem(item) {
    const a = document.createElement("a");
    a.href = `${API}/api/download/${item.id}`;
    a.download = item.name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function exportBackup() {
    toast("Packing your backup on the server…");
    try {
      const res = await fetch(`${API}/api/backup/export`);
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `safehaven-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      await refreshFromServer();
      if (currentView === "backups") renderBackupsView();
      toast("Backup downloaded", "success");
      notifyUser("Backup ready", "Your Safe Haven backup has been downloaded.", "backup");
    } catch (err) {
      toast("Couldn't create the backup — check that the server is running", "error");
    }
  }

  async function importBackup(file, parentId) {
    const form = new FormData();
    form.append("backup", file);
    form.append("parentId", parentId == null ? "null" : parentId);
    try {
      const result = await api("/api/backup/import", { method: "POST", body: form });
      await refreshFromServer();
      toast(`Restored ${result.count} file${result.count === 1 ? "" : "s"} from backup`, "success");
      render();
    } catch (err) {
      toast("Couldn't read that backup file", "error");
    }
  }

  /* ---------------- Rendering ---------------- */

  const els = {};
  function cacheEls() {
    ["breadcrumb", "content", "fileGrid", "emptyState", "emptyTitle", "emptyText",
      "storageUsedText", "storageTotalText", "dialFill", "dialPercent", "dialTicks",
      "searchInput", "modalBackdrop", "modal", "contextMenu", "dropOverlay", "uploadMenu",
      "sidebar", "sidebarOverlay", "selectionBar", "emptyTrashBtn"].forEach(id => els[id] = document.getElementById(id));
  }

  function drawTicks() {
    const g = els.dialTicks;
    g.innerHTML = "";
    const cx = 60, cy = 60, rOuter = 52, rInner = 47;
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2 - Math.PI / 2;
      const x1 = cx + rInner * Math.cos(angle), y1 = cy + rInner * Math.sin(angle);
      const x2 = cx + rOuter * Math.cos(angle), y2 = cy + rOuter * Math.sin(angle);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1); line.setAttribute("y1", y1);
      line.setAttribute("x2", x2); line.setAttribute("y2", y2);
      line.setAttribute("class", "dial-tick");
      g.appendChild(line);
    }
  }

  function updateStorageDial() {
    const pct = Math.min(100, (storageUsed / storageQuota) * 100);
    const circumference = 2 * Math.PI * 52;
    els.dialFill.style.strokeDasharray = String(circumference);
    els.dialFill.style.strokeDashoffset = String(circumference * (1 - pct / 100));
    els.dialPercent.textContent = Math.round(pct) + "%";
    els.storageUsedText.textContent = fmtBytes(storageUsed);
    els.storageTotalText.textContent = fmtBytes(storageQuota);
  }

  function buildBreadcrumb() {
    els.breadcrumb.innerHTML = "";
    const titles = { files: "My Files", recent: "Recent", backups: "Backups", trash: "Trash", settings: "Settings" };

    if (currentView !== "files") {
      const span = document.createElement("span");
      span.className = "crumb-current";
      span.textContent = titles[currentView];
      els.breadcrumb.appendChild(span);
      return;
    }

    if (folderStack.length === 0) {
      const span = document.createElement("span");
      span.className = "crumb-current";
      span.textContent = "My Files";
      els.breadcrumb.appendChild(span);
    } else {
      const rootBtn = document.createElement("button");
      rootBtn.type = "button";
      rootBtn.textContent = "My Files";
      rootBtn.onclick = () => { folderStack = []; currentFolderId = null; selectedIds.clear(); render(); };
      els.breadcrumb.appendChild(rootBtn);
    }

    folderStack.forEach((crumb, idx) => {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "/";
      els.breadcrumb.appendChild(sep);

      const isLast = idx === folderStack.length - 1;
      if (isLast) {
        const span = document.createElement("span");
        span.className = "crumb-current";
        span.textContent = crumb.name;
        els.breadcrumb.appendChild(span);
      } else {
        const btn = document.createElement("button");
        btn.textContent = crumb.name;
        btn.onclick = () => { folderStack = folderStack.slice(0, idx + 1); currentFolderId = crumb.id; selectedIds.clear(); render(); };
        els.breadcrumb.appendChild(btn);
      }
    });
  }

  function itemCardHTML(item, opts = {}) {
    const kind = kindOf(item);
    const icon = ICONS[kind] || ICONS.file;
    const isImg = kind === "image";
    const thumb = isImg ? `<img class="item-thumb" src="${API}/api/file/${item.id}" alt="" loading="lazy">` : "";
    const sizeText = item.type === "folder" ? `${children(item.id).length} item${children(item.id).length === 1 ? "" : "s"}` : fmtBytes(item.size);
    const dateText = fmtDate(item.dateModified || item.dateAdded);

    let rowActions = "";
    if (opts.trashView) {
      rowActions = `<div class="badge-restore-row">
        <button class="mini-btn" data-act="restore" data-id="${item.id}">Restore</button>
        <button class="mini-btn danger" data-act="delete-forever" data-id="${item.id}">Delete forever</button>
      </div>`;
    }

    const checked = selectedIds.has(item.id);

    return `
      <div class="item-card ${item.trashed ? "trashed" : ""} ${checked ? "selected" : ""}" data-id="${item.id}" data-type="${item.type}">
        ${opts.selectable ? `<button class="item-check ${checked ? "checked" : ""}" data-check-for="${item.id}" aria-label="Select">
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5 10 17 19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>` : ""}
        ${!opts.trashView ? `<button class="item-more" data-menu-for="${item.id}" aria-label="More options">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>
        </button>` : ""}
        ${thumb}
        <div class="item-icon ${kind}">${icon}</div>
        <div class="item-name">${escapeHTML(item.name)}</div>
        <div class="item-meta">
          <span class="item-size">${sizeText}</span>
          <span class="item-date">${dateText}</span>
        </div>
        ${rowActions}
      </div>`;
  }

  function currentList() {
    let list;
    if (currentView === "files") {
      list = children(currentFolderId);
    } else if (currentView === "recent") {
      list = allItems.filter(i => i.type === "file" && !i.trashed)
        .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded)).slice(0, 30);
    } else if (currentView === "trash") {
      list = allItems.filter(i => i.trashed && !isAncestorTrashed(i));
    } else {
      list = [];
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const pool = currentView === "files" ? allItems.filter(i => !i.trashed) : list;
      list = pool.filter(i => i.name.toLowerCase().includes(term));
    }
    return list.slice().sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  function render() {
    buildBreadcrumb();
    updateStorageDial();

    if (els.emptyTrashBtn) els.emptyTrashBtn.style.display = currentView === "trash" ? "inline-flex" : "none";

    if (currentView === "backups") { renderBackupsView(); return; }
    els.content.classList.remove("backups-mode");
    if (currentView === "settings") { renderSettingsView(); return; }
    els.content.classList.remove("settings-mode");

    const list = currentList();
    els.content.classList.toggle("list-mode", viewMode === "list");
    els.content.classList.toggle("is-empty", list.length === 0);
    els.emptyState.style.display = list.length === 0 ? "flex" : "none";
    els.fileGrid.style.display = list.length === 0 ? "none" : "";

    if (currentView === "trash") {
      els.emptyTitle.textContent = "Trash is empty";
      els.emptyText.textContent = "Anything you remove from your vault shows up here for 30 days before it's gone for good.";
    } else if (currentView === "recent") {
      els.emptyTitle.textContent = "Nothing recent";
      els.emptyText.textContent = "Files you add will show up here, most recent first.";
    } else if (searchTerm) {
      els.emptyTitle.textContent = "No matches";
      els.emptyText.textContent = `Nothing in your vault matches "${searchTerm}".`;
    } else {
      els.emptyTitle.textContent = "This vault is empty";
      els.emptyText.textContent = "Drag files in, or use Upload to get started. Everything you add is written to disk immediately.";
    }

    const selectableView = currentView === "files" || currentView === "recent" || currentView === "trash";
    els.fileGrid.innerHTML = list.map(i => itemCardHTML(i, { trashView: currentView === "trash", selectable: selectableView })).join("");
    bindCardEvents();
    renderSelectionBar();
  }

  function renderBackupsView() {
    els.content.classList.remove("list-mode");
    els.content.classList.remove("is-empty");
    els.content.classList.add("backups-mode");
    els.emptyState.style.display = "none";
    if (els.selectionBar) { els.selectionBar.classList.remove("open"); els.selectionBar.innerHTML = ""; }

    const fileCount = allItems.filter(i => i.type === "file" && !i.trashed).length;

    let html = `<div class="backups-wrap">`;

    html += `<div class="backup-note">
      <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="16" r="0.9" fill="currentColor"/></svg>
      <div><strong>How recovery works here.</strong> Every file is written straight to the server's disk
      the moment you add it, so a browser crash, a tab close, or this computer restarting won't lose
      anything. For protection against the <em>server machine itself</em> failing, download a backup
      below and keep the .zip somewhere else — another drive, another machine, or cloud storage.</div>
    </div>`;

    html += `<div class="backup-hero">
      <div class="backup-hero-seal"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3 4 6.5v5c0 5 3.4 8.6 8 9.5 4.6-.9 8-4.5 8-9.5v-5L12 3Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg></div>
      <div class="backup-hero-info">
        <h4>Current vault snapshot</h4>
        <p>${fileCount} file${fileCount === 1 ? "" : "s"} · ${fmtBytes(storageUsed)}</p>
      </div>
      <button class="btn-solid" id="backupsExportBtn">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <span>Download .zip</span>
      </button>
    </div>`;

    html += `<div class="backups-section-label">Backup history</div>`;

    if (backupsLog.length === 0) {
      html += `<div class="backup-empty">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 3 4 6.5v5c0 5 3.4 8.6 8 9.5 4.6-.9 8-4.5 8-9.5v-5L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        <p>No backups downloaded yet. Once you download one, it'll be listed here.</p>
      </div>`;
    } else {
      html += `<div class="backup-history">`;
      backupsLog.slice().reverse().forEach(b => {
        html += `<div class="backup-row">
    <div class="backup-row-dot">
      <svg viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div class="backup-row-info">
      <h5>${escapeHTML(b.label || b.name)}</h5>
      <p>${fmtDate(b.dateISO)} · ${b.itemCount} item${b.itemCount === 1 ? "" : "s"}</p>
    </div>
    <div class="bkmenu-wrap">
      <button class="bkmenu-btn" data-bkid="${b.id}" aria-label="Backup options">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>
      </button>
      <div class="bkmenu-dropdown" id="bkmenu-${b.id}">
        <button data-bkact="download">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <span>Download</span>
        </button>
        <button data-bkact="restore">
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5 10 17 19 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Restore into My Files</span>
        </button>
        <button data-bkact="rename">
          <svg viewBox="0 0 24 24" fill="none"><path d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          <span>Rename</span>
        </button>
        <div class="bkmenu-sep"></div>
        <button data-bkact="delete" class="bkmenu-danger">
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <span>Delete backup</span>
        </button>
      </div>
    </div>
  </div>`;
      });
      html += `</div>`;
    }

    html += `</div>`;

    els.fileGrid.innerHTML = html;
    document.getElementById("backupsExportBtn").addEventListener("click", exportBackup);
    document.querySelectorAll(".bkmenu-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const dropdown = document.getElementById(`bkmenu-${btn.dataset.bkid}`);
        const wasOpen = dropdown.classList.contains("open");
        document.querySelectorAll(".bkmenu-dropdown.open").forEach(d => d.classList.remove("open"));
        if (!wasOpen) dropdown.classList.add("open");
      });
    });

    document.querySelectorAll(".bkmenu-dropdown button").forEach(btn => {
      btn.addEventListener("click", (e) => handleBackupMenuAction(e, btn));
    });

    if (!window.__bkmenuOutsideClickBound) {
      window.__bkmenuOutsideClickBound = true;
      document.addEventListener("click", () => {
        document.querySelectorAll(".bkmenu-dropdown.open").forEach(d => d.classList.remove("open"));
      });
    }
  }

  async function downloadBackupEntry(backup) {
    try {
      const res = await fetch(`${API}/api/backup/download/${backup.id}`);
      if (!res.ok) {
        let msg = `Download failed (${res.status})`;
        try { const data = await res.json(); if (data.error) msg = data.error; } catch { }
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backup.label ? `${backup.label}.zip` : backup.name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err.status === 404) {
        await cleanupBrokenBackupEntry(backup, err.message);
      } else {
        toast(err.message || "Couldn't download that backup", "error");
      }
    }
  }

  // A 404 on download/restore means either the metadata entry itself is
  // gone server-side (rare — another tab/device deleted it), or the zip
  // file was removed from disk while the entry stayed in db.json. Either
  // way, retrying will never succeed, so permanently clean it up instead
  // of just hiding it client-side (which would reappear on the next poll).
  async function cleanupBrokenBackupEntry(backup, reason) {
    backupsLog = backupsLog.filter(b => b.id !== backup.id);
    renderBackupsView();
    try {
      await api(`/api/backup/${backup.id}`, { method: "DELETE" });
    } catch { /* already gone server-side too — fine */ }
    await refreshFromServer();
    renderBackupsView();
    toast(reason || "That backup is no longer available and was removed", "error");
  }

  async function safeParseJson(res) {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try { return await res.json(); } catch { return {}; }
    }
    return {}; // server sent HTML/plain text (e.g. a crash page) — don't choke on it
  }

  async function handleBackupMenuAction(e, btn) {
    e.stopPropagation();
    const wrap = btn.closest(".bkmenu-wrap");
    const backupId = wrap.querySelector(".bkmenu-btn").dataset.bkid;
    const backup = backupsLog.find(b => b.id === backupId);
    if (!backup) return;
    wrap.querySelector(".bkmenu-dropdown").classList.remove("open");
    const act = btn.dataset.bkact;

    if (act === "download") {
      downloadBackupEntry(backup);
    } else if (act === "restore") {
      if (!confirm(`Restore "${backup.label || backup.name}" into My Files?`)) return;
      try {
        const res = await fetch(`${API}/api/backup/restore/${backup.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId: null }),
        });
        const data = await safeParseJson(res);
        if (!res.ok) {
          const err = new Error(data.error || `Restore failed: ${res.status}`);
          err.status = res.status;
          throw err;
        }
        await refreshFromServer();
        toast(`Restored ${data.count} item${data.count === 1 ? "" : "s"}`, "success");
        render();
      } catch (err) {
        if (err.status === 404) {
          await cleanupBrokenBackupEntry(backup, err.message);
        } else {
          toast(err.message || "Couldn't restore that backup", "error");
        }
      }
    } else if (act === "rename") {
      const next = prompt("Rename this backup", backup.label || backup.name);
      if (next === null || !next.trim()) return;
      try {
        await api(`/api/backup/${backup.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: next.trim() }),
        });
        await refreshFromServer();
        renderBackupsView();
      } catch (err) {
        if (err.status === 404) {
          backupsLog = backupsLog.filter(b => b.id !== backup.id);
          toast("That backup was already removed", "error");
          renderBackupsView();
        } else {
          toast(err.message || "Couldn't rename that backup", "error");
        }
      }
    } else if (act === "delete") {
      if (!confirm(`Permanently delete "${backup.label || backup.name}"? This can't be undone.`)) return;
      try {
        await api(`/api/backup/${backup.id}`, { method: "DELETE" });
        await refreshFromServer();
        toast("Backup deleted", "success");
        renderBackupsView();
      } catch (err) {
        if (err.status === 404) {
          backupsLog = backupsLog.filter(b => b.id !== backup.id);
          toast("That backup was already removed", "error");
          renderBackupsView();
        } else {
          toast(err.message || "Couldn't delete that backup", "error");
        }
      }
    }
  }

  const PROFILE_KEY = "safehaven_profile";

  function loadProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; }
    catch { return {}; }
  }

  function saveProfileToStorage(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  let activeSettingsTab = "profile";

  function renderSettingsView() {
    els.content.classList.remove("list-mode");
    els.content.classList.remove("is-empty");
    els.content.classList.add("settings-mode");
    els.emptyState.style.display = "none";
    if (els.selectionBar) { els.selectionBar.classList.remove("open"); els.selectionBar.innerHTML = ""; }

    const tabs = [
      { id: "profile", label: "Profile", icon: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="1.6"/><path d="M5 20c1.2-3.8 4.2-6 7-6s5.8 2.2 7 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>` },
      { id: "general", label: "General", icon: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>` },
      { id: "data", label: "Data control", icon: `<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" stroke-width="1.6"/><path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" stroke="currentColor" stroke-width="1.6"/><path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" stroke="currentColor" stroke-width="1.6"/></svg>` },
      { id: "privacy", label: "Privacy", icon: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 4 6.5v5c0 5 3.4 8.6 8 9.5 4.6-.9 8-4.5 8-9.5v-5L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>` },
      { id: "notifications", label: "Notifications", icon: `<svg viewBox="0 0 24 24" fill="none"><path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>` }
    ];

    const navHTML = tabs.map(t => `<button class="settings-nav-item ${t.id === activeSettingsTab ? "active" : ""}" data-tab="${t.id}">${t.icon}<span>${t.label}</span></button>`).join("");

    els.fileGrid.innerHTML = `
      <div class="settings-wrap">
        <div class="settings-nav">${navHTML}</div>
        <div class="settings-panel" id="settingsPanel"></div>
      </div>`;

    document.querySelectorAll(".settings-nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        activeSettingsTab = btn.dataset.tab;
        document.querySelectorAll(".settings-nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderSettingsPanel();
      });
    });

    renderSettingsPanel();
  }

  function renderSettingsPanel() {
    const panel = document.getElementById("settingsPanel");
    if (!panel) return;
    if (activeSettingsTab === "profile") { panel.innerHTML = profilePanelHTML(); wireProfilePanel(panel); }
    else if (activeSettingsTab === "general") { panel.innerHTML = generalPanelHTML(); }
    else if (activeSettingsTab === "data") { panel.innerHTML = dataPanelHTML(); wireDataPanel(panel); }
    else if (activeSettingsTab === "privacy") { panel.innerHTML = privacyPanelHTML(); wirePrivacyPanel(panel); }
    else if (activeSettingsTab === "notifications") { panel.innerHTML = notificationsPanelHTML(); wireNotificationsPanel(panel); }
  }

  /* ---------- Profile tab ---------- */

  function profilePanelHTML() {
    const profile = loadProfile();
    const initial = (profile.nickname || profile.fullName || "U").trim().charAt(0).toUpperCase() || "U";
    return `
      <h3>Profile</h3>
      <p class="settings-sub">Your identity within Safe Haven — stored only in this browser.</p>

      <div class="settings-avatar-row">
        <div class="settings-avatar" id="settingsAvatar">
          ${profile.photo ? `<img src="${profile.photo}" alt="">` : initial}
        </div>
        <button class="btn-outline" id="changePhotoBtn"><span>Change photo</span></button>
        <button class="btn-outline" id="removePhotoBtn"><span>Remove</span></button>
        <input type="file" id="photoInput" accept="image/*" hidden>
      </div>

      <label class="settings-label">Full name</label>
      <input type="text" class="settings-input" id="fullNameInput" placeholder="e.g. Aarav Sharma" value="${escapeHTML(profile.fullName || "")}">

      <label class="settings-label">What should Safe Haven call you?</label>
      <input type="text" class="settings-input" id="nicknameInput" placeholder="e.g. Aarav" value="${escapeHTML(profile.nickname || "")}">

      <div class="settings-row-2">
        <div>
          <label class="settings-label">Mobile number</label>
          <input type="text" class="settings-input" id="mobileInput" placeholder="+91 90000 00000" value="${escapeHTML(profile.mobile || "")}">
        </div>
        <div>
          <label class="settings-label">Email ID</label>
          <input type="text" class="settings-input" id="emailInput" placeholder="you@example.com" value="${escapeHTML(profile.email || "")}">
        </div>
      </div>

      <div class="settings-save-row">
        <button class="btn-vault" id="saveProfileBtn">Save profile</button>
      </div>`;
  }

  function wireProfilePanel(root) {
    const photoInput = root.querySelector("#photoInput");
    root.querySelector("#changePhotoBtn").addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", () => {
      const file = photoInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const p = loadProfile();
        p.photo = reader.result;
        saveProfileToStorage(p);
        renderSettingsPanel();
      };
      reader.readAsDataURL(file);
    });
    root.querySelector("#removePhotoBtn").addEventListener("click", () => {
      const p = loadProfile();
      delete p.photo;
      saveProfileToStorage(p);
      renderSettingsPanel();
    });
    root.querySelector("#saveProfileBtn").addEventListener("click", () => {
      const p = loadProfile();
      p.fullName = root.querySelector("#fullNameInput").value.trim();
      p.nickname = root.querySelector("#nicknameInput").value.trim();
      p.mobile = root.querySelector("#mobileInput").value.trim();
      p.email = root.querySelector("#emailInput").value.trim();
      saveProfileToStorage(p);
      toast("Profile saved", "success");
      renderSettingsPanel();
    });
  }

  /* ---------- General tab ---------- */

  function generalPanelHTML() {
    const swatches = [
      { name: "Ink", hex: "#2E2517" },
      { name: "Brass", hex: "#B07F35" },
      { name: "Brass light", hex: "#D7AC66" },
      { name: "Brass dark", hex: "#7E5A22" },
      { name: "Sage", hex: "#6E7C56" },
      { name: "Surface", hex: "#FFFCF4" },
      { name: "Surface 2", hex: "#F8F1E1" }
    ];
    const swatchHTML = swatches.map(s => `
      <div class="swatch-item">
        <div class="swatch-color" style="background:${s.hex};"></div>
        <div class="swatch-label">${s.name}<span>${s.hex}</span></div>
      </div>`).join("");

    return `
      <h3>General</h3>
      <p class="settings-sub">How Safe Haven is built — theme, fonts, and app details.</p>

      <div class="general-block">
        <label class="settings-label">App</label>
        <div class="info-row"><span>Name</span><strong>Safe Haven</strong></div>
        <div class="info-row"><span>Version</span><strong>1.0.0</strong></div>
        <div class="info-row"><span>Storage backend</span><strong>Local server (Node + Express)</strong></div>
      </div>

      <div class="general-block">
        <label class="settings-label">Color palette</label>
        <div class="swatch-grid">${swatchHTML}</div>
      </div>

      <div class="general-block">
        <label class="settings-label">Typography</label>
        <div class="font-preview" style="font-family: var(--font-display);">Fraunces — Headings &amp; titles</div>
        <div class="font-preview" style="font-family: var(--font-body);">Inter — Body text &amp; UI labels</div>
        <div class="font-preview" style="font-family: var(--font-mono);">IBM Plex Mono — Sizes, dates &amp; metadata</div>
      </div>`;
  }

  /* ---------- Data control tab ---------- */

  function dataPanelHTML() {
    const fileCount = allItems.filter(i => i.type === "file" && !i.trashed).length;
    const trashCount = allItems.filter(i => i.trashed).length;
    let localBytes = 0;
    try { localBytes = new Blob([JSON.stringify(localStorage)]).size; } catch { }

    return `
      <h3>Data control</h3>
      <p class="settings-sub">Everything Safe Haven stores, and how to export or remove it.</p>

      <div class="data-row">
        <div class="data-row-info">
          <h5>Vault files</h5>
          <p>${fileCount} file${fileCount === 1 ? "" : "s"} · ${fmtBytes(storageUsed)} on the server</p>
        </div>
        <button class="btn-outline" data-act="view-files"><span>View</span></button>
      </div>

      <div class="data-row">
        <div class="data-row-info">
          <h5>Trash</h5>
          <p>${trashCount} item${trashCount === 1 ? "" : "s"} pending deletion</p>
        </div>
        <button class="btn-outline danger-outline" data-act="empty-trash"><span>Empty trash</span></button>
      </div>

      <div class="data-row">
        <div class="data-row-info">
          <h5>Backup history</h5>
          <p>${backupsLog.length} backup${backupsLog.length === 1 ? "" : "s"} recorded</p>
        </div>
        <button class="btn-outline" data-act="view-backups"><span>View</span></button>
      </div>

      <div class="data-row">
        <div class="data-row-info">
          <h5>Profile &amp; preferences</h5>
          <p>${fmtBytes(localBytes)} stored in this browser (name, photo, settings)</p>
        </div>
        <div class="data-row-actions">
          <button class="btn-outline" data-act="export-local"><span>Export</span></button>
          <button class="btn-outline danger-outline" data-act="delete-local"><span>Delete</span></button>
        </div>
      </div>`;
  }

  function switchToView(view) {
    currentView = view;
    folderStack = []; currentFolderId = null; searchTerm = ""; selectedIds.clear();
    document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    render();
  }

  function refreshApp() {
    closeModal();
    closeContextMenu();
    document.querySelectorAll(".context-menu.open").forEach(m => m.classList.remove("open"));
    if (els.searchInput) els.searchInput.value = "";
    els.sidebar.classList.remove("open");
    els.sidebarOverlay.classList.remove("open");
    switchToView("files");
  }

  function wireDataPanel(root) {
    root.querySelector('[data-act="view-files"]').addEventListener("click", () => switchToView("files"));
    root.querySelector('[data-act="view-backups"]').addEventListener("click", () => switchToView("backups"));
    root.querySelector('[data-act="empty-trash"]').addEventListener("click", emptyTrash);
    root.querySelector('[data-act="export-local"]').addEventListener("click", () => {
      const data = { profile: loadProfile(), notifications: getNotifPrefs() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "safehaven-local-data.json";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast("Exported your local data", "success");
    });
    root.querySelector('[data-act="delete-local"]').addEventListener("click", () => {
      if (!confirm("Delete your profile and preferences stored in this browser? This can't be undone.")) return;
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem("safehaven_notif_prefs");
      toast("Local data deleted", "success");
      renderSettingsPanel();
    });
  }

  /* ---------- Privacy tab ---------- */

  async function hashPassword(pw) {
    const enc = new TextEncoder().encode(pw);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function privacyPanelHTML() {
    const hasLock = !!localStorage.getItem("safehaven_lock_hash");
    return `
      <h3>Privacy</h3>
      <p class="settings-sub">Lock the app with a password, and manage sign-in on this device.</p>

      <div class="general-block">
        <label class="settings-label">App password</label>
        ${hasLock
        ? `<p class="settings-hint">A password is currently protecting Safe Haven on this device.</p>
             <input type="password" class="settings-input" id="currentPwInput" placeholder="Current password">
             <input type="password" class="settings-input" id="newPwInput" placeholder="New password (leave blank to remove)">
             <div class="settings-save-row" style="justify-content:flex-start; gap:10px;">
               <button class="btn-vault" id="updatePwBtn">Update password</button>
               <button class="btn-outline danger-outline" id="removePwBtn"><span>Remove password</span></button>
             </div>`
        : `<p class="settings-hint">No password set — anyone with this device can open your vault.</p>
             <input type="password" class="settings-input" id="newPwInput" placeholder="Choose a password">
             <input type="password" class="settings-input" id="confirmPwInput" placeholder="Confirm password">
             <div class="settings-save-row" style="justify-content:flex-start;">
               <button class="btn-vault" id="setPwBtn">Set password</button>
             </div>`}
      </div>

      <div class="general-block">
        <label class="settings-label">Sign out</label>
        <p class="settings-hint">Safe Haven stores your profile locally on this device — there's no cloud account to sign out of elsewhere.</p>
        <button class="btn-outline danger-outline" id="signOutBtn"><span>Sign out on this device</span></button>
      </div>`;
  }

  function wirePrivacyPanel(root) {
    const hasLock = !!localStorage.getItem("safehaven_lock_hash");

    if (!hasLock) {
      root.querySelector("#setPwBtn").addEventListener("click", async () => {
        const pw = root.querySelector("#newPwInput").value;
        const confirmPw = root.querySelector("#confirmPwInput").value;
        if (pw.length < 4) { toast("Password must be at least 4 characters", "error"); return; }
        if (pw !== confirmPw) { toast("Passwords don't match", "error"); return; }
        localStorage.setItem("safehaven_lock_hash", await hashPassword(pw));
        sessionStorage.setItem("safehaven_unlocked", "1");
        toast("Password set", "success");
        renderSettingsPanel();
      });
    } else {
      root.querySelector("#updatePwBtn").addEventListener("click", async () => {
        const cur = root.querySelector("#currentPwInput").value;
        const next = root.querySelector("#newPwInput").value;
        const storedHash = localStorage.getItem("safehaven_lock_hash");
        if ((await hashPassword(cur)) !== storedHash) { toast("Current password is incorrect", "error"); return; }
        if (!next) { toast("Enter a new password, or use Remove password instead", "error"); return; }
        if (next.length < 4) { toast("Password must be at least 4 characters", "error"); return; }
        localStorage.setItem("safehaven_lock_hash", await hashPassword(next));
        toast("Password updated", "success");
        renderSettingsPanel();
      });
      root.querySelector("#removePwBtn").addEventListener("click", async () => {
        const cur = root.querySelector("#currentPwInput").value;
        const storedHash = localStorage.getItem("safehaven_lock_hash");
        if ((await hashPassword(cur)) !== storedHash) { toast("Current password is incorrect", "error"); return; }
        localStorage.removeItem("safehaven_lock_hash");
        toast("Password removed", "success");
        renderSettingsPanel();
      });
    }

    root.querySelector("#signOutBtn").addEventListener("click", () => {
      if (!confirm("Sign out on this device? You'll need your password again if one is set.")) return;
      sessionStorage.removeItem("safehaven_unlocked");
      toast("Signed out", "success");
      location.reload();
    });
  }

  /* ---------- Notifications tab ---------- */

  function getNotifPrefs() {
    try { return Object.assign({ upload: true, backup: true, storage: true }, JSON.parse(localStorage.getItem("safehaven_notif_prefs"))); }
    catch { return { upload: true, backup: true, storage: true }; }
  }
  function saveNotifPrefs(p) { localStorage.setItem("safehaven_notif_prefs", JSON.stringify(p)); }

  function notifyUser(title, body, key) {
    const prefs = getNotifPrefs();
    if (key && prefs[key] === false) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try { new Notification(title, { body }); } catch { }
  }

  function notificationsPanelHTML() {
    const perm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    const prefs = getNotifPrefs();
    return `
      <h3>Notifications</h3>
      <p class="settings-sub">Choose what Safe Haven can notify you about on this device.</p>

      <div class="general-block">
        <div class="info-row">
          <span>Browser permission</span>
          <strong>${perm === "granted" ? "Allowed" : perm === "denied" ? "Blocked" : "Not requested"}</strong>
        </div>
        ${perm !== "granted" ? `<button class="btn-vault" id="enableNotifBtn" style="margin-top:12px;">Enable notifications</button>` : ""}
      </div>

      <div class="general-block">
        <label class="settings-label">Notify me about</label>
        <label class="toggle-row"><span>Upload completed</span><input type="checkbox" id="notifUpload" ${prefs.upload ? "checked" : ""}></label>
        <label class="toggle-row"><span>Backup created</span><input type="checkbox" id="notifBackup" ${prefs.backup ? "checked" : ""}></label>
        <label class="toggle-row"><span>Storage almost full (90%+)</span><input type="checkbox" id="notifStorage" ${prefs.storage ? "checked" : ""}></label>
      </div>`;
  }

  function wireNotificationsPanel(root) {
    const btn = root.querySelector("#enableNotifBtn");
    if (btn) btn.addEventListener("click", async () => {
      const result = await Notification.requestPermission();
      toast(result === "granted" ? "Notifications enabled" : "Notifications blocked", result === "granted" ? "success" : "error");
      renderSettingsPanel();
    });
    ["notifUpload", "notifBackup", "notifStorage"].forEach(id => {
      const key = id.replace("notif", "").toLowerCase();
      root.querySelector(`#${id}`).addEventListener("change", (e) => {
        const prefs = getNotifPrefs();
        prefs[key] = e.target.checked;
        saveNotifPrefs(prefs);
      });
    });
  }

  /* ---------------- Card interactions ---------------- */

  function bindCardEvents() {
    els.fileGrid.querySelectorAll(".item-card").forEach(card => {
      const id = card.dataset.id;
      const type = card.dataset.type;

      card.addEventListener("click", (e) => {
        if (e.target.closest(".item-more") || e.target.closest(".mini-btn")) return;
        if (e.target.closest(".item-check")) {
          e.stopPropagation();
          toggleSelect(id);
          return;
        }
        if (selectedIds.size > 0 && (currentView === "files" || currentView === "recent" || currentView === "trash")) {
          toggleSelect(id);
          return;
        }
        if (currentView === "files" && type === "folder") {
          const item = findItem(id);
          selectedIds.clear();
          folderStack.push({ id: item.id, name: item.name });
          currentFolderId = item.id;
          render();
        } else if (type === "file") {
          openFilePreviewModal(findItem(id));
        }
      });

      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, id);
      });

      const moreBtn = card.querySelector(".item-more");
      if (moreBtn) {
        moreBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const rect = moreBtn.getBoundingClientRect();
          openContextMenu(rect.right, rect.bottom + 4, id);
        });
      }

      card.querySelectorAll(".mini-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === "restore") { await restoreItem(id); toast("Restored to My Files", "success"); }
          if (act === "delete-forever") { await deleteForever(id); toast("Deleted permanently"); }
          render();
        });
      });
    });
  }

  /* ---------------- Selection & bulk actions ---------------- */

  function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    renderSelectionUI();
  }

  function clearSelection() {
    selectedIds.clear();
    renderSelectionUI();
  }

  function renderSelectionUI() {
    document.querySelectorAll(".item-card").forEach(card => {
      const sel = selectedIds.has(card.dataset.id);
      card.classList.toggle("selected", sel);
      const chk = card.querySelector(".item-check");
      if (chk) chk.classList.toggle("checked", sel);
    });
    renderSelectionBar();
  }

  function renderSelectionBar() {
    if (!els.selectionBar) return;
    const selectableView = currentView === "files" || currentView === "recent" || currentView === "trash";
    if (!selectableView) { els.selectionBar.classList.remove("open"); els.selectionBar.innerHTML = ""; return; }

    const list = currentList();
    const total = list.length;
    const count = selectedIds.size;

    if (total === 0) { els.selectionBar.classList.remove("open"); els.selectionBar.innerHTML = ""; return; }

    const allSelected = count > 0 && count === total;
    const inTrash = currentView === "trash";

    const actionsHTML = count === 0 ? "" : inTrash
      ? `<button class="sel-action" data-act="restore"><span>Restore</span></button>
       <button class="sel-action danger" data-act="delete-forever"><span>Delete forever</span></button>
       <button class="sel-action" data-act="clear"><span>Clear</span></button>`
      : `<button class="sel-action" data-act="download"><span>Download</span></button>
       <button class="sel-action danger" data-act="trash"><span>Move to trash</span></button>
       <button class="sel-action" data-act="clear"><span>Clear</span></button>`;

    els.selectionBar.innerHTML = `
    <label class="sel-all">
      <input type="checkbox" id="selectAllBox" ${allSelected ? "checked" : ""}>
      <span>${count > 0 ? `${count} selected` : `Select all (${total})`}</span>
    </label>
    <div class="sel-actions">${actionsHTML}</div>`;
    els.selectionBar.classList.add("open");

    document.getElementById("selectAllBox").addEventListener("change", (e) => {
      if (e.target.checked) list.forEach(i => selectedIds.add(i.id));
      else selectedIds.clear();
      renderSelectionUI();
    });

    els.selectionBar.querySelectorAll(".sel-action").forEach(btn => {
      btn.addEventListener("click", () => handleBulkAction(btn.dataset.act));
    });
  }

  async function handleBulkAction(act) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;

    if (act === "clear") { clearSelection(); return; }

    if (act === "download") {
      ids.forEach(id => { const item = findItem(id); if (item && item.type === "file") downloadItem(item); });
      clearSelection();
      return;
    }

    if (act === "trash") {
      await Promise.all(ids.map(id => api(`/api/trash/${id}`, { method: "POST" })));
      await refreshFromServer();
      toast(`Moved ${ids.length} item${ids.length === 1 ? "" : "s"} to trash`);
      clearSelection();
      render();
    }

    if (act === "restore") {
      await Promise.all(ids.map(id => restoreItem(id)));
      toast(`Restored ${ids.length} item${ids.length === 1 ? "" : "s"}`, "success");
      clearSelection();
      render();
    }

    if (act === "delete-forever") {
      if (!confirm(`Permanently delete ${ids.length} item${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
      await Promise.all(ids.map(id => deleteForever(id)));
      toast("Deleted permanently");
      clearSelection();
      render();
    }
  }

  async function emptyTrash() {
    const trashedItems = allItems.filter(i => i.trashed);
    if (!trashedItems.length) { toast("Trash is already empty"); return; }
    if (!confirm(`Permanently delete ${trashedItems.length} item${trashedItems.length === 1 ? "" : "s"} from trash? This can't be undone.`)) return;
    for (const item of trashedItems) {
      await api(`/api/delete/${item.id}`, { method: "DELETE" });
    }
    await refreshFromServer();
    toast("Trash emptied", "success");
    render();
  }

  /* ---------------- Context menu ---------------- */

  function openContextMenu(x, y, id) {
    const item = findItem(id);
    if (!item) return;
    const menu = els.contextMenu;
    const inTrash = currentView === "trash";

    let itemsHTML = "";
    if (!inTrash) {
      itemsHTML += ctxBtn("open", item.type === "folder" ? "Open" : "Download", icoEye());
      itemsHTML += ctxBtn("rename", "Rename", icoPencil());
      itemsHTML += `<div class="ctx-sep"></div>`;
      itemsHTML += ctxBtn("trash", "Move to trash", icoTrash(), true);
    } else {
      itemsHTML += ctxBtn("restore", "Restore", icoCheck());
      itemsHTML += ctxBtn("delete-forever", "Delete forever", icoTrash(), true);
    }

    menu.innerHTML = itemsHTML;
    menu.style.left = Math.min(x, window.innerWidth - 200) + "px";
    menu.style.top = Math.min(y, window.innerHeight - 160) + "px";
    menu.classList.add("open");

    menu.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        closeContextMenu();
        if (act === "open") {
          if (item.type === "folder") {
            folderStack.push({ id: item.id, name: item.name });
            currentFolderId = item.id;
          } else { downloadItem(item); }
        } else if (act === "rename") {
          openRenameModal(item);
        } else if (act === "trash") {
          await moveToTrash(item.id);
          toast(`Moved "${item.name}" to trash`);
        } else if (act === "restore") {
          await restoreItem(item.id);
          toast("Restored to My Files", "success");
        } else if (act === "delete-forever") {
          await deleteForever(item.id);
          toast("Deleted permanently");
        }
        render();
      });
    });
  }
  function ctxBtn(act, label, svg, danger) {
    return `<button data-act="${act}" class="${danger ? "danger" : ""}">${svg}${label}</button>`;
  }
  function icoEye() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>`; }
  function icoPencil() { return `<svg viewBox="0 0 24 24" fill="none"><path d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`; }
  function icoTrash() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`; }
  function icoCheck() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5 10 17 19 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }

  function closeContextMenu() { els.contextMenu.classList.remove("open"); }

  /* ---------------- Modal ---------------- */

  function openModal(html, onMount) {
    els.modal.innerHTML = html;
    els.modalBackdrop.classList.add("open");
    if (onMount) onMount(els.modal);
  }
  function closeModal() { els.modalBackdrop.classList.remove("open"); }

  function openNewFolderModal() {
    openModal(`
      <h3>New folder</h3>
      <p class="modal-sub">Give this folder a name.</p>
      <input type="text" id="folderNameInput" placeholder="Untitled folder" autofocus>
      <div class="modal-actions">
        <button class="modal-cancel" id="modalCancel">Cancel</button>
        <button class="modal-confirm" id="modalConfirm">Create</button>
      </div>`, (root) => {
      const input = root.querySelector("#folderNameInput");
      input.focus();
      root.querySelector("#modalCancel").onclick = closeModal;
      const submit = async () => {
        const name = input.value.trim() || "Untitled folder";
        closeModal();
        await createFolder(name, currentFolderId);
        render();
        toast(`Created "${name}"`, "success");
      };
      root.querySelector("#modalConfirm").onclick = submit;
      input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    });
  }

  function openRenameModal(item) {
    openModal(`
      <h3>Rename</h3>
      <p class="modal-sub">Choose a new name for "${escapeHTML(item.name)}".</p>
      <input type="text" id="renameInput" value="${escapeHTML(item.name)}" autofocus>
      <div class="modal-actions">
        <button class="modal-cancel" id="modalCancel">Cancel</button>
        <button class="modal-confirm" id="modalConfirm">Save</button>
      </div>`, (root) => {
      const input = root.querySelector("#renameInput");
      input.focus(); input.select();
      root.querySelector("#modalCancel").onclick = closeModal;
      const submit = async () => {
        const name = input.value.trim();
        closeModal();
        if (name) await renameItem(item.id, name);
        render();
      };
      root.querySelector("#modalConfirm").onclick = submit;
      input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    });
  }

  function openFilePreviewModal(item) {
    const kind = kindOf(item);
    const icon = ICONS[kind] || ICONS.file;
    const isImg = kind === "image";
    const thumbHTML = isImg
      ? `<img class="preview-thumb-img" src="${API}/api/file/${item.id}" alt="">`
      : `<div class="preview-thumb-icon ${kind}">${icon}</div>`;
    const sizeText = fmtBytes(item.size);
    const dateText = fmtDate(item.dateModified || item.dateAdded);
    const inTrash = !!item.trashed;

    openModal(`
      <div class="preview-modal">
        <button class="preview-more" id="previewMoreBtn" aria-label="More options">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>
        </button>
        <div class="preview-thumb">${thumbHTML}</div>
        <h3 class="preview-name">${escapeHTML(item.name)}</h3>
        <p class="preview-meta">${sizeText} · ${dateText}</p>
        <div class="preview-info-panel" id="previewInfoPanel">
          <div class="info-row"><span>Type</span><strong>${escapeHTML(kind)}</strong></div>
          <div class="info-row"><span>Size</span><strong>${sizeText}</strong></div>
          <div class="info-row"><span>Modified</span><strong>${dateText}</strong></div>
        </div>
      </div>
      <div class="context-menu preview-dropdown" id="previewDropdown"></div>
    `, (root) => {
      const dropdown = root.querySelector("#previewDropdown");
      const moreBtn = root.querySelector("#previewMoreBtn");
      const infoPanel = root.querySelector("#previewInfoPanel");

      let itemsHTML = "";
      if (!inTrash) {
        itemsHTML += ctxBtn("open", "Open with", icoEye());
        itemsHTML += ctxBtn("download", "Download", icoDownload());
        itemsHTML += `<div class="ctx-sep"></div>`;
        itemsHTML += ctxBtn("copy", "Make a copy", icoCopy());
        itemsHTML += ctxBtn("rename", "Rename", icoPencil());
        itemsHTML += `<div class="ctx-sep"></div>`;
        itemsHTML += ctxBtn("info", "File information", icoInfoIcon());
        itemsHTML += `<div class="ctx-sep"></div>`;
        itemsHTML += ctxBtn("trash", "Move to trash", icoTrash(), true);
      } else {
        itemsHTML += ctxBtn("restore", "Restore", icoCheck());
        itemsHTML += ctxBtn("delete-forever", "Delete forever", icoTrash(), true);
      }
      dropdown.innerHTML = itemsHTML;

      dropdown.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          dropdown.classList.remove("open");
          if (act === "open") {
            window.open(`${API}/api/file/${item.id}`, "_blank");
          } else if (act === "download") {
            downloadItem(item);
          } else if (act === "copy") {
            closeModal();
            await copyItem(item);
            render();
          } else if (act === "rename") {
            closeModal();
            openRenameModal(item);
          } else if (act === "info") {
            infoPanel.classList.toggle("open");
          } else if (act === "trash") {
            closeModal();
            await moveToTrash(item.id);
            toast(`Moved "${item.name}" to trash`);
            render();
          } else if (act === "restore") {
            closeModal();
            await restoreItem(item.id);
            toast("Restored to My Files", "success");
            render();
          } else if (act === "delete-forever") {
            closeModal();
            await deleteForever(item.id);
            toast("Deleted permanently");
            render();
          }
        });
      });

      moreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rect = moreBtn.getBoundingClientRect();
        dropdown.style.left = Math.min(rect.left, window.innerWidth - 220) + "px";
        dropdown.style.top = (rect.bottom + 6) + "px";
        dropdown.classList.toggle("open");
      });
    });
  }

  async function copyItem(item) {
    if (item.type !== "file") { toast("Copying folders isn't supported yet", "error"); return; }
    toast("Making a copy…");
    const res = await fetch(`${API}/api/file/${item.id}`);
    const blob = await res.blob();
    const dot = item.name.lastIndexOf(".");
    const ext = dot > 0 ? item.name.slice(dot) : "";
    const base = dot > 0 ? item.name.slice(0, dot) : item.name;
    const copyName = `${base} (copy)${ext}`;
    const file = new File([blob], copyName, { type: blob.type });
    const form = new FormData();
    form.append("files", file);
    form.append("parentId", currentFolderId == null ? "null" : currentFolderId);
    await api("/api/upload", { method: "POST", body: form });
    await refreshFromServer();
    toast(`Created "${copyName}"`, "success");
  }

  function icoDownload() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`; }
  function icoCopy() { return `<svg viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M4 16V6a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.6"/></svg>`; }
  function icoInfoIcon() { return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 11v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="8" r="0.9" fill="currentColor"/></svg>`; }

  /* ---------------- Upload handling ---------------- */

  async function handleFileList(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    try {
      await uploadFiles(files, currentFolderId);
      toast(`Added ${files.length} file${files.length === 1 ? "" : "s"}`, "success");
    } finally {
      render();
    }
  }

  async function handleDataTransferItems(items) {
    const entries = [];
    for (const it of items) {
      const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    if (!entries.length) return false;

    const flat = [];
    for (const entry of entries) await collectEntry(entry, "", flat);

    try {
      if (flat.length) await uploadStructured(flat, currentFolderId);
      toast(`Added ${flat.length} file${flat.length === 1 ? "" : "s"}`, "success");
    } finally {
      render();
    }
    return true;
  }

  function readEntryFile(entry) { return new Promise((resolve) => entry.file(resolve)); }
  function readDirEntries(reader) { return new Promise((resolve) => reader.readEntries(resolve)); }

  async function collectEntry(entry, prefix, out) {
    if (entry.isFile) {
      const file = await readEntryFile(entry);
      out.push({ file, relPath: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await readDirEntries(reader);
        for (const child of batch) await collectEntry(child, prefix + entry.name + "/", out);
      } while (batch.length > 0);
    }
  }

  /* ---------------- Drag & drop on window ---------------- */

  let dragCounter = 0;
  function setupDropzone() {
    const overlay = els.dropOverlay;
    window.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer || !e.dataTransfer.types.includes("Files")) return;
      dragCounter++;
      overlay.classList.add("active");
    });
    window.addEventListener("dragleave", () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) overlay.classList.remove("active");
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragCounter = 0;
      overlay.classList.remove("active");
      if (currentView !== "files") { toast("Switch to My Files to add items here"); return; }
      const dt = e.dataTransfer;
      if (dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
        const handled = await handleDataTransferItems(dt.items);
        if (!handled) await handleFileList(dt.files);
      } else {
        await handleFileList(dt.files);
      }
    });
  }

  /* ---------------- Wire up static controls ---------------- */

  function setupControls() {
    document.getElementById("sidebarCollapseBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("appRoot")?.classList.toggle("sidebar-collapsed");
    });
    document.querySelectorAll(".brand-left").forEach(el => {
      el.style.cursor = "pointer";
      el.addEventListener("click", refreshApp);
    });
    document.getElementById("menuToggle")?.addEventListener("click", () => {
      els.sidebar.classList.add("open"); els.sidebarOverlay.classList.add("open");
    });
    document.getElementById("mobileStorageBtn")?.addEventListener("click", () => {
      els.sidebar.classList.add("open"); els.sidebarOverlay.classList.add("open");
    });
    els.sidebarOverlay.addEventListener("click", () => {
      els.sidebar.classList.remove("open"); els.sidebarOverlay.classList.remove("open");
    });
    document.getElementById("sidebarCloseBtn")?.addEventListener("click", () => {
      els.sidebar.classList.remove("open"); els.sidebarOverlay.classList.remove("open");
    });

    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentView = btn.dataset.view;
        folderStack = []; currentFolderId = null; searchTerm = ""; selectedIds.clear();
        els.searchInput.value = "";
        els.sidebar.classList.remove("open"); els.sidebarOverlay.classList.remove("open");
        render();
      });
    });

    document.querySelectorAll("#viewToggle button").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#viewToggle button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        viewMode = btn.dataset.mode;
        render();
      });
    });

    els.searchInput.addEventListener("input", (e) => {
      searchTerm = e.target.value.trim();
      selectedIds.clear();
      render();
    });

    if (els.emptyTrashBtn) els.emptyTrashBtn.addEventListener("click", emptyTrash);

    document.getElementById("newFolderBtn").addEventListener("click", openNewFolderModal);

    const uploadBtn = document.getElementById("uploadBtn");
    const uploadMenu = els.uploadMenu;
    uploadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      uploadMenu.classList.toggle("open");
    });
    document.getElementById("uploadFilesOpt").addEventListener("click", () => {
      uploadMenu.classList.remove("open");
      document.getElementById("fileInput").click();
    });
    document.getElementById("uploadFolderOpt").addEventListener("click", () => {
      uploadMenu.classList.remove("open");
      document.getElementById("folderInput").click();
    });
    document.getElementById("fileInput").addEventListener("change", (e) => {
      handleFileList(e.target.files); e.target.value = "";
    });
    document.getElementById("folderInput").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files);
      const flat = files.map(f => ({ file: f, relPath: f.webkitRelativePath || f.name }));
      try {
        await uploadStructured(flat, currentFolderId);
        toast(`Added ${flat.length} file${flat.length === 1 ? "" : "s"}`, "success");
      } finally {
        render();
      }
      e.target.value = "";
    });

    document.getElementById("exportBackupBtn").addEventListener("click", exportBackup);
    document.getElementById("importBackupBtn").addEventListener("click", () => document.getElementById("restoreInput").click());
    document.getElementById("restoreInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) importBackup(file, currentFolderId);
      e.target.value = "";
    });

    els.modalBackdrop.addEventListener("click", (e) => { if (e.target === els.modalBackdrop) closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); closeContextMenu(); uploadMenu.classList.remove("open"); } });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".context-menu")) {
        closeContextMenu();
        document.querySelectorAll(".context-menu.open").forEach(m => m.classList.remove("open"));
      }
      if (!e.target.closest(".upload-wrap")) uploadMenu.classList.remove("open");
    });
  }

  /* ---------------- Init ---------------- */

  async function checkAppLock() {
    const hash = localStorage.getItem("safehaven_lock_hash");
    if (!hash) return true;
    if (sessionStorage.getItem("safehaven_unlocked") === "1") return true;

    return new Promise((resolve) => {
      document.body.insertAdjacentHTML("beforeend", `
        <div class="lock-screen" id="lockScreen">
          <div class="lock-card">
            <svg viewBox="0 0 24 24" fill="none" class="lock-icon"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.7"/></svg>
            <h2>Safe Haven is locked</h2>
            <p>Enter your password to continue.</p>
            <input type="password" id="lockPasswordInput" placeholder="Password" autofocus>
            <p class="lock-error" id="lockError" style="display:none;">Incorrect password.</p>
            <button class="btn-vault" id="lockUnlockBtn">Unlock</button>
          </div>
        </div>`);
      const input = document.getElementById("lockPasswordInput");
      const err = document.getElementById("lockError");
      const tryUnlock = async () => {
        const h = await hashPassword(input.value);
        if (h === hash) {
          sessionStorage.setItem("safehaven_unlocked", "1");
          document.getElementById("lockScreen").remove();
          resolve(true);
        } else {
          err.style.display = "block";
          input.value = "";
          input.focus();
        }
      };
      document.getElementById("lockUnlockBtn").addEventListener("click", tryUnlock);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
      input.focus();
    });
  }

  function wrapNavLabels() {
    document.querySelectorAll(".nav-item").forEach(btn => {
      if (btn.querySelector(".nav-label")) return;
      const textNode = Array.from(btn.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (textNode) {
        const span = document.createElement("span");
        span.className = "nav-label";
        span.textContent = textNode.textContent.trim();
        textNode.replaceWith(span);
      }
    });
  }

  async function init() {
    await checkAppLock();
    cacheEls();
    wrapNavLabels();
    drawTicks();
    setupControls();
    setupDropzone();

    let ok = false;
    try {
      ok = await refreshFromServer();
    } finally {
      if (!ok) toast("Starting up — trying to reach the Haven server…");
      render();
    }

    // background sync so a second tab / phone on the same network stays current
    setInterval(async () => {
      const beforeItems = JSON.stringify(allItems);
      const beforeBackups = JSON.stringify(backupsLog);
      const beforeStorage = storageUsed;
      const ok = await refreshFromServer();

      if (ok && (
        JSON.stringify(allItems) !== beforeItems ||
        JSON.stringify(backupsLog) !== beforeBackups ||
        storageUsed !== beforeStorage
      )) {
        render();
      }
    }, POLL_MS);
  }

  document.addEventListener("DOMContentLoaded", init);
})();