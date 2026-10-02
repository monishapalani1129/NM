export function toast(message, type = "info") {
  let region = document.querySelector("#toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast-region";
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  const item = document.createElement("div");
  item.className = `toast toast--${type}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

export function modal({ title, content, onClose } = {}) {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="icon-button modal-close" type="button" aria-label="Close">×</button><h2 id="modal-title"></h2><div class="modal-content"></div></section>`;
  backdrop.querySelector("#modal-title").textContent = title || "";
  const contentNode = backdrop.querySelector(".modal-content");
  if (content instanceof Node) contentNode.append(content);
  else contentNode.innerHTML = content || "";
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", handleKeydown);
    onClose?.();
    if (returnFocus?.isConnected) returnFocus.focus();
  };
  const onKeydown = (event) => { if (event.key === "Escape") close(); };
  const onTab = (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...backdrop.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) { event.preventDefault(); backdrop.querySelector(".modal")?.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const handleKeydown = (event) => { onKeydown(event); onTab(event); };
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  document.addEventListener("keydown", handleKeydown);
  document.body.append(backdrop);
  backdrop.querySelector("button, input, select")?.focus();
  return { element: backdrop, close };
}

export function skeleton(lines = 3) {
  const wrapper = document.createElement("div");
  wrapper.className = "skeleton-stack";
  wrapper.setAttribute("aria-label", "Loading");
  wrapper.setAttribute("aria-live", "polite");
  for (let index = 0; index < lines; index += 1) {
    const line = document.createElement("span");
    line.className = "skeleton-line";
    wrapper.append(line);
  }
  return wrapper;
}

export function renderMarkdown(markdown) {
  const host = document.createElement("div");
  host.className = "markdown-content";
  const parsed = window.marked ? window.marked.parse(String(markdown || "")) : String(markdown || "").replaceAll("\n", "<br>");
  if (window.DOMPurify) host.innerHTML = window.DOMPurify.sanitize(parsed);
  else host.textContent = String(markdown || "");
  return host;
}

export async function copyToClipboard(text) {
  await navigator.clipboard.writeText(String(text));
  toast("Copied to clipboard.", "success");
}

export function aiFooter() {
  const footer = document.createElement("p");
  footer.className = "ai-footer";
  footer.textContent = "AI can make mistakes. Verify important information.";
  return footer;
}
