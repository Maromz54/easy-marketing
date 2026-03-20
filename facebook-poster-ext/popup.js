const apiUrlInput = document.getElementById("apiUrl");
const secretInput = document.getElementById("secret");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const dot = document.getElementById("dot");
const indicatorText = document.getElementById("indicatorText");

// Load saved values on popup open
chrome.storage.sync.get(["apiBaseUrl", "extensionSecret"], ({ apiBaseUrl, extensionSecret }) => {
  if (apiBaseUrl) apiUrlInput.value = apiBaseUrl;
  if (extensionSecret) secretInput.value = extensionSecret;
  updateIndicator(!!apiBaseUrl && !!extensionSecret);
});

saveBtn.addEventListener("click", () => {
  const url = apiUrlInput.value.trim().replace(/\/$/, ""); // strip trailing slash
  const secret = secretInput.value.trim();

  if (!url) {
    showStatus("error", "נא להזין כתובת API.");
    return;
  }
  if (!secret) {
    showStatus("error", "נא להזין את המפתח הסודי.");
    return;
  }

  chrome.storage.sync.set({ apiBaseUrl: url, extensionSecret: secret }, () => {
    showStatus("success", "הגדרות נשמרו בהצלחה! התוסף יבדוק פוסטים ממתינים בדקה הקרובה.");
    updateIndicator(true);
  });
});

function showStatus(type, message) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function updateIndicator(configured) {
  dot.className = configured ? "dot active" : "dot";
  indicatorText.textContent = configured ? "מוגדר ופעיל" : "לא מוגדר";
}
