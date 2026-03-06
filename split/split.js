let book;
let lastClickedButton = null;
let originalText = null; // Store the original unformatted text


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

document.addEventListener('DOMContentLoaded', () => {
  const maxCharsInput = document.getElementById('maxChars');
  const addToTopInput = document.getElementById('addToTop');
  const addToBottomInput = document.getElementById('addToBottom');
  const formatSelect = document.getElementById('formatSelect');
  const chapterContentTextArea = document.getElementById('chapterContent');

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

  // Initial format and char count on load
  formatText();
  updateCharCount();
});

document.getElementById('epubInput').addEventListener('change', async function (event) {
  const file = event.target.files[0];
  const fileName = file.name.toLowerCase();
  try {
    if (fileName.endsWith('.epub')) {
      book = ePub(file);
      const toc = await book.loaded.navigation;
      const tocList = document.getElementById('tocList');
      tocList.innerHTML = '';

      function addTocItems(items, parentElement) {
        items.forEach(item => {
          const li = document.createElement('li');
          li.textContent = item.label.trim();
          li.dataset.href = item.href;
          li.addEventListener('click', loadChapter);
          parentElement.appendChild(li);

          if (item.subitems && item.subitems.length > 0) {
            const ul = document.createElement('ul');
            addTocItems(item.subitems, ul);
            li.appendChild(ul);
          }
        });
      }

      addTocItems(toc, tocList);
    } else if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = function (e) {
        originalText = e.target.result;
        document.getElementById('chapterContent').value = originalText;
        formatText();
        updateCharCount();
      }
      reader.readAsText(file);
    } else {
      alert("Unsupported file type. Please upload .epub, .txt, or .md files.");
    }
  } catch (error) {
    console.error("Error loading file:", error);
    alert("Failed to load file. See console for details.");
  }
});

async function loadChapter(event) {
  // RESET COPY BUTTON STATE
  const copyBtn = document.getElementById('copyChapterButton');
  copyBtn.classList.remove('green');
  copyBtn.querySelector('.tick').style.display = 'none';
  if (lastClickedButton === copyBtn) lastClickedButton = null;

  const tocListItems = document.querySelectorAll('#tocList li');
  tocListItems.forEach(item => item.classList.remove('selected'));
  event.target.classList.add('selected');

  const selectedHref = event.target.dataset.href;
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
    if ((currentChunk.length + paragraph.length + 2) <= maxChars) { // +2 for newline
      currentChunk += paragraph + '\n';
    } else {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph + '\n';
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
    copyButton.addEventListener('click', function () {
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

  if (originalText === null && textArea.value) { // If originalText is null but textarea has content (e.g. pasted)
    originalText = textArea.value;
  }

  if (formatSelect.value === 'pretty' && originalText) {
    const paragraphs = originalText.split('\n');
    const formattedText = paragraphs.map(p => p.trim()).filter(p => p).join('\n\n');
    textArea.value = formattedText;
  } else if (originalText) { // "as-is" or originalText is not yet set but we have it
    textArea.value = originalText;
  }
  // If originalText is null and textarea is empty, do nothing.
  updateCharCount(); // Update char count after formatting
}
