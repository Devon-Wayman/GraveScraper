const importForm = document.getElementById("importForm");
const importModal = document.getElementById("importModal");
const importStepText = document.getElementById("importStepText");
const importStatusLabel = document.getElementById("importStatusLabel");
const importCountLabel = document.getElementById("importCountLabel");
const importProgressFill = document.getElementById("importProgressFill");
const importMessageText = document.getElementById("importMessageText");
const importCloseButton = document.getElementById("importCloseButton");

let importPollTimer = null;
let connectivityNoticeTimer = null;

function showConnectivityNotice(message) {
  let notice = document.getElementById("connectivityNotice");

  if (!notice) {
    notice = document.createElement("div");
    notice.id = "connectivityNotice";
    notice.className = "connectivity-notice";
    notice.setAttribute("role", "status");
    document.body.appendChild(notice);
  }

  notice.textContent = message;
  notice.hidden = false;

  if (connectivityNoticeTimer) {
    window.clearTimeout(connectivityNoticeTimer);
  }

  connectivityNoticeTimer = window.setTimeout(() => {
    notice.hidden = true;
  }, 6000);
}

async function hasInternetConnection(targetUrl) {
  if (!window.navigator.onLine) {
    return false;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3500);

  try {
    const probeUrl = new URL("/favicon.ico", targetUrl);

    await fetch(probeUrl.href, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal
    });

    return true;
  } catch (_error) {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

document.querySelectorAll("a[data-requires-internet]").forEach((link) => {
  link.addEventListener("click", async (event) => {
    event.preventDefault();

    const isConnected = await hasInternetConnection(link.href);

    if (!isConnected) {
      showConnectivityNotice("An internet connection is needed to open FindAGrave or Google Maps.");
      return;
    }

    window.open(link.href, link.target || "_blank", "noopener,noreferrer");
  });
});

// Keeps all import modal copy in one place so status wording is easy to maintain.
function setModalState({
  step = "Preparing import request.",
  status = "Starting",
  count = "0 / 0 memorials",
  percent = 0,
  message = "Waiting for the server to begin processing."
}) {
  importStepText.textContent = step;
  importStatusLabel.textContent = status;
  importCountLabel.textContent = count;
  importProgressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  importMessageText.textContent = message;
}

// Shows the modal while a background import is running.
function openModal() {
  importModal.hidden = false;
}

// Hides the modal and cancels any scheduled polling retry.
function closeModal() {
  importModal.hidden = true;
  if (importPollTimer) {
    window.clearTimeout(importPollTimer);
    importPollTimer = null;
  }
}

// Polls the import status endpoint until the job reaches a terminal state.
async function pollImport(importId) {
  const response = await fetch(`/api/imports/${importId}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Unable to read import progress.");
  }

  const total = Number(data.total_memorials || 0);
  const processed = Number(data.processed_memorials || 0);

  setModalState({
    step: data.current_step || "Import running",
    status: data.status || "running",
    count: `${processed} / ${total} memorials`,
    percent: Number(data.progress_percent || 0),
    message: data.message || "Working..."
  });

  if (data.status === "completed") {
    // Reload to surface the newly imported cemetery data without asking the user to refresh manually.
    importCloseButton.hidden = false;
    importCloseButton.onclick = () => window.location.reload();
    return;
  }

  if (data.status === "failed") {
    importCloseButton.hidden = false;
    importCloseButton.onclick = closeModal;
    return;
  }

  // Poll on a timer so the UI stays responsive instead of looping aggressively.
  importPollTimer = window.setTimeout(() => {
    pollImport(importId).catch((error) => {
      setModalState({
        step: "Progress polling failed",
        status: "error",
        percent: 0,
        message: error.message
      });
      importCloseButton.hidden = false;
      importCloseButton.onclick = closeModal;
    });
  }, 1200);
}

if (importForm) {
  importForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(importForm);
    const cemeteryUrl = String(formData.get("cemeteryUrl") || "").trim();

    if (!cemeteryUrl) {
      return;
    }

    importCloseButton.hidden = true;
    setModalState({
      step: "Parsing cemetery URL",
      status: "starting",
      count: "0 / 0 memorials",
      percent: 2,
      message: "Creating the import job and preparing the first request."
    });

    openModal();

    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ cemeteryUrl })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to start import.");
      }

      setModalState({
        step: "Import job started",
        status: "queued",
        count: "0 / 0 memorials",
        percent: 4,
        message: "The server accepted the request and is starting the sync."
      });

      // Once the server has accepted the job, switch over to the progress poller.
      pollImport(data.importId).catch((error) => {
        setModalState({
          step: "Import failed",
          status: "error",
          count: "0 / 0 memorials",
          percent: 0,
          message: error.message
        });
        importCloseButton.hidden = false;
        importCloseButton.onclick = closeModal;
      });
    } catch (error) {
      setModalState({
        step: "Import could not start",
        status: "error",
        count: "0 / 0 memorials",
        percent: 0,
        message: error.message
      });
      importCloseButton.hidden = false;
      importCloseButton.onclick = closeModal;
    }
  });
}
