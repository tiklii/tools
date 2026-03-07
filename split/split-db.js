let book = null;
let currentBookId = null;
let currentChapterName = "";
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
        request.result.lastAccessed = Date.now();
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

  if (currentBookId !== bookId || !book) {
    const record = await getFileRecord(bookId);
    if (!record) {
      console.error("Book not found in storage.");
      document.getElementById('fileNameDisplay').textContent = "File missing or expired";
      return;
    }

    currentBookId = bookId;
    document.getElementById('fileNameDisplay').textContent = "Loaded: " + record.fileName;

    if (record.fileName.endsWith('.epub')) {
      book = ePub(record.blob);
      const navigation = await book.loaded.navigation;
      renderToc(navigation.toc, bookId);
    } else {
      originalText = await record.blob.text();
      currentChapterName = record.fileName.replace(/\.[^/.]+$/, "");
      document.getElementById('chapterContent').value = originalText;
      formatText();
      return;
    }
  }

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

    const copyBtn = document.getElementById('copyChapterButton');
    copyBtn.classList.remove('green', 'dark-green');
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

      const labelDiv = document.createElement('div');
      labelDiv.className = 'toc-label';
      labelDiv.textContent = item.label.trim();
      labelDiv.dataset.href = item.href;
      labelDiv.dataset.label = item.label.trim();

      labelDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Save the EXACT scroll Y-coordinate at the moment of selection
        const tocContainer = document.getElementById('tocContainer');
        sessionStorage.setItem('tocScroll_' + bookId, tocContainer.scrollTop);

        let spineIndex = 0;
        if (book && book.spine) {
          const section = book.spine.get(item.href);
          if (section) spineIndex = section.index;
        }
        updateHash(bookId, spineIndex);
      });

      li.appendChild(labelDiv);
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
  const items = Array.from(document.querySelectorAll('.toc-label'));
  let selectedElement = items.find(el => el.dataset.href === href);

  if (!selectedElement) {
    const baseHref = href.split('#')[0];
    selectedElement = items.find(el => el.dataset.href.split('#')[0] === baseHref);
  }

  items.forEach(el => el.classList.remove('selected'));

  if (selectedElement) {
    selectedElement.classList.add('selected');
    currentChapterName = selectedElement.dataset.label || "";
  } else {
    currentChapterName = "";
  }

  const tocContainer = document.getElementById('tocContainer');
  const savedScroll = sessionStorage.getItem('tocScroll_' + currentBookId);

  if (savedScroll !== null) {
    // Restore the position recorded exactly when the element was clicked
    tocContainer.scrollTop = parseInt(savedScroll, 10);
  } else if (selectedElement) {
    // Only runs on the very first fresh load when nothing was clicked yet
    selectedElement.scrollIntoView({ block: 'nearest' });
    sessionStorage.setItem('tocScroll_' + currentBookId, tocContainer.scrollTop);
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
  const cName = currentChapterName || "";

  chunks.forEach((chunk, index) => {
    const partNumber = String(index + 1).padStart(digits, '0');

    let topText = addToTop.replaceAll('$X', partNumber).replaceAll('$Y', chunks.length).replaceAll('$Z', cName);
    let bottomText = addToBottom.replaceAll('$X', partNumber).replaceAll('$Y', chunks.length).replaceAll('$Z', cName);
    let finalChunk = (topText + '\n\n' + chunk + '\n\n' + bottomText).trim();

    const div = document.createElement('div');
    div.className = 'chunk-container';
    div.innerHTML = `<div class="chunk-title">Part ${partNumber}</div><textarea readonly>${finalChunk}</textarea><button class="copy-button">Copy to Clipboard<span class="tick">✔️</span></button>`;

    const copyBtn = div.querySelector('button');
    let chunkPressTimer;
    let isChunkLongPress = false;

    // Mobile/Pointer hold logic for individual chunk buttons
    copyBtn.addEventListener('pointerdown', function(e) {
      if(e.button !== 0 && e.type !== 'touchstart') return; 
      isChunkLongPress = false;

      chunkPressTimer = setTimeout(() => {
        isChunkLongPress = true;
        let holdTranslatedText = `Translate to English (Part ${partNumber} of ${chunks.length}):\n\n${finalChunk}`;
        //let holdTranslatedText = `Translate to English:\n${cName} (Part ${partNumber} of ${chunks.length})\n\n${finalChunk}`;
        copyToClipboard(holdTranslatedText);
        updateButtonState(copyBtn, true); // true = dark green
        if (navigator.vibrate) navigator.vibrate(50); // Optional subtle vibration on Android
      }, 500); // 500ms hold
    });

    copyBtn.addEventListener('pointerup', () => clearTimeout(chunkPressTimer));
    copyBtn.addEventListener('pointerleave', () => clearTimeout(chunkPressTimer));
    copyBtn.addEventListener('pointercancel', () => clearTimeout(chunkPressTimer));
    copyBtn.addEventListener('contextmenu', (e) => e.preventDefault()); 

    copyBtn.addEventListener('click', function() {
      if (!isChunkLongPress) {
        copyToClipboard(finalChunk);
        updateButtonState(this, false); 
      }
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

function updateButtonState(button, isDark = false) {
  if (lastClickedButton && lastClickedButton !== button) {
    lastClickedButton.classList.remove('green', 'dark-green');
    lastClickedButton.querySelector('.tick').style.display = 'none';
  }
  // Clear any existing state on current button
  button.classList.remove('green', 'dark-green');

  // Apply new state
  button.classList.add(isDark ? 'dark-green' : 'green');
  button.querySelector('.tick').style.display = 'inline-block';
  lastClickedButton = button;
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', async () => {
  await cleanupOldFiles();

  ['maxChars', 'addToTop', 'addToBottom'].forEach(id => {
    const el = document.getElementById(id);
    const saved = localStorage.getItem(id);
    if (saved) el.value = saved;
    el.addEventListener('input', () => localStorage.setItem(id, el.value));
  });

  const formatSelect = document.getElementById('formatSelect');
  const savedFormat = localStorage.getItem('formatSelect');
  formatSelect.value = savedFormat ? savedFormat : 'pretty';
  formatSelect.addEventListener('change', () => {
    localStorage.setItem('formatSelect', formatSelect.value);
    formatText();
  });

  document.getElementById('chapterContent').addEventListener('input', updateCharCount);

  // Global Copy Chapter Button
  document.getElementById('copyChapterButton').addEventListener('click', function() {
    copyToClipboard(document.getElementById('chapterContent').value);
    updateButtonState(this, false);
  });

  const splitBtn = document.getElementById('splitButton');
  let pressTimer, isLongPress = false;
  splitBtn.addEventListener('pointerdown', () => {
    isLongPress = false;
    pressTimer = setTimeout(() => { isLongPress = true; chunkText(true); }, 600);
  });
  splitBtn.addEventListener('pointerup', () => clearTimeout(pressTimer));
  splitBtn.addEventListener('click', () => { if (!isLongPress) chunkText(false); });

  // Note: The global TOC scroll listener has been completely removed to fix your issue

  loadFromHash();
  window.addEventListener('hashchange', loadFromHash);
});

document.getElementById('epubInput').addEventListener('change', async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    document.getElementById('fileNameDisplay').textContent = "Loading...";
    const bookId = await storeFileInDB(file);

    document.getElementById('tocList').innerHTML = '';
    document.getElementById('chapterContent').value = '';

    updateHash(bookId, 0);
  } catch (error) {
    console.error("Upload error:", error);
    document.getElementById('fileNameDisplay').textContent = "Failed to load file.";
  }
  event.target.value = '';
});
