let book;
let lastClickedButton = null;
let originalText = null;
const dbName = "epubChunkerDB";
const dbVersion = 3;
const epubStoreName = "epubs";
const usageCounterKey = 'epubUsageCounter';
const sessionKey = 'currentFileKey'; // Generic key for sessionStorage

function createUniqueFileKey(file) {
  return `${file.name.toLowerCase()}_${file.lastModified}`;
}

// --- Helper functions for Reference Counting (Unchanged) ---
function getUsageCounter() {
  try {
    const counter = localStorage.getItem(usageCounterKey);
    return counter ? JSON.parse(counter) : {};
  } catch (e) {
    console.error("Could not parse usage counter, resetting.", e);
    return {};
  }
}

function setUsageCounter(counter) {
  localStorage.setItem(usageCounterKey, JSON.stringify(counter));
}

function incrementEpubUsage(uniqueKey) {
  if (!uniqueKey) return;
  const counter = getUsageCounter();
  counter[uniqueKey] = (counter[uniqueKey] || 0) + 1;
  setUsageCounter(counter);
  console.log(`Usage count for ${uniqueKey} is now ${counter[uniqueKey]}`);
}

function decrementEpubUsage(uniqueKey) {
  if (!uniqueKey) return;
  const counter = getUsageCounter();
  if (counter.hasOwnProperty(uniqueKey)) {
    counter[uniqueKey] = Math.max(0, counter[uniqueKey] - 1);
    console.log(`Decremented usage count for ${uniqueKey} to ${counter[uniqueKey]}`);
  }
  setUsageCounter(counter);
}


// --- Generic IndexedDB Functions ---

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = function(event) {
      const db = event.target.result;
      if (db.objectStoreNames.contains(epubStoreName)) {
        db.deleteObjectStore(epubStoreName);
      }
      db.createObjectStore(epubStoreName, {
        keyPath: "uniqueKey"
      });
    };

    request.onsuccess = function(event) {
      resolve(event.target.result);
    };

    request.onerror = function(event) {
      reject("Error opening database: " + event.target.errorCode);
    };
  });
}

