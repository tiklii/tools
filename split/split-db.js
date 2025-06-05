let book;
let lastClickedButton = null;
let originalText = null; // Store the original unformatted text
const dbName = "epubChunkerDB";
const dbVersion = 3; // Keep version 3
const epubStoreName = "epubs";
const usageCounterKey = 'epubUsageCounter';

function createUniqueFileKey(file) {
  // Combines filename and last modified timestamp for a very unique key
  return `${file.name.toLowerCase()}_${file.lastModified}`;
}

// --- Helper functions for Reference Counting ---

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

// This function ONLY decrements. It does NOT delete.
function decrementEpubUsage(uniqueKey) {
  if (!uniqueKey) return;
  const counter = getUsageCounter();
  if (counter.hasOwnProperty(uniqueKey)) {
    counter[uniqueKey] = Math.max(0, counter[uniqueKey] - 1); // Don't go below 0
    console.log(`Decremented usage count for ${uniqueKey} to ${counter[uniqueKey]}`);
  }
  setUsageCounter(counter);
}

// --- IndexedDB Functions ---

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

async function storeEpub(file) {
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
    request.onsuccess = function() {
      console.log(`EPUB "${file.name}" stored in IndexedDB with key "${uniqueKey}".`);
      resolve();
    };
    request.onerror = function() {
      console.error("Error storing EPUB:", request.error);
      reject("Error storing EPUB: " + request.error);
    };
  });
}

async function getEpub(uniqueKey) {
  const db = await openDatabase();
  const transaction = db.transaction([epubStoreName], "readonly");
  const store = transaction.objectStore(epubStoreName);
  const request = store.get(uniqueKey);
  return new Promise((resolve, reject) => {
    request.onsuccess = function() {
      if (request.result) {
        console.log(`EPUB with key "${uniqueKey}" retrieved from IndexedDB.`);
        resolve(request.result.blob);
      } else {
        console.log(`EPUB with key "${uniqueKey}" not found in IndexedDB.`);
        resolve(null);
      }
    };
    request.onerror = function() {
      console.error("Error retrieving EPUB:", request.error);
      reject("Error retrieving EPUB: " + request.error);
    };
  });
}

async function deleteEpub(uniqueKey) {
  const db = await openDatabase();
  const transaction = db.transaction([epubStoreName], "readwrite");
  const store = transaction.objectStore(epubStoreName);
  const request = store.delete(uniqueKey);

  return new Promise((resolve, reject) => {
    request.onsuccess = function() {
      console.log(`Successfully deleted orphan EPUB "${uniqueKey}" from IndexedDB.`);
      resolve();
    };
    request.onerror = function() {
      console.error("Error deleting EPUB:", request.error);
      reject(request.error);
    };
  });
}

