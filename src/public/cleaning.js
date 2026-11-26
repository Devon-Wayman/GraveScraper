const dialogOpeners = new WeakMap();

function openCleaningDialog(id, opener, sessionId, stage) {
  const dialog = document.getElementById(id);
  if (!dialog) return;

  const existing = document.querySelector(".cleaning-dialog[open]");

  if (existing?.dataset.busy === "true") return;

  if (existing) {
    existing.close();
  }

  const chooser = dialog.querySelector("[data-upload-session]");

  if (chooser && sessionId && Array.from(chooser.options).some(option => option.value === sessionId)) {
    chooser.value = sessionId;
    chooser.dispatchEvent(new Event("change"));
  }

  if (stage && dialog.querySelector('[name="stage"]')) {
    dialog.querySelector('[name="stage"]').value = stage;
  }

  dialogOpeners.set(dialog, existing && opener && existing.contains(opener) ? dialogOpeners.get(existing) : opener || document.activeElement);
  dialog.showModal();
  document.documentElement.classList.add("cleaning-modal-open");
}

document.querySelectorAll("[data-open-dialog]").forEach(button => {
  button.addEventListener("click", () => openCleaningDialog(button.dataset.openDialog, button, button.dataset.sessionId, button.dataset.stage));
});

document.querySelectorAll(".cleaning-dialog").forEach(dialog => {
  dialog.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => {
    if (dialog.dataset.busy !== "true") {
      dialog.close();
    }
  }));
  dialog.addEventListener("cancel", event => { if (dialog.dataset.busy === "true") event.preventDefault(); });
  dialog.addEventListener("close", () => {

    if (!document.querySelector(".cleaning-dialog[open]")) {
      document.documentElement.classList.remove("cleaning-modal-open");
    }

    dialogOpeners.get(dialog)?.focus();
  });
});

document.querySelectorAll("[data-upload-session]").forEach(select => {
  select.addEventListener("change", () => {
    select.form.action = `/cleaning-sessions/${encodeURIComponent(select.value)}/photos`;
    select.form.querySelector('[name="stage"]').value = select.selectedOptions[0].dataset.entryType === "pre-cleaning" ? "before" : "during";
  });
});

document.querySelectorAll("[data-local-date]").forEach(input => {
  const now = new Date();
  input.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
});

document.querySelectorAll(".photo-upload-form").forEach(form => {
  const photoInput = form.querySelector('input[type="file"]');
  let selection = 0;
  photoInput.addEventListener("change", async () => {
    const token = ++selection;
    const files = Array.from(photoInput.files);
    const hint = form.querySelector(".capture-date-status");
    const list = form.querySelector(".capture-date-list");
    list.replaceChildren();
    hint.textContent = `${files.length} photo(s) selected. Leave the date blank to use each capture date; an entered date applies to all selected photos.`;

    if (files.length > 20) {
      hint.textContent = "Select up to 20 photos per upload."; return;
    }

    for (const file of files) {
      let date = "";

      try {
        if (file.size <= 20 * 1024 * 1024 && window.exifr) {
          const tags = await window.exifr.parse(file, { pick: ["DateTimeOriginal", "CreateDate"], reviveValues: false });
          for (const key of ["DateTimeOriginal", "CreateDate"]) {
            const match = String(tags?.[key] || "").match(/^(\d{4}):(\d{2}):(\d{2})/);
            if (match) {
              date = `${match[1]}-${match[2]}-${match[3]}`;
              break;
            }
          }
        }
      } catch { /* The server validates each date and image on upload. */ }

      if (token !== selection) return;

      const item = document.createElement("li");
      item.textContent = `${file.name}: ${file.size > 20 * 1024 * 1024 ? "exceeds 20 MB" : date || "no date detected; enter a date if needed"}`;
      list.append(item);
    }
  });

  form.addEventListener("submit", event => {
    event.preventDefault();
    const button = form.querySelector("[data-upload-submit]");
    const status = form.querySelector(".upload-status");
    const files = Array.from(photoInput.files);

    if (!files.length || files.length > 20 || files.some(file => file.size > 20 * 1024 * 1024)) {
      status.textContent = "Choose 1–20 photos, up to 20 MB each.";
      return;
    }

    const request = new XMLHttpRequest();
    request.open("POST", `/api/v1${new URL(form.action).pathname}`);
    request.timeout = 1200000;
    const body = new FormData(form);
    const controls = Array.from(form.querySelectorAll("input, select, textarea, button"));
    const dialog = form.closest("dialog");
    const closeButtons = Array.from(dialog?.querySelectorAll("[data-close-dialog]") || []);

    if (dialog) dialog.dataset.busy = "true";

    closeButtons.forEach(control => { control.disabled = true; });
    controls.forEach(control => { control.disabled = true; });
    button.disabled = true;
    status.textContent = `Uploading ${files.length} photo(s)…`;
    request.upload.onprogress = event => {

      if (event.lengthComputable) {
        const percent = Math.round(event.loaded / event.total * 100);
        status.textContent = percent === 100 ? `Upload received. Processing ${files.length} photo(s)…` : `Uploading ${files.length} photo(s): ${percent}%`;
      }
    };
    const failed = message => {
      controls.concat(closeButtons).forEach(control => { control.disabled = false; });

      if (dialog) {
        dialog.dataset.busy = "false";
      }

      status.textContent = message;
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        let photoId;
        try {
          const saved = JSON.parse(request.responseText); photoId = saved.photos?.[0]?.photo_id || saved.photo?.photo_id;
        } catch { /* Fall back to the selected entry. */ }

        window.location.hash = photoId ? `photo-${photoId}` : `session-${form.querySelector("[data-upload-session]").value}`;
        window.location.reload();
      } else {
        let message = "Upload failed. Please try again.";
        try {
          message = JSON.parse(request.responseText).error || message;
        } catch { /* Non-JSON proxy response. */ }

        failed(message);
      }
    };

    request.onerror = () => failed("Connection lost. Reconnect to the VPN and try again.");
    request.ontimeout = () => failed("Upload timed out. Check the session before retrying; the photos may have arrived.");
    request.send(body);
  });
});

const requestedPhotos = new URLSearchParams(window.location.search).get("addPhotos");

function revealCleaningEntry() {
  const entry = document.getElementById(window.location.hash.slice(1));
  const session = entry?.closest(".timeline-session");
  if (session) {
    session.open = true;
    const update = entry.closest(".timeline-update") || session.querySelector(".timeline-update");
    if (update) {
      update.open = true;
    }
    if (entry !== session) {
      requestAnimationFrame(() => entry.scrollIntoView({ block: "center" }));
    }
  }
}

revealCleaningEntry();
window.addEventListener("hashchange", revealCleaningEntry);

if (requestedPhotos) {
  openCleaningDialog("upload-photos-dialog", null, requestedPhotos, "before");
  const url = new URL(window.location.href);
  url.searchParams.delete("addPhotos");
  window.history.replaceState(null, "", url);
}
