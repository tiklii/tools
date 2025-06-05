let book;
let lastClickedButton = null;
let originalText = null; // Store the original unformatted text
const dbName = "epubChunkerDB";
const dbVersion = 2; // Increment database version for schema changes
const epubStoreName = "epubs";

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

// IndexedDB Functions (No changes here)
async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = function(event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(epubStoreName)) {
        db.createObjectStore(epubStoreName, {
          keyPath: "fileName"
        });
      }
    };

    request.onsuccess = function(event) {
      resolve(event.target.result);
    };

    request.onerror = function(event) {
      reject("Error opening database: " + event.target.errorCode);
    };
  });
}

async function storeEpub(fileName, epubBlob) {
  const db = await openDatabase();
  const transaction = db.transaction([epubStoreName], "readwrite");
  const store = transaction.objectStore(epubStoreName);

  const data = {
    fileName: fileName,
    blob: epubBlob,
    timestamp: new Date()
  };

  const request = store.put(data);

  return new Promise((resolve, reject) => {
    request.onsuccess = function() {
      console.log(`EPUB "${fileName}" stored in IndexedDB.`);
      resolve();
    };

    request.onerror = function() {
      console.error("Error storing EPUB:", request.error);
      reject("Error storing EPUB: " + request.error);
    };
  });
}

async function getEpub(fileName) {
  const db = await openDatabase();
  const transaction = db.transaction([epubStoreName], "readonly");
  const store = transaction.objectStore(epubStoreName);

  const request = store.get(fileName);

  return new Promise((resolve, reject) => {
    request.onsuccess = function() {
      if (request.result) {
        console.log(`EPUB "${fileName}" retrieved from IndexedDB.`);
        resolve(request.result.blob);
      } else {
        console.log(`EPUB "${fileName}" not found in IndexedDB.`);
        resolve(null); // Not found
      }
    };

    request.onerror = function() {
      console.error("Error retrieving EPUB:", request.error);
      reject("Error retrieving EPUB: " + request.error);
    };
  });
}

// TOC Rendering and State Functions
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
  // MODIFIED: Use sessionStorage for tab-specific state
  const currentChapterHref = sessionStorage.getItem('currentChapterHref');
  const tocScrollTop = sessionStorage.getItem('currentTocScrollTop');
  const tocContainer = document.getElementById('tocContainer');

  if (currentChapterHref) { // MODIFIED
    const tocListItems = document.querySelectorAll('#tocList li');
    let selectedElement = null;
    tocListItems.forEach(item => {
      item.classList.remove('selected');
      if (item.dataset.href === currentChapterHref) { // MODIFIED
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

// Load Chapter Function with State Saving
async function loadChapterAndSaveState(event) {
  const tocListItems = document.querySelectorAll('#tocList li');
  tocListItems.forEach(item => item.classList.remove('selected'));
  event.target.classList.add('selected');

  const selectedHref = event.target.dataset.href;
  const tocContainer = document.getElementById('tocContainer');

  // MODIFIED: Save the state to sessionStorage for this tab only
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

// Modified chunkText function based on the non-IndexedDB script (No changes here)
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

// Initial load logic
document.addEventListener('DOMContentLoaded', async () => {
  const maxCharsInput = document.getElementById('maxChars');
  const addToTopInput = document.getElementById('addToTop');
  const addToBottomInput = document.getElementById('addToBottom');
  const formatSelect = document.getElementById('formatSelect');
  const chapterContentTextArea = document.getElementById('chapterContent');

  // These settings are global, so they remain in localStorage
  maxCharsInput.value = localStorage.getItem('maxChars') || '1800';
  const addToTopDefault = 'Translate to English (part $X of $Y):';
  addToTopInput.value = localStorage.getItem('addToTop') || addToTopDefault;
  const addToBottomDefault = '';
  addToBottomInput.value = localStorage.getItem('addToBottom') || addToBottomDefault;
  const savedFormat = localStorage.getItem('formatSelect');
  if (savedFormat) {
    formatSelect.value = savedFormat;
  } else {
    formatSelect.value = 'pretty';
  }

  maxCharsInput.addEventListener('input', () => {
    localStorage.setItem('maxChars', maxCharsInput.value);
  });
  addToTopInput.addEventListener('input', () => {
    localStorage.setItem('addToTop', addToTopInput.value);
  });
  addToBottomInput.addEventListener('input', () => {
    localStorage.setItem('addToBottom', addToBottomInput.value);
  });
  formatSelect.addEventListener('change', () => {
    localStorage.setItem('formatSelect', formatSelect.value);
    formatText();
  });

  chapterContentTextArea.addEventListener('input', updateCharCount);

  // MODIFIED: Attempt to load EPUB for THIS TAB from sessionStorage
  const currentEpubFile = sessionStorage.getItem('currentEpubFile');
  if (currentEpubFile) {
    try {
      const epubBlob = await getEpub(currentEpubFile);
      if (epubBlob) {
        book = ePub(epubBlob);
        const toc = await book.loaded.navigation;
        renderToc(toc);
        restoreTocState(); // Restore selected chapter and scroll position for this tab
        console.log(`Loaded EPUB "${currentEpubFile}" from IndexedDB for this tab and restored state.`);
      } else {
        // EPUB not in DB, clear sessionStorage state for it
        sessionStorage.removeItem('currentEpubFile');
        sessionStorage.removeItem('currentChapterHref');
        sessionStorage.removeItem('currentTocScrollTop');
      }
    } catch (error) {
      console.error("Error loading EPUB from IndexedDB or parsing:", error);
      // Clear state if loading/parsing fails
      sessionStorage.removeItem('currentEpubFile');
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

  const fileName = file.name.toLowerCase();

  // Clear tab-specific state before loading a new file
  sessionStorage.removeItem('currentEpubFile');
  sessionStorage.removeItem('currentChapterHref');
  sessionStorage.removeItem('currentTocScrollTop');

  if (fileName.endsWith('.epub')) {
    try {
      // Store the epub file in the shared IndexedDB
      await storeEpub(fileName, file);

      // MODIFIED: Store the filename in this tab's sessionStorage
      sessionStorage.setItem('currentEpubFile', fileName);

      // Load the book and display TOC
      book = ePub(file);
      const toc = await book.loaded.navigation;
      renderToc(toc);

      // Clear the content area for the new book
      document.getElementById('chapterContent').value = '';
      originalText = null;
      updateCharCount();
      document.getElementById('chunkedTextContainer').innerHTML = '';


    } catch (error) {
      console.error("Error loading or storing EPUB:", error);
      alert("Failed to load or store EPUB. See console for details.");
      // Clear state on error
      sessionStorage.removeItem('currentEpubFile');
    }
  } else if (fileName.endsWith('.txt')) {
    const reader = new FileReader();
    reader.onload = function(e) {
      originalText = e.target.result;
      document.getElementById('chapterContent').value = originalText;
      formatText();
      updateCharCount();
      // For TXT, there's no EPUB state to manage, so we clear it.
      sessionStorage.removeItem('currentEpubFile');
      sessionStorage.removeItem('currentChapterHref');
      sessionStorage.removeItem('currentTocScrollTop');
      document.getElementById('chunkedTextContainer').innerHTML = ''; // Clear previous chunks
    }
    reader.readAsText(file);
  } else {
    alert("Unsupported file type. Please upload .epub or .txt files.");
    event.target.value = ''; // Clear the file input
  }
});
