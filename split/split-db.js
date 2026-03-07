let book = null;
let currentBookId = null; // Track current loaded book to prevent re-parsing
let lastClickedButton = null;
let originalText = null;
const dbName = "epubChunkerDB";
const dbVersion = 4;
const epubStoreName = "epubs";

// --- Database Logic ---

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = function(event) {
      const db = event.target.result;
      if (db.objectStoreNames.contains(epubStoreName)) {
        db.deleteObjectStore(epubStoreName);
      }
      const store = db.createObjectStore(epubStoreName, { keyPath: "bookId" });
      store.createIndex("lastAccessed", "lastAccessed", { unique: false });
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject("DB Error: " + event.target.errorCode);
  });
}

async function storeFileInDB(file) {
  const db = await openDatabase();
  const bookId = Math.floor(1000 + Math.random() * 9000).toString();
  const data = {
    bookId: bookId,
    fileName: file.name,
    blob: file,
    lastAccessed: Date.now()
  };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([epubStoreName], "readwrite");
    const store = transaction.objectStore(epubStoreName);
    store.put(data);
    transaction.oncomplete = () => resolve(bookId);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getFileRecord(bookId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([epubStoreName], "readwrite");
    const store = transaction.objectStore(epubStoreName);
    const request = store.get(bookId);
    request.onsuccess = () => {
      if (request.result) {
        request.result.lastAccessed = Date.now(); // Update activity
        store.put(request.result);
      }
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function cleanupOldFiles() {
  const db = await openDatabase();
  const fifteenDaysInMs = 15 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - fifteenDaysInMs;

  const transaction = db.transaction([epubStoreName], "readwrite");
  const store = transaction.objectStore(epubStoreName);
  const index = store.index("lastAccessed");
  const request = index.openCursor(IDBKeyRange.upperBound(cutoff));

  request.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      console.log("Deleting expired EPUB:", cursor.value.bookId);
      store.delete(cursor.primaryKey);
      cursor.continue();
    }
  };
}

// --- Navigation & State ---

function getHashState() {
  const hash = window.location.hash.replace('#/', '');
  const parts = hash.split('/');
  return { bookId: parts[0] || null, spineIndex: parseInt(parts[1], 10) || 0 };
}

function updateHash(bookId, spineIndex) {
  window.location.hash = `#/${bookId}/${spineIndex}`;
}

// --- UI Logic ---

async function loadFromHash() {
  const { bookId, spineIndex } = getHashState();
  if (!bookId) return;

  // Only read from DB and parse EPUB if we switched books or it's a fresh page load
  if (currentBookId !== bookId || !book) {
    const record = await getFileRecord(bookId);
    if (!record) {
      console.error("Book not found in storage.");
      return;
    }

    currentBookId = bookId;

    if (record.fileName.endsWith('.epub')) {
      book = ePub(record.blob);
      const navigation = await book.loaded.navigation;
      renderToc(navigation.toc, bookId);
    } else {
      originalText = await record.blob.text();
      document.getElementById('chapterContent').value = originalText;
      formatText();
      return; // Stop here for txt files
    }
  }

  // If book is loaded, extract text based on the spine index in the URL
  if (book) {
    const section = book.spine.get(spineIndex);
    if (section) {
      await loadChapterContent(section.href);
      highlightAndScrollToc(section.href);
    }
  }
}

async function loadChapterContent(href) {
  try {
    const chapterDoc = await book.load(href);
    originalText = chapterDoc.body.innerText.trim();
    document.getElementById('chapterContent').value = originalText;

    // Reset copy button when a new chapter loads
    const copyBtn = document.getElementById('copyChapterButton');
    copyBtn.classList.remove('green');
    copyBtn.querySelector('.tick').style.display = 'none';
    if (lastClickedButton === copyBtn) lastClickedButton = null;

    formatText();
    updateCharCount();
  } catch (error) {
    console.error("Error loading chapter:", error);
  }
}

function renderToc(toc, bookId) {
  const tocList = document.getElementById('tocList');
  tocList.innerHTML = '';

  function addTocItems(items, parentElement) {
    items.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item.label.trim();
      li.dataset.href = item.href;

      li.addEventListener('click', (e) => {
        e.stopPropagation();
        let spineIndex = 0;
        // Ask epub.js for the exact spine index of this href
        if (book && book.spine) {
          const section = book.spine.get(item.href);
          if (section) spineIndex = section.index;
        }
        updateHash(bookId, spineIndex);
      });

      parentElement.appendChild(li);
      if (item.subitems?.length > 0) {
        const ul = document.createElement('ul');
        addTocItems(item.subitems, ul);
        li.appendChild(ul);
      }
    });
  }
  addTocItems(toc, tocList);
}

