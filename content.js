// Injects a floating ⚒ button next to (or near) the prompt textarea on supported sites.
// On click: grabs current textarea content, stashes as pendingPrefill, opens popup.

(function () {
  const BUTTON_ID = 'pf-floating-btn';
  let observerAttached = false;

  function findTextarea() {
    const candidates = [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Message"]',
      'textarea',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function readTextarea(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value || '';
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return el.innerText || '';
    return '';
  }

  function placeButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const ta = findTextarea();
    if (!ta) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open PromptForge optimizer');
    btn.title = 'Optimize this prompt with PromptForge (Cmd+Shift+O)';
    btn.textContent = '⚒';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = readTextarea(findTextarea());
      try {
        await chrome.storage.local.set({ pendingPrefill: text });
      } catch (err) {
        console.warn('[PromptForge] could not stash prefill:', err);
      }
      // Content scripts cannot open the action popup directly in MV3.
      // Open the popup HTML in a standalone window — same UI, works everywhere.
      window.open(
        chrome.runtime.getURL('popup.html?standalone=1'),
        'pf-popup',
        'width=720,height=780,resizable=yes'
      );
    });

    document.body.appendChild(btn);
  }

  function ensureLoop() {
    placeButton();
    if (!observerAttached) {
      const mo = new MutationObserver(() => placeButton());
      mo.observe(document.body, { childList: true, subtree: true });
      observerAttached = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureLoop, { once: true });
  } else {
    ensureLoop();
  }
})();
