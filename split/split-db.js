let book;
let lastClickedButton = null;
let originalText = null;
const dbName = "epubChunkerDB";
const dbVersion = 3; // MODIFIED: Increment DB version to trigger schema update
const epubStoreName = "epubs";

// NEW: Helper function to create a robust, unique key for a file
function createUniqueFileKey(file) {
  // Combines filename and last modified timestamp for a very unique key
  return `${file.name.toLowerCase()}_${file.lastModified}`;
}


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

// IndexedDB Functions
async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = function(event) {
      const db = event.target.result;
      // MODIFIED: Re-create the object store with the new keyPath
      if (db.objectStoreNames.contains(epubStoreName)) {
        db.deleteObjectStore(epubStoreName);
      }
      db.createObjectStore(epubStoreName, {
        keyPath: "uniqueKey" // MODIFIED: The new primary key
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

// MODIFIED: Function now accepts the full File object to create the key
async function storeEpub(file) {
  const db = await openDatabase();
  const transaction = db.transaction([epubStoreName], "readwrite");
  const store = transaction.objectStore(epubStoreName);

  const uniqueKey = createUniqueFileKey(file);

  const data = {
    uniqueKey: uniqueKey, // The new primary key
    fileName: file.name, // We still store the original filename for display
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

// MODIFIED: Function now gets by the unique key
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

// TOC and State functions remain the same, as they don't interact with the DB directly
function renderToc(toc) { /* ... no changes ... */ }
function restoreTocState() { /* ... no changes ... */ }
async function loadChapterAndSaveState(event) { /* ... no changes ... */ }
function extractText(chapterDocument) { /* ... no changes ... */ }

// Chunking and UI functions remain the same
function chunkText() { /* ... no changes ... */ }
function copyToClipboard(text) { /* ... no changes ... */ }
function formatText() { /* ... no changes ... */ }


// --- Functions from above that have no changes ---
function renderToc(toc) {
  const tocList = document.getElementById('tocList');
  tocList.innerHTML = ''; // Clear previous TOC

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
// --- END of unchanged functions ---


// Initial load logic
document.addEventListener('DOMContentLoaded', async () => {
  const maxCharsInput = document.getElementById('maxChars');
  const addToTopInput = document.getElementById('addToTop');
  const addToBottomInput = document.getElementById('addToBottom');
  const formatSelect = document.getElementById('formatSelect');
  const chapterContentTextArea = document.getElementById('chapterContent');

  // Global settings in localStorage are fine
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

  // MODIFIED: Load EPUB using the unique key from sessionStorage
  const currentEpubKey = sessionStorage.getItem('currentEpubKey');
  if (currentEpubKey) {
    try {
      const epubBlob = await getEpub(currentEpubKey); // Use the key
      if (epubBlob) {
        book = ePub(epubBlob);
        const toc = await book.loaded.navigation;
        renderToc(toc);
        restoreTocState();
        console.log(`Loaded EPUB with key "${currentEpubKey}" for this tab.`);
      } else {
        sessionStorage.removeItem('currentEpubKey');
        sessionStorage.removeItem('currentChapterHref');
        sessionStorage.removeItem('currentTocScrollTop');
      }
    } catch (error) {
      console.error("Error loading EPUB from IndexedDB or parsing:", error);
      sessionStorage.removeItem('currentEpubKey');
      sessionStorage.removeItem('currentChapterHref');
      sessionStorage.removeItem('currentTocScrollTop');
      alert("Failed to load the last used EPUB for this tab. Please re-select the file.");
    }
  }

  formatText();
  updateCharCount();
});


// Modified file input listener
document.getElementById('epubInput').addEventListener('change', async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Clear previous tab state before loading a new file
  sessionStorage.removeItem('currentEpubKey');
  sessionStorage.removeItem('currentChapterHref');
  sessionStorage.removeItem('currentTocScrollTop');

  if (file.name.toLowerCase().endsWith('.epub')) {
    try {
      // MODIFIED: Generate the key and store the file using the full file object
      const uniqueKey = createUniqueFileKey(file);
      await storeEpub(file);

      // MODIFIED: Store the unique key in this tab's sessionStorage
      sessionStorage.setItem('currentEpubKey', uniqueKey);

      // Load the book and display TOC
      book = ePub(file);
      const toc = await book.loaded.navigation;
      renderToc(toc);

      // Clear the content area
      document.getElementById('chapterContent').value = '';
      originalText = null;
      updateCharCount();
      document.getElementById('chunkedTextContainer').innerHTML = '';

    } catch (error) {
      console.error("Error loading or storing EPUB:", error);
      alert("Failed to load or store EPUB. See console for details.");
      sessionStorage.removeItem('currentEpubKey'); // Clean up on error
    }
  } else if (file.name.toLowerCase().endsWith('.txt')) {
    const reader = new FileReader();
    reader.onload = function(e) {
      originalText = e.target.result;
      document.getElementById('chapterContent').value = originalText;
      formatText();
      updateCharCount();
      // No EPUB state to manage for TXT files
      document.getElementById('chunkedTextContainer').innerHTML = '';
    }
    reader.readAsText(file);
  } else {
    alert("Unsupported file type. Please upload .epub or .txt files.");
    event.target.value = '';
  }
});