function highlightAndScrollToc(href) {
  let selectedElement = null;
  const items = document.querySelectorAll('#tocList li');

  items.forEach(li => {
    li.classList.remove('selected');
    if (li.dataset.href === href) {
      li.classList.add('selected');
      selectedElement = li;
    }
  });

  if (selectedElement) {
    // Slight delay ensures the DOM is painted before scrolling
    setTimeout(() => {
      selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 50);
  }
}

function updateCharCount() {
  const text = document.getElementById('chapterContent').value;
  document.getElementById('charCount').textContent = `Total characters: ${text.length}`;
}

function formatText() {
  const formatSelect = document.getElementById('formatSelect');
  const textArea = document.getElementById('chapterContent');
  if (originalText === null && textArea.value) originalText = textArea.value;

  if (formatSelect.value === 'pretty' && originalText) {
    const paragraphs = originalText.split('\n');
    textArea.value = paragraphs.map(p => p.trim()).filter(p => p).join('\n\n');
  } else if (originalText) {
    textArea.value = originalText;
  }
  updateCharCount();
}

// --- Chunking Logic ---

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
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());

  const container = document.getElementById('chunkedTextContainer');
  container.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const digits = String(chunks.length).length;

  chunks.forEach((chunk, index) => {
    const partNumber = String(index + 1).padStart(digits, '0');
    let finalChunk = (addToTop.replace('$X', partNumber).replace('$Y', chunks.length) + '\n\n' + chunk + '\n\n' + addToBottom.replace('$X', partNumber).replace('$Y', chunks.length)).trim();

    const div = document.createElement('div');
    div.className = 'chunk-container';
    div.innerHTML = `<div class="chunk-title">Part ${partNumber}</div><textarea readonly>${finalChunk}</textarea><button class="copy-button">Copy to Clipboard<span class="tick">✔️</span></button>`;

    div.querySelector('button').addEventListener('click', function() {
      copyToClipboard(finalChunk);
      updateButtonState(this);
    });
    fragment.appendChild(div);
  });
  container.appendChild(fragment);
}

function copyToClipboard(text) {
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
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

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', async () => {
  await cleanupOldFiles();

  // Persistent settings setup
  ['maxChars', 'addToTop', 'addToBottom'].forEach(id => {
    const el = document.getElementById(id);
    const saved = localStorage.getItem(id);
    if (saved) el.value = saved;
    el.addEventListener('input', () => localStorage.setItem(id, el.value));
  });

  // Specifically handle the select format default
  const formatSelect = document.getElementById('formatSelect');
  const savedFormat = localStorage.getItem('formatSelect');
  formatSelect.value = savedFormat ? savedFormat : 'pretty'; // Explicit default
  formatSelect.addEventListener('change', () => {
    localStorage.setItem('formatSelect', formatSelect.value);
    formatText();
  });

  document.getElementById('chapterContent').addEventListener('input', updateCharCount);
  document.getElementById('copyChapterButton').addEventListener('click', function() {
    copyToClipboard(document.getElementById('chapterContent').value);
    updateButtonState(this);
  });

  // Long press split logic
  const splitBtn = document.getElementById('splitButton');
  let pressTimer, isLongPress = false;
  splitBtn.addEventListener('pointerdown', () => {
    isLongPress = false;
    pressTimer = setTimeout(() => { isLongPress = true; chunkText(true); }, 600);
  });
  splitBtn.addEventListener('pointerup', () => clearTimeout(pressTimer));
  splitBtn.addEventListener('click', () => { if (!isLongPress) chunkText(false); });

  // Load state from Hash
  loadFromHash();
  window.addEventListener('hashchange', loadFromHash);
});

document.getElementById('epubInput').addEventListener('change', async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const bookId = await storeFileInDB(file);
    document.getElementById('tocList').innerHTML = ''; // Clear old TOC
    document.getElementById('chapterContent').value = '';

    // Jump to the newly uploaded book (Spine 0)
    updateHash(bookId, 0);
  } catch (error) {
    console.error("Upload error:", error);
    alert("Failed to store file.");
  }
  // Clear file input so the same file can be selected again if needed
  event.target.value = '';
});
