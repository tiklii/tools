// ==UserScript==
// @name         Web Novel Scraper and EPUB Generator
// @namespace    http://tampermonkey.net/
// @version      0.7
// @description  Scrape web novels and convert them to EPUB
// @author       T3 Chat (Gemini 2.0 Flash)
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_deleteValue
// @grant        GM_download
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js
// ==/UserScript==

(function () {
  "use strict";

  // --- Utility Functions ---
  function getSetting(key, defaultValue) {
    const storedValue = GM_getValue(key);
    return storedValue === undefined ? defaultValue : storedValue;
  }

  function setSetting(key, value) {
    GM_setValue(key, value);
  }

  function deleteSetting(key) {
    GM_deleteValue(key);
  }

  function createTextInput(labelText, initialValue, onChange, width = "300px") {
    const container = document.createElement("div");
    container.style.marginBottom = "10px";

    const label = document.createElement("label");
    label.textContent = labelText + ": ";
    container.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.value = initialValue;
    input.style.width = width; // Set the width
    input.addEventListener("change", (event) => onChange(event.target.value));
    container.appendChild(input);

    return container;
  }

  function createButton(text, onClick, style = {}) {
    const button = document.createElement("button");
    button.textContent = text;
    Object.assign(button.style, style); // Apply custom styles
    button.addEventListener("click", onClick);
    return button;
  }

  function createCheckbox(labelText, initialValue, onChange) {
    const container = document.createElement("div");
    container.style.marginBottom = "10px";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = initialValue;
    checkbox.addEventListener("change", (event) =>
      onChange(event.target.checked),
    );
    container.appendChild(checkbox);

    const label = document.createElement("label");
    label.innerHTML = " " + labelText; // Added space before label text
    container.appendChild(label);

    return container;
  }

  function createTextArea(initialValue) {
    const textarea = document.createElement("textarea");
    textarea.value = initialValue;
    textarea.style.width = "90%";
    textarea.style.height = "100px";
    return textarea;
  }

  // --- Helper function for logging messages ---
  function logMessage(message, logs, logDiv) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] ${message}`;
    console.log(formattedMessage);
    logs.push(formattedMessage);
    logDiv.textContent += formattedMessage + "\n"; // Append log message to the UI
    logDiv.scrollTop = logDiv.scrollHeight; // Scroll to the bottom of the log
  }

  // --- Clear Cache function ---
  function clearCache() {
    GM_deleteValue("chapterCache");
  }

  // --- UI Components ---
  function createSettingsPanel() {
    const panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.top = "20px";
    panel.style.left = "20px";
    panel.style.backgroundColor = "white";
    panel.style.border = "1px solid black";
    panel.style.padding = "10px";
    panel.style.zIndex = "1000";

    // Determine domain based on first URL in the list
    let firstURL = getSetting("urlList", "").split(/[\s,]+/)[0];
    let domain = "";
    try {
      domain = new URL(firstURL).hostname;
    } catch (e) {
      console.warn("Invalid URL:", firstURL);
      domain = "default"; // Use "default" if URL is invalid
    }

    const headingSelectorKey = `headingSelector_${domain}`;
    const contentSelectorKey = `contentSelector_${domain}`;

    // Settings
    const headingSelectorInput = createTextInput(
      "Heading CSS Selector",
      getSetting(headingSelectorKey, "h1"),
      (value) => setSetting(headingSelectorKey, value),
    );
    panel.appendChild(headingSelectorInput);

    const contentSelectorInput = createTextInput(
      "Content CSS Selector",
      getSetting(contentSelectorKey, ".chapter-content"),
      (value) => setSetting(contentSelectorKey, value),
    );
    panel.appendChild(contentSelectorInput);

    const exampleUrlInput = createTextInput(
      "Example URL",
      getSetting("exampleUrl", ""),
      (value) => setSetting("exampleUrl", value),
      "400px",
    ); // Increased width
    panel.appendChild(exampleUrlInput);

    let concurrencyValue = getSetting("concurrency", "3");

    const concurrencyContainer = document.createElement("div");
    concurrencyContainer.style.display = "flex";
    concurrencyContainer.style.alignItems = "center";

    const concurrencyInput = createTextInput(
      "Concurrency",
      concurrencyValue,
      (value) => {
        concurrencyValue = value; // Store temporary value
        if (value !== getSetting("concurrency", "3")) {
          commitButton.disabled = false;
          commitButton.style.backgroundColor = ""; // Re-enable the button
          commitButton.style.color = "";
        } else {
          commitButton.disabled = true;
          commitButton.style.backgroundColor = "grey"; // Disable the button
          commitButton.style.color = "lightgrey";
        }
      },
      "80px",
    );
    concurrencyContainer.appendChild(concurrencyInput);

    const commitButton = createButton(
      "Commit",
      () => {
        const parsedValue = parseInt(concurrencyValue);
        if (!isNaN(parsedValue) && parsedValue > 0) {
          setSetting("concurrency", parsedValue.toString());
          alert(`Concurrency set to ${parsedValue}`);
          commitButton.disabled = true; // Disable the button after committing
          commitButton.style.backgroundColor = "grey"; // Disable the button
          commitButton.style.color = "lightgrey";
        } else {
          alert("Invalid concurrency value. Please enter a valid number.");
        }
      },
      {
        width: "80px",
        fontSize: "14px",
        marginLeft: "5px",
        backgroundColor: concurrencyValue === getSetting("concurrency", "3") ? "grey" : "", // Initially disabled
        color: concurrencyValue === getSetting("concurrency", "3") ? "lightgrey" : "",
      },
    );
    commitButton.disabled = concurrencyValue === getSetting("concurrency", "3");
    concurrencyContainer.appendChild(commitButton);

    panel.appendChild(concurrencyContainer);

    const urlListInput = createTextArea(getSetting("urlList", ""));
    panel.appendChild(document.createTextNode("List of URLs:"));
    panel.appendChild(urlListInput);

    panel.appendChild(document.createElement("br")); // Add newline

    // Checkbox for using previous cache
    const usePreviousCacheCheckbox = createCheckbox(
      "Use previous cache",
      getSetting("usePreviousCache", true),
      (value) => setSetting("usePreviousCache", value),
    );
    panel.appendChild(usePreviousCacheCheckbox);

    let previewDiv = document.createElement("div");
    previewDiv.style.border = "1px solid #ccc";
    previewDiv.style.padding = "10px";
    previewDiv.style.marginTop = "10px";
    previewDiv.style.width = "60%";
    previewDiv.style.height = "30vh"; // Halved the height
    previewDiv.style.overflow = "auto";
    previewDiv.style.resize = "both"; // Enable resizing

    const copyButton = createButton(
      "Copy",
      () => {
        navigator.clipboard
          .writeText(previewDiv.innerHTML)
          .then(() => {
            alert("Content copied to clipboard!");
          })
          .catch((err) => {
            console.error("Failed to copy: ", err);
            alert("Failed to copy content to clipboard.");
          });
      },
      {
        fontSize: "12px",
        padding: "2px 5px",
        position: "relative",
        top: "-30px",
        left: "calc(60% - 50px)",
        zIndex: "1001", // Ensure it's above the preview div
        marginBottom: "3px", // Add 3px space between button and preview box
      },
    );

    panel.appendChild(copyButton);
    panel.appendChild(previewDiv);

    // Test Button
    const testButton = createButton("Test Selector", async () => {
      const headingSelector = getSetting(headingSelectorKey, "h1");
      const contentSelector = getSetting(contentSelectorKey, ".chapter-content");
      const exampleUrl = getSetting("exampleUrl", "");

      if (exampleUrl) {
        try {
          const scrapedContent = await scrapeContent(
            exampleUrl,
            headingSelector,
            contentSelector,
          );
          previewDiv.innerHTML = `<h2>${scrapedContent.title}</h2>${scrapedContent.content}`;
        } catch (error) {
          previewDiv.textContent = `Error: ${error.message}`;
        }
      } else {
        previewDiv.textContent = "Please provide an example URL.";
      }
    });

    panel.appendChild(testButton);

    // Clear Cache Button
    const clearCacheButton = createButton(
      "Clear Cache",
      () => {
        if (confirm("Are you sure you want to clear the cache?")) {
          clearCache();
          alert("Cache cleared!");
        }
      },
      { backgroundColor: "red", color: "white" },
    );
    panel.appendChild(clearCacheButton);

    // Log Area
    const logDiv = document.createElement("div");
    logDiv.style.border = "1px solid #ccc";
    logDiv.style.padding = "10px";
    logDiv.style.marginTop = "10px";
    logDiv.style.height = "100px";
    logDiv.style.overflow = "auto";
    panel.appendChild(logDiv);

    // Download Button
    const downloadButton = createButton("Download EPUB", async () => {
      const headingSelector = getSetting(headingSelectorKey, "h1");
      const contentSelector = getSetting(contentSelectorKey, ".chapter-content");
      const urlList = urlListInput.value.trim();
      const concurrency = parseInt(getSetting("concurrency", "3"));
      const usePreviousCache = getSetting("usePreviousCache", true);

      if (isNaN(concurrency) || concurrency <= 0) {
        alert("Invalid concurrency value. Using default value of 3.");
        setSetting("concurrency", "3");
      }

      if (urlList) {
        const urls = urlList.split(/[\s,]+/); // Split by spaces, commas, or newlines

        // Ensure there's a valid URL to determine the domain
        if (urls.length > 0) {
          try {
            domain = new URL(urls[0]).hostname;
          } catch (e) {
            console.warn("Invalid URL:", urls[0]);
            domain = "default";
          }
        }

        const logs = [];
        try {
          const scrapedCache = {}; // Initialize cache

          // Load existing cache from GM_setValue
          if (usePreviousCache) {
            const cachedData = GM_getValue("chapterCache", {});
            Object.assign(scrapedCache, cachedData); // Load cached data
          }

          let completed = 0; // Number of completed scraping tasks

          const processURL = async (url) => {
            try {
              if (usePreviousCache && scrapedCache[url]) {
                logMessage(`[Cache] Using cached content for ${url}`, logs, logDiv);
                return scrapedCache[url]; // Use cached content
              }

              logMessage(`[Scraping] Scraping ${url}`, logs, logDiv);
              const scrapedContent = await scrapeContent(
                url,
                headingSelector,
                contentSelector,
              );
              scrapedCache[url] = scrapedContent; // Store in cache

              // Save updated cache to GM_setValue
              GM_setValue("chapterCache", scrapedCache);
              logMessage(`[Scraped] Successfully scraped ${url}`, logs, logDiv);
              return scrapedContent;
            } catch (error) {
              logMessage(`[Error] Error scraping ${url}: ${error.message}`, logs, logDiv);
              throw error; // Re-throw to stop processing if needed
            } finally {
              completed++;
              logMessage(`[Progress] Completed ${completed} / ${urls.length}`, logs, logDiv);
            }
          };

          // Concurrency control
          const executing = [];
          for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const p = processURL(url);
            executing.push(p);
            if (executing.length >= concurrency) {
              await Promise.all(executing); // Wait for the completion of current concurrency
              executing.length = 0; // Clear the executing promises
            }
          }
          await Promise.all(executing); // Wait for any remaining promises

          // After scraping, generate chapters array
          const chapters = urls.map((url) => scrapedCache[url]); // Map to the cached content

          await generateEpub(chapters, logs, logDiv);
          logMessage("[Complete] EPUB generation complete.", logs, logDiv);
        } catch (error) {
          logMessage(`[Error] Error generating EPUB: ${error.message}`, logs, logDiv);
          alert(`Error generating EPUB: ${error.message}`);
        } finally {
          // Create log file
          const logContent = logs.join("\n");
          const logBlob = new Blob([logContent], { type: "text/plain;charset=utf-8" });
          saveAs(logBlob, "scraping_log.log");
        }
      } else {
        alert("Please provide a list of URLs.");
      }
    });

    panel.appendChild(downloadButton);

    return panel;
  }

  // --- Scraping Functionality ---
  async function scrapeContent(url, headingSelector, contentSelector) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const titleElement = doc.querySelector(headingSelector);
      const contentElement = doc.querySelector(contentSelector);

      if (!titleElement || !contentElement) {
        throw new Error(
          "Could not find heading or content element with the given selectors.",
        );
      }

      const title = titleElement.textContent.trim();
      const content = contentElement.innerHTML;
      return { title: title, content: content };
    } catch (error) {
      console.error("Scraping error:", error);
      throw error;
    }
  }

  // --- EPUB Generation ---
  async function generateEpub(chapters, logs, logDiv) {
    return new Promise((resolve, reject) => {
      try {
        // Basic EPUB structure
        let epubContent = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata>
    <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Web Novel</dc:title>
    <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Scraped Content</dc:creator>
    <dc:publisher xmlns:dc="http://purl.org/dc/elements/1.1/">Custom Scraper</dc:publisher>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
  </metadata>
  <manifest>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${chapters
      .map((chapter, index) => `<item id="chapter${index + 1}" href="chapter${index + 1}.xhtml" media-type="application/xhtml+xml"/>`)
      .join("\n")}
  </manifest>
  <spine toc="toc">
    ${chapters
      .map((chapter, index) => `<itemref idref="chapter${index + 1}"/>`)
      .join("\n")}
  </spine>
</package>`;

        // Create chapter files
        let chapterFiles = chapters.map(
          (chapter, index) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${chapter.title}</title></head>
<body>
  <h2>${chapter.title}</h2>
  ${chapter.content}
</body>
</html>`,
        );

        // Create table of contents
        let tocContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Table of Contents</title></head>
<body>
  <nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc">
    <ol>
      ${chapters
        .map(
          (chapter, index) => `<li><a href="chapter${index + 1}.xhtml">${chapter.title}</a></li>`,
        )
        .join("\n")}
    </ol>
  </nav>
</body>
</html>`;

        // Create mimetype file (required for EPUB)
        let mimetypeContent = "application/epub+zip";

        // Create a ZIP file in memory
        let zip = new JSZip();
        zip.file("mimetype", mimetypeContent);
        zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
        zip.file("content.opf", epubContent);
        zip.file("toc.xhtml", tocContent);

        chapterFiles.forEach((chapterContent, index) => {
          zip.file(`chapter${index + 1}.xhtml`, chapterContent);
        });

        // Generate the EPUB file as a blob
        zip
          .generateAsync({ type: "blob", mimeType: "application/epub+zip" })
          .then((epubBlob) => {
            logMessage("[EPUB] EPUB Blob generated", logs, logDiv);
            saveAs(epubBlob, "webnovel.epub");
            resolve();
          })
          .catch((err) => {
            logMessage(`[EPUB Error] ${err}`, logs, logDiv);
            reject(err);
          });
      } catch (error) {
        logMessage(`[EPUB Error] ${error}`, logs, logDiv);
        reject(error);
      }
    });
  }

  // --- Initialization ---
  function initialize() {
    const settingsPanel = createSettingsPanel();
    document.body.appendChild(settingsPanel);
  }

  // --- Register Menu Command ---
  GM_registerMenuCommand("Show Web Novel Scraper", initialize);
})();