async function storeFileInDB(file) {
  const db = await openDatabase();
  const transaction = db.transaction([epubStoreName], "readwrite");
  const store = transaction.objectStore(epubStoreName);
  const uniqueKey = createUniqueFileKey(file);
  const data = {
    uniqueKey: uniqueKey,
    fileName: file.name,
    blob: file,
    timestamp: new Date()
  };
  const request = store.put(data);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getFileRecordFromDB(uniqueKey) {
  const db = await openDatabase();
  const transaction = db.transaction([epubStoreName], "readonly");
  const store = transaction.objectStore(epubStoreName);
  const request = store.get(uniqueKey);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteFileFromDB(uniqueKey) {
  const db = await openDatabase();
  const transaction = db.transaction([epubStoreName], "readwrite");
  const store = transaction.objectStore(epubStoreName);
  const request = store.delete(uniqueKey);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      console.log(`Successfully deleted orphan file "${uniqueKey}" from IndexedDB.`);
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

async function cleanupOrphanedFiles() {
  console.log("Running startup cleanup for orphaned files...");
  const counter = getUsageCounter();
  const keysToDelete = [];
  for (const key in counter) {
    if (counter.hasOwnProperty(key) && counter[key] <= 0) {
      keysToDelete.push(key);
    }
  }
  if (keysToDelete.length > 0) {
    console.log("Found orphans to delete:", keysToDelete);
    for (const key of keysToDelete) {
      await deleteFileFromDB(key);
      delete counter[key];
    }
    setUsageCounter(counter);
  } else {
    console.log("No orphaned files found.");
  }
}

// --- UI and Utility Functions ---

function updateButtonState(button) {
  if (lastClickedButton && lastClickedButton !== button) {
    lastClickedButton.classList.remove('green');
    lastClickedButton.querySelector('.tick').style.display = 'none';
  }
  button.classList.add('green');
  button.querySelector('.tick').style.display = 'inline-block';
  lastClickedButton = button;
}

function updateCharCount() {
  const text = document.getElementById('chapterContent').value;
  document.getElementById('charCount').textContent = `Total characters: ${text.length}`;
}

async function loadChapterContent(href) {
  try {
    const chapter = await book.load(href);
    originalText = extractText(chapter);
    document.getElementById('chapterContent').value = originalText;
    formatText();
    updateCharCount();
  } catch (error) {
    console.error("Error loading chapter content:", error);
  }
}

async function loadChapterAndSaveState(event) {
  event.stopPropagation(); // PREVENT PARENT CLICKS

  // RESET COPY BUTTON STATE
  const copyBtn = document.getElementById('copyChapterButton');
  copyBtn.classList.remove('green');
  copyBtn.querySelector('.tick').style.display = 'none';
  if (lastClickedButton === copyBtn) lastClickedButton = null;

  const tocListItems = document.querySelectorAll('#tocList li');
  tocListItems.forEach(item => item.classList.remove('selected'));
  event.target.classList.add('selected');

  const selectedHref = event.target.dataset.href;
  const tocContainer = document.getElementById('tocContainer');

  sessionStorage.setItem('currentChapterHref', selectedHref);
  sessionStorage.setItem('currentTocScrollTop', tocContainer.scrollTop);

  await loadChapterContent(selectedHref);
}

function extractText(chapterDocument) {
  return chapterDocument.body.innerText.trim();
}

function renderToc(toc) {
  const tocList = document.getElementById('tocList');
  tocList.innerHTML = '';
  function addTocItems(items, parentElement) {
    items.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item.label.trim();
      li.dataset.href = item.href;
      li.addEventListener('click', loadChapterAndSaveState);
      parentElement.appendChild(li);
      if (item.subitems && item.subitems.length > 0) {
        const ul = document.createElement('ul');
        addTocItems(item.subitems, ul);
        li.appendChild(ul);
      }
    });
  }
  addTocItems(toc, tocList);
}

function restoreTocState() {
  const currentChapterHref = sessionStorage.getItem('currentChapterHref');
  const tocScrollTop = sessionStorage.getItem('currentTocScrollTop');
  const tocContainer = document.getElementById('tocContainer');

  if (currentChapterHref) {
    const tocListItems = document.querySelectorAll('#tocList li');
    let selectedElement = null;
    tocListItems.forEach(item => {
      item.classList.remove('selected');
      if (item.dataset.href === currentChapterHref) {
        item.classList.add('selected');
        selectedElement = item;
      }
    });
    if (selectedElement) {
      setTimeout(() => {
        selectedElement.scrollIntoView({
          block: 'nearest'
        });
      }, 50);
    }
  }
  if (tocScrollTop !== null) {
    tocContainer.scrollTop = parseInt(tocScrollTop, 10);
  }
}

function chunkText(ignoreExtras = false) {
  const text = document.getElementById('chapterContent').value;
  const maxChars = parseInt(document.getElementById('maxChars').value);
  
  let addToTop = ignoreExtras ? "" : document.getElementById('addToTop').value.trim();
  let addToBottom = ignoreExtras ? "" : document.getElementById('addToBottom').value.trim();

  const paragraphs = text.split('\n');
  const chunks = [];
  let currentChunk = "";
  for (const paragraph of paragraphs) {
    const paragraphToAdd = currentChunk.length > 0 ? '\n' + paragraph : paragraph;
    if ((currentChunk.length + paragraphToAdd.length) <= maxChars) {
      currentChunk += paragraphToAdd;
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = paragraph;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  const totalChunks = chunks.length;
  const chunkedTextContainer = document.getElementById('chunkedTextContainer');
  chunkedTextContainer.innerHTML = '';
  const digits = String(totalChunks).length;
  chunks.forEach((chunk, index) => {
    const partNumber = String(index + 1).padStart(digits, '0');
    let finalChunk = (addToTop.replace('$X', partNumber).replace('$Y', totalChunks) + '\n\n' + chunk + '\n\n' + addToBottom.replace('$X', partNumber).replace('$Y', totalChunks)).trim();
    const chunkContainer = document.createElement('div');
    chunkContainer.classList.add('chunk-container');
    const chunkTitle = document.createElement('div');
    chunkTitle.classList.add('chunk-title');
    chunkTitle.textContent = `Part ${partNumber}`;
    const chunkTextarea = document.createElement('textarea');
    chunkTextarea.value = finalChunk;
    chunkTextarea.readOnly = true;
    const copyButton = document.createElement('button');
    copyButton.classList.add('copy-button');
    copyButton.innerHTML = 'Copy to Clipboard<span class="tick">✔️</span>';
    copyButton.addEventListener('click', function() {
      copyToClipboard(chunkTextarea.value);
      updateButtonState(copyButton);
    });
    chunkContainer.appendChild(chunkTitle);
    chunkContainer.appendChild(chunkTextarea);
    chunkContainer.appendChild(copyButton);
    chunkedTextContainer.appendChild(chunkContainer);
  });
}

function copyToClipboard(text) {
  const hiddenInput = document.createElement('textarea');
  hiddenInput.value = text;
  document.body.appendChild(hiddenInput);
  hiddenInput.select();
  try {
    document.execCommand('copy');
  } catch (err) {
    console.error('Copy to clipboard failed:', err);
  }
  document.body.removeChild(hiddenInput);
}

function formatText() {
  const formatSelect = document.getElementById('formatSelect');
  const textArea = document.getElementById('chapterContent');
  if (originalText === null && textArea.value) {
    originalText = textArea.value;
  }
  if (formatSelect.value === 'pretty' && originalText) {
    const paragraphs = originalText.split('\n');
    const formattedText = paragraphs.map(p => p.trim()).filter(p => p).join('\n\n');
    textArea.value = formattedText;
  } else if (originalText) {
    textArea.value = originalText;
  }
  updateCharCount();
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', async () => {
  const currentFileKey = sessionStorage.getItem(sessionKey);

  if (currentFileKey) {
    incrementEpubUsage(currentFileKey);
  }
  await cleanupOrphanedFiles();

  // UI Setup
  const maxCharsInput = document.getElementById('maxChars');
  maxCharsInput.value = localStorage.getItem('maxChars') || '1800';
  maxCharsInput.addEventListener('input', () => localStorage.setItem('maxChars', maxCharsInput.value));
  const addToTopInput = document.getElementById('addToTop');
  addToTopInput.value = localStorage.getItem('addToTop') || 'Translate to English (part $X of $Y):';
  addToTopInput.addEventListener('input', () => localStorage.setItem('addToTop', addToTopInput.value));
  const addToBottomInput = document.getElementById('addToBottom');
  addToBottomInput.value = localStorage.getItem('addToBottom') || '';
  addToBottomInput.addEventListener('input', () => localStorage.setItem('addToBottom', addToBottomInput.value));
  const formatSelect = document.getElementById('formatSelect');
  formatSelect.value = localStorage.getItem('formatSelect') || 'pretty';
  formatSelect.addEventListener('change', () => {
    localStorage.setItem('formatSelect', formatSelect.value);
    formatText();
  });
  document.getElementById('chapterContent').addEventListener('input', updateCharCount);
  document.getElementById('copyChapterButton').addEventListener('click', function() {
    const chapterText = document.getElementById('chapterContent').value;
    copyToClipboard(chapterText);
    updateButtonState(this);
  });

  // Split Button Hold Logic
  const splitBtn = document.getElementById('splitButton');
  let pressTimer;
  let isLongPress = false;

  splitBtn.addEventListener('pointerdown', () => {
    isLongPress = false;
    pressTimer = window.setTimeout(() => {
      isLongPress = true;
      chunkText(true); // Split ignoring extras
    }, 600); // 600ms threshold for "short hold"
  });

  splitBtn.addEventListener('pointerup', () => clearTimeout(pressTimer));
  splitBtn.addEventListener('pointerleave', () => clearTimeout(pressTimer));

  splitBtn.addEventListener('click', () => {
    if (!isLongPress) {
      chunkText(false); // Normal split
    }
  });


  // File Restoration Logic
  if (currentFileKey) {
    try {
      const record = await getFileRecordFromDB(currentFileKey);
      if (!record) throw new Error("File not found in DB.");

      if (record.fileName.endsWith('.epub')) {
        book = ePub(record.blob);
        const toc = await book.loaded.navigation;
        renderToc(toc);
        restoreTocState();
        const lastChapter = sessionStorage.getItem('currentChapterHref');
        if (lastChapter) {
          await loadChapterContent(lastChapter);
        }
      } else if (record.fileName.endsWith('.txt') || record.fileName.endsWith('.md')) {
        originalText = await record.blob.text();
        document.getElementById('chapterContent').value = originalText;
        formatText();
      }

    } catch (error) {
      console.error("Error restoring file on startup:", error);
      decrementEpubUsage(currentFileKey);
      sessionStorage.clear();
    }
  }

  updateCharCount();
});

document.getElementById('epubInput').addEventListener('change', async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const oldFileKey = sessionStorage.getItem(sessionKey);
  decrementEpubUsage(oldFileKey);
  sessionStorage.clear();
  document.getElementById('tocList').innerHTML = '';
  document.getElementById('chapterContent').value = '';
  originalText = null;
  updateCharCount();

  const uniqueKey = createUniqueFileKey(file);
  const fileType = file.name.toLowerCase();

  if (fileType.endsWith('.epub') || fileType.endsWith('.txt') || fileType.endsWith('.md')) {
    try {
      await storeFileInDB(file);
      sessionStorage.setItem(sessionKey, uniqueKey);
      incrementEpubUsage(uniqueKey);

      if (fileType.endsWith('.epub')) {
        book = ePub(file);
        const toc = await book.loaded.navigation;
        renderToc(toc);
      } else { // It's a .txt or .md file
        originalText = await file.text();
        document.getElementById('chapterContent').value = originalText;
        formatText();
        updateCharCount();
      }

    } catch (error) {
      console.error("Error handling file input:", error);
      decrementEpubUsage(uniqueKey);
      sessionStorage.clear();
      alert("Failed to load or store file. See console for details.");
    }
  } else {
    alert("Unsupported file type. Please upload .epub, .txt, or .md files.");
  }
  // THE FIX: This line has been removed.
  // event.target.value = '';
});

window.addEventListener('beforeunload', () => {
  const currentFileKey = sessionStorage.getItem(sessionKey);
  decrementEpubUsage(currentFileKey);
});