// Startup Cleanup Function
async function cleanupOrphanedEpubs() {
  console.log("Running startup cleanup for orphaned EPUBs...");
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
      await deleteEpub(key);
      delete counter[key]; // Remove from counter object after successful deletion
    }
    setUsageCounter(counter); // Save the cleaned counter
  } else {
    console.log("No orphaned EPUBs found.");
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

async function loadChapterAndSaveState(event) {
  const tocListItems = document.querySelectorAll('#tocList li');
  tocListItems.forEach(item => item.classList.remove('selected'));
  event.target.classList.add('selected');
  const selectedHref = event.target.dataset.href;
  const tocContainer = document.getElementById('tocContainer');
  sessionStorage.setItem('currentChapterHref', selectedHref);
  sessionStorage.setItem('currentTocScrollTop', tocContainer.scrollTop);
  try {
    const chapter = await book.load(selectedHref);
    originalText = extractText(chapter);
    document.getElementById('chapterContent').value = originalText;
    formatText();
    updateCharCount();
  } catch (error) {
    console.error("Error loading chapter:", error);
    alert("Failed to load chapter. See console for details.");
  }
}

function extractText(chapterDocument) {
  return chapterDocument.body.innerText.trim();
}

function chunkText() {
  const text = document.getElementById('chapterContent').value;
  const maxChars = parseInt(document.getElementById('maxChars').value);
  const addToTop = document.getElementById('addToTop').value.trim();
  const addToBottom = document.getElementById('addToBottom').value.trim();
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

// Initial load logic with the corrected order of operations
document.addEventListener('DOMContentLoaded', async () => {
  // Step 1: Identify the EPUB for this tab
  const currentEpubKey = sessionStorage.getItem('currentEpubKey');

  // Step 2: If this tab expects an EPUB, immediately increment its usage count.
  // This is the CRITICAL FIX. We "claim" the file before cleanup runs,
  // preventing it from being deleted during a reload.
  if (currentEpubKey) {
    incrementEpubUsage(currentEpubKey);
  }

  // Step 3: Now that this tab has claimed its file, run cleanup.
  // This will now only delete TRULY orphaned files from other closed tabs.
  await cleanupOrphanedEpubs();

  // Step 4: Setup UI and proceed with loading the claimed EPUB
  const maxCharsInput = document.getElementById('maxChars');
  const addToTopInput = document.getElementById('addToTop');
  const addToBottomInput = document.getElementById('addToBottom');
  const formatSelect = document.getElementById('formatSelect');
  const chapterContentTextArea = document.getElementById('chapterContent');

  maxCharsInput.value = localStorage.getItem('maxChars') || '1800';
  addToTopInput.value = localStorage.getItem('addToTop') || 'Translate to English (part $X of $Y):';
  addToBottomInput.value = localStorage.getItem('addToBottom') || '';
  formatSelect.value = localStorage.getItem('formatSelect') || 'pretty';

  maxCharsInput.addEventListener('input', () => localStorage.setItem('maxChars', maxCharsInput.value));
  addToTopInput.addEventListener('input', () => localStorage.setItem('addToTop', addToTopInput.value));
  addToBottomInput.addEventListener('input', () => localStorage.setItem('addToBottom', addToBottomInput.value));
  formatSelect.addEventListener('change', () => {
    localStorage.setItem('formatSelect', formatSelect.value);
    formatText();
  });
  chapterContentTextArea.addEventListener('input', updateCharCount);

  // Use the key we already retrieved and claimed.
  if (currentEpubKey) {
    try {
      const epubBlob = await getEpub(currentEpubKey);
      if (epubBlob) {
        book = ePub(epubBlob);
        const toc = await book.loaded.navigation;
        renderToc(toc);
        restoreTocState();
      } else {
        // This can happen if the DB was cleared manually.
        // We must undo the increment we performed earlier.
        console.error(`EPUB key ${currentEpubKey} was in session but not in DB.`);
        decrementEpubUsage(currentEpubKey);
        sessionStorage.clear();
      }
    } catch (error) {
      console.error("Error loading EPUB on startup:", error);
      // Also undo the increment on any other error.
      decrementEpubUsage(currentEpubKey);
      sessionStorage.clear();
      alert("Failed to load the EPUB. It may have been removed. Please select the file again.");
    }
  }

  formatText();
  updateCharCount();
});

// File input listener
document.getElementById('epubInput').addEventListener('change', async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Decrement usage of the OLD file before loading a new one
  const oldEpubKey = sessionStorage.getItem('currentEpubKey');
  decrementEpubUsage(oldEpubKey);
  sessionStorage.clear();

  if (file.name.toLowerCase().endsWith('.epub')) {
    const uniqueKey = createUniqueFileKey(file);
    try {
      await storeEpub(file);
      sessionStorage.setItem('currentEpubKey', uniqueKey);
      // Increment usage for the NEW file
      incrementEpubUsage(uniqueKey);

      book = ePub(file);
      const toc = await book.loaded.navigation;
      renderToc(toc);

      document.getElementById('chapterContent').value = '';
      originalText = null;
      updateCharCount();
      document.getElementById('chunkedTextContainer').innerHTML = '';

    } catch (error) {
      console.error("Error handling file input:", error);
      // If storing/loading fails, we must undo the increment
      decrementEpubUsage(uniqueKey);
      sessionStorage.clear();
      alert("Failed to load or store EPUB. See console for details.");
    }
  } else if (file.name.toLowerCase().endsWith('.txt')) {
    const reader = new FileReader();
    reader.onload = function(e) {
      originalText = e.target.result;
      document.getElementById('chapterContent').value = originalText;
      formatText();
      updateCharCount();
      document.getElementById('chunkedTextContainer').innerHTML = '';
    }
    reader.readAsText(file);
  } else {
    alert("Unsupported file type. Please upload .epub or .txt files.");
    event.target.value = '';
  }
});

// Unload listener - This ONLY decrements.
window.addEventListener('beforeunload', () => {
  const currentEpubKey = sessionStorage.getItem('currentEpubKey');
  decrementEpubUsage(currentEpubKey);
});
