import ePub from 'epubjs';

let book = null;
let currentBookId = null;
let currentChapterName = "";
let lastClickedButton = null;
let originalText = null;
let originalHtml = null;
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
  const bookId = Math.random().toString(36).substring(2, 8);
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
  if (!bookId) {
    document.title = "EPUB Text Chunker";
    updateFormatSelectVisibility(false);
    return;
  }

  if (currentBookId !== bookId || !book) {
    clearChunkedText();
    const record = await getFileRecord(bookId);
    if (!record) {
      console.error("Book not found in storage.");
      document.getElementById('fileNameDisplay').textContent = "File missing or expired";
      document.title = "EPUB Text Chunker";
      updateFormatSelectVisibility(false);
      return;
    }

    currentBookId = bookId;
    document.getElementById('fileNameDisplay').textContent = "Loaded: " + record.fileName;

    // Update the browser tab/title tag
    document.title = record.fileName + " - Split";

    if (record.fileName.endsWith('.epub')) {
      updateFormatSelectVisibility(true);
      book = ePub(record.blob);
      const navigation = await book.loaded.navigation;
      renderToc(navigation.toc, bookId);
    } else {
      updateFormatSelectVisibility(false);
      originalText = await record.blob.text();
      currentChapterName = record.fileName.replace(/\.[^/.]+$/, "");
      const textArea = document.getElementById('chapterContent');
      textArea.value = originalText;
      clearChunkedText();
      resetCopyChapterButton();
      formatText();

      // Reset scroll to top for TXT/MD loads
      textArea.scrollTop = 0;
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

function resetCopyChapterButton() {
  const copyBtn = document.getElementById('copyChapterButton');
  if (copyBtn) {
    copyBtn.classList.remove('green', 'dark-green');
    const tick = copyBtn.querySelector('.tick');
    if (tick) tick.style.display = 'none';
    if (lastClickedButton === copyBtn) lastClickedButton = null;
  }
}

async function loadChapterContent(href) {
  try {
    const chapterDoc = await book.load(href);
    originalText = chapterDoc.body.innerText.trim();
    originalHtml = chapterDoc.body.innerHTML;
    const textArea = document.getElementById('chapterContent');
    textArea.value = originalText;

    resetCopyChapterButton();

    formatText();
    updateCharCount();

    // Reset preview box scroll position to top whenever a new chapter loads
    textArea.scrollTop = 0;
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
    tocContainer.scrollTop = parseInt(savedScroll, 10);
  } else if (selectedElement) {
    selectedElement.scrollIntoView({ block: 'nearest' });
    sessionStorage.setItem('tocScroll_' + currentBookId, tocContainer.scrollTop);
  }
}

function updateCharCount() {
  const text = document.getElementById('chapterContent').value;
  document.getElementById('charCount').textContent = `Total characters: ${text.length}`;
}

// --- HTML Prettify Helpers ---
function removeEmptyLines(nonFormattedString) {
  return nonFormattedString.trim().replace(/(^(\s|\t)+|(( |\t)+)$)/gm, '');
}

function mergeAttributesWithElements(markup) {
  const splittedMarkup = removeEmptyLines(markup).split('\n');
  const mergedLines = [];
  let currentElement = '';
  for (let i = 0; i < splittedMarkup.length; i++) {
    const line = splittedMarkup[i];

    if (line.endsWith('/>')) {
      mergedLines.push(`${currentElement}${line.slice(0, -2)} />`);
      currentElement = '';
      continue;
    }

    if (line.endsWith('>')) {
      mergedLines.push(`${currentElement}${
        line.startsWith('>') || line.startsWith('<') ? '' : ' '
      }${line}`);
      currentElement = '';
      continue;
    }

    currentElement += currentElement.length ? ` ${line}` : line;
  }

  return mergedLines;
}

function addIndentation(splittedHtml, options = {}) {
  const char = options.char || ' ';
  const count = options.count || 2;

  let level = 0;
  const opened = [];

  return splittedHtml.reverse().reduce((indented, elTag) => {
    if (opened.length
      && level
      && opened[level]
      && opened[level] === elTag.substring(1, opened[level].length + 1)
    ) {
      opened.splice(level, 1);
      level--;
    }

    const indentation = char.repeat(level ? level * count : 0);

    const newIndented = [
      `${indentation}${elTag}`,
      ...indented,
    ];

    if (elTag.substring(0, 2) === '</') {
      level++;
      opened[level] = elTag.substring(2, elTag.length - 1);
    }

    return newIndented;
  }, []).join('\n');
}

function prettifyHTML(markup, options = {}) {
  const splitted = mergeAttributesWithElements(markup);
  return addIndentation(splitted, options);
}

function formatText() {
  const formatSelect = document.getElementById('formatSelect');
  const textArea = document.getElementById('chapterContent');
  if (originalText === null && textArea.value) {
    originalText = textArea.value;
    originalHtml = null;
  }

  if (formatSelect.value === 'prettify-html') {
    const htmlSource = originalHtml || (originalText && (originalText.includes('<') && originalText.includes('>')) ? originalText : null);
    if (htmlSource) {
      const preparedHtml = htmlSource.replace(/<\/(p|div|h[1-6]|li)>/gi, '$&\n');
      const prettifiedHtml = prettifyHTML(preparedHtml);
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = prettifiedHtml;
      const text = tempDiv.innerText;
      const paragraphs = text.split('\n');
      textArea.value = paragraphs.map(p => p.trim()).filter(p => p).join('\n\n');
    } else if (originalText) {
      const paragraphs = originalText.split('\n');
      textArea.value = paragraphs.map(p => p.trim()).filter(p => p).join('\n\n');
    }
  } else if (formatSelect.value === 'clean' && originalText) {
    const paragraphs = originalText.split('\n');
    textArea.value = paragraphs.map(p => p.trim()).filter(p => p).join('\n\n');
  } else if (originalText) {
    textArea.value = originalText;
  }
  updateCharCount();
}

// --- Chunking Logic ---

function chunkText(ignoreExtras = false, customMaxChars = null) {
  const text = document.getElementById('chapterContent').value;
  const maxCharsInput = document.getElementById('maxChars');
  const maxChars = (customMaxChars !== null && customMaxChars !== undefined)
    ? customMaxChars
    : (parseInt(maxCharsInput.value) || 4700);
  let chunkTemplate = ignoreExtras ? "" : (document.getElementById('chunkTemplate')?.value || "");

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

    let finalChunk = chunk;
    if (chunkTemplate.trim()) {
      finalChunk = chunkTemplate
        .replaceAll('$PART_NO', partNumber)
        .replaceAll('$TOTAL_PARTS', chunks.length)
        .replaceAll('$CHAP_NAME', cName);

      if (finalChunk.includes('$CONTENT')) {
        finalChunk = finalChunk.replaceAll('$CONTENT', chunk);
      } else {
        finalChunk = `${finalChunk}\n\n${chunk}`;
      }
      finalChunk = finalChunk.trim();
    }

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
        let promptTemplate = document.getElementById('translatePrompt')?.value.trim();
        if (!promptTemplate) {
          promptTemplate = "Translate to English (Part $PART_NO of $TOTAL_PARTS):\n\n$CONTENT";
        }
        let holdTranslatedText = promptTemplate
          .replaceAll('$PART_NO', partNumber)
          .replaceAll('$TOTAL_PARTS', chunks.length)
          .replaceAll('$CHAP_NAME', cName);

        if (holdTranslatedText.includes('$CONTENT')) {
          holdTranslatedText = holdTranslatedText.replaceAll('$CONTENT', chunk);
        } else {
          holdTranslatedText += `\n\n${chunk}`;
        }

        copyToClipboard(holdTranslatedText);
        updateButtonState(copyBtn, true); // true = dark green
        if (navigator.vibrate) navigator.vibrate(50);
      }, 500);
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

function renderQuickSplitButtons() {
  const container = document.getElementById('quickSplitButtons');
  if (!container) return;
  container.innerHTML = '';

  const presetsInput = document.getElementById('quickSplitPresets');
  const rawVal = presetsInput && presetsInput.value.trim() !== '' ? presetsInput.value : '1800, 4700';
  const presets = rawVal
    .split(',')
    .map(s => parseInt(s.trim()))
    .filter(n => !isNaN(n) && n > 0);

  presets.forEach(num => {
    const btn = document.createElement('button');
    btn.className = 'quick-split-btn';
    btn.textContent = num;
    btn.title = `Split text with max ${num} characters`;

    let pressTimer, isLongPress = false;
    btn.addEventListener('pointerdown', function(e) {
      if (e.button !== 0 && e.type !== 'touchstart') return;
      isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true;
        chunkText(true, num);
        if (navigator.vibrate) navigator.vibrate(50);
      }, 600);
    });

    btn.addEventListener('pointerup', () => clearTimeout(pressTimer));
    btn.addEventListener('pointerleave', () => clearTimeout(pressTimer));
    btn.addEventListener('pointercancel', () => clearTimeout(pressTimer));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());

    btn.addEventListener('click', function() {
      if (!isLongPress) {
        chunkText(false, num);
      }
    });

    container.appendChild(btn);
  });
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', async () => {
  await cleanupOldFiles();

  ['maxChars', 'chunkTemplate', 'translatePrompt', 'quickSplitPresets'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const saved = localStorage.getItem(id);
    if (saved !== null) el.value = saved;
    el.addEventListener('input', () => {
      localStorage.setItem(id, el.value);
      if (id === 'quickSplitPresets') renderQuickSplitButtons();
    });
  });

  const presetsEl = document.getElementById('quickSplitPresets');
  if (presetsEl && localStorage.getItem('quickSplitPresets') === null) {
    presetsEl.value = '1800, 4700';
    localStorage.setItem('quickSplitPresets', '1800, 4700');
  }

  renderQuickSplitButtons();

  const templateEl = document.getElementById('chunkTemplate');
  if (templateEl && localStorage.getItem('chunkTemplate') === null) {
    const savedTop = localStorage.getItem('addToTop') || '';
    const savedBottom = localStorage.getItem('addToBottom') || '';
    if (savedTop || savedBottom) {
      const migrated = (savedTop + '\n\n$CONTENT\n\n' + savedBottom).trim();
      templateEl.value = migrated;
      localStorage.setItem('chunkTemplate', migrated);
    }
  }

  const settingsModal = document.getElementById('settingsModal');
  const settingsBtn = document.getElementById('settingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');

  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => settingsModal.showModal());
  }
  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => settingsModal.close());
  }
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.close();
    });
  }

  const formatSelect = document.getElementById('formatSelect');
  const savedFormat = localStorage.getItem('formatSelect');
  formatSelect.value = savedFormat ? savedFormat : 'clean';
  updateFormatSelectVisibility(false);
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
    clearChunkedText();
    resetCopyChapterButton();

    updateHash(bookId, 0);
  } catch (error) {
    console.error("Upload error:", error);
    document.getElementById('fileNameDisplay').textContent = "Failed to load file.";
  }
  event.target.value = '';
});

function clearChunkedText() {
  const container = document.getElementById('chunkedTextContainer');
  if (container) container.innerHTML = '';
}

function updateFormatSelectVisibility(isEpub) {
  const formatSelect = document.getElementById('formatSelect');
  if (!formatSelect) return;
  const prettifyOption = formatSelect.querySelector('option[value="prettify-html"]');
  if (!prettifyOption) return;

  if (isEpub) {
    prettifyOption.hidden = false;
    prettifyOption.disabled = false;
    prettifyOption.style.display = '';
  } else {
    prettifyOption.hidden = true;
    prettifyOption.disabled = true;
    prettifyOption.style.display = 'none';
    if (formatSelect.value === 'prettify-html') {
      formatSelect.value = 'clean';
      localStorage.setItem('formatSelect', 'clean');
      formatText();
    }
  }
}
