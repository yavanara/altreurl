const THEME_KEY = "altreurlWebTheme";
const APP_VERSION = "v1.14.0";
const ORG_URL = "https://github.com/yavanara";
const REPO_URL = "https://github.com/yavanara/altreurl";
const DONATION_URL = "#";
const CHROME_STORE_URL = "#";
const EDGE_STORE_URL = "#";

function getCurrentPage() {
  return window.location.pathname.split("/").pop() || "index.html";
}

function getHomeHref(hash) {
  return getCurrentPage() === "index.html" ? hash : `index.html${hash}`;
}

function getThemedIconPath(iconName, theme = document.documentElement.dataset.colorScheme || getPreferredTheme()) {
  const folder = theme === "dark" ? "w" : "b";

  return `assets/icons/${folder}/${iconName}`;
}

function iconMarkup(iconName, size = 16) {
  return `<img class="block flex-none" data-themed-icon="${iconName}" alt="" width="${size}" height="${size}">`;
}

function renderSiteChrome() {
  const currentPage = getCurrentPage();
  const header = document.querySelector("[data-site-header]");
  const footer = document.querySelector("[data-site-footer]");

  if (header) {
    header.innerHTML = `
      <header class="sticky top-0 z-50 border-b border-line/50 bg-bg/80 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/60 transition-all duration-300">
        <div class="max-w-7xl mx-auto flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
          <a class="flex items-center gap-3 transition-transform hover:scale-105" href="index.html" aria-label="Altreurl home">
            <img class="w-8 h-8 rounded-xl shadow-sm border border-line bg-panel" src="assets/favicons/v2/Altreurl_V2_48.png" alt="" width="32" height="32">
            <span class="text-text font-extrabold text-lg tracking-tight">Altreurl</span>
            <span class="px-2 py-0.5 rounded-full bg-accent/10 text-accent-strong text-xs font-bold border border-accent/20">${APP_VERSION}</span>
          </a>
          
          <nav class="hidden md:flex items-center gap-6" aria-label="Primary navigation">
            <a class="text-sm font-semibold text-muted hover:text-text transition-colors aria-[current=page]:text-accent-strong" href="index.html" ${currentPage === "index.html" ? 'aria-current="page"' : ""}>Home</a>
            <a class="text-sm font-semibold text-muted hover:text-text transition-colors aria-[current=page]:text-accent-strong" href="docs.html" ${currentPage === "docs.html" ? 'aria-current="page"' : ""}>Docs</a>
            <a class="text-sm font-semibold text-muted hover:text-text transition-colors aria-[current=page]:text-accent-strong" href="privacy.html" ${currentPage === "privacy.html" ? 'aria-current="page"' : ""}>Privacy</a>
            <a class="text-sm font-semibold text-muted hover:text-text transition-colors aria-[current=page]:text-accent-strong" href="support.html" ${currentPage === "support.html" ? 'aria-current="page"' : ""}>Support</a>
          </nav>

          <div class="flex items-center gap-4">
            <button class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-panel border border-line text-muted hover:text-text hover:border-accent hover:bg-accent-soft transition-all" type="button" data-theme-toggle aria-label="Switch color theme">
              <img class="block w-4 h-4 opacity-70" data-theme-icon data-themed-icon="icons8-moon-and-stars-32.png" alt="">
              <span data-theme-label class="hidden">Light</span>
            </button>
          </div>
        </div>
      </header>
    `;
  }

  if (footer) {
    footer.innerHTML = `
      <footer class="mt-20 border-t border-line/50 bg-panel-soft/30 backdrop-blur-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-12 md:gap-8">
            <div class="col-span-1 md:col-span-2">
              <a class="flex items-center gap-3 mb-4 w-fit transition-opacity hover:opacity-80" href="index.html" aria-label="Altreurl home">
                <img class="w-8 h-8 rounded-xl shadow-sm border border-line bg-panel" src="assets/favicons/v2/Altreurl_V2_48.png" alt="">
                <strong class="text-text font-extrabold text-lg tracking-tight">Altreurl</strong>
              </a>
              <p class="text-muted text-sm leading-relaxed max-w-sm mb-6">
                Built for developers who would rather debug the backend than wrestle the network tab.
              </p>
              <p class="text-muted text-xs">
                Maintained by <a class="text-text font-bold hover:text-accent-strong transition-colors" href="${ORG_URL}" rel="noopener">Yavanara</a>.<br/>
                Version ${APP_VERSION}. Licensed <a class="text-text font-bold hover:text-accent-strong transition-colors" href="${REPO_URL}/blob/main/LICENSE" rel="noopener">MIT</a>.
              </p>
            </div>
            
            <div class="grid grid-cols-2 md:grid-cols-3 gap-8 col-span-1 md:col-span-2">
              <nav class="flex flex-col gap-3" aria-label="Project links">
                <strong class="text-text text-sm font-bold tracking-wide uppercase">Project</strong>
                <a class="text-muted text-sm hover:text-accent-strong transition-colors aria-[current=page]:text-text" href="${REPO_URL}" rel="noopener">GitHub</a>
                <a class="text-muted text-sm hover:text-accent-strong transition-colors aria-[current=page]:text-text" href="docs.html" ${currentPage === "docs.html" ? 'aria-current="page"' : ""}>Docs</a>
                <a class="text-muted text-sm hover:text-accent-strong transition-colors aria-[current=page]:text-text" href="support.html" ${currentPage === "support.html" ? 'aria-current="page"' : ""}>Support</a>
              </nav>
              
              <nav class="flex flex-col gap-3" aria-label="Store links">
                <strong class="text-text text-sm font-bold tracking-wide uppercase">Stores</strong>
                <a class="text-muted text-sm hover:text-accent-strong transition-colors" href="${CHROME_STORE_URL}">Chrome</a>
                <a class="text-muted text-sm hover:text-accent-strong transition-colors" href="${EDGE_STORE_URL}">Edge</a>
                <a class="text-muted text-sm hover:text-accent-strong transition-colors aria-[current=page]:text-text" href="privacy.html" ${currentPage === "privacy.html" ? 'aria-current="page"' : ""}>Privacy</a>
              </nav>
              
              <nav class="flex flex-col gap-3" aria-label="Community links">
                <strong class="text-text text-sm font-bold tracking-wide uppercase">Community</strong>
                <a class="text-muted text-sm hover:text-accent-strong transition-colors" href="${ORG_URL}" rel="noopener">Yavanara</a>
                <a class="text-muted text-sm hover:text-accent-strong transition-colors" href="${DONATION_URL}">Support Dev</a>
              </nav>
            </div>
          </div>
        </div>
      </footer>
    `;
  }
}

function getPreferredTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);

  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.colorScheme = theme;
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const nextTheme = theme === "dark" ? "Light" : "Dark";
    const label = button.querySelector("[data-theme-label]");
    const icon = button.querySelector("[data-theme-icon]");

    if (label) {
      label.textContent = nextTheme;
    } else {
      button.textContent = nextTheme;
    }

    if (icon) {
      icon.dataset.themedIcon = theme === "dark" ? "icons8-sun-32.png" : "icons8-moon-and-stars-32.png";
      icon.src = getThemedIconPath(icon.dataset.themedIcon, theme);
    }

    button.setAttribute("aria-label", `Switch to ${nextTheme.toLowerCase()} mode`);
  });

  document.querySelectorAll("[data-themed-icon]").forEach((icon) => {
    icon.src = getThemedIconPath(icon.dataset.themedIcon, theme);
  });
}

function initTheme() {
  applyTheme(getPreferredTheme());

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const currentTheme = document.documentElement.dataset.colorScheme || getPreferredTheme();
      const nextTheme = currentTheme === "dark" ? "light" : "dark";

      localStorage.setItem(THEME_KEY, nextTheme);
      applyTheme(nextTheme);
    });
  });
}

function initGallery() {
  const gallery = document.querySelector("[data-gallery]");

  if (!gallery) {
    return;
  }

  const image = gallery.querySelector("[data-gallery-image]");
  const title = gallery.querySelector("[data-gallery-title]");
  const count = gallery.querySelector("[data-gallery-count]");
  const status = gallery.querySelector("[data-gallery-status]");
  const previousButton = gallery.querySelector("[data-gallery-prev]");
  const nextButton = gallery.querySelector("[data-gallery-next]");
  const thumbs = [...gallery.querySelectorAll("[data-gallery-thumb]")];

  if (!image || thumbs.length === 0) {
    return;
  }

  const items = thumbs.map((thumb) => ({
    alt: thumb.dataset.galleryAlt || "",
    src: thumb.dataset.gallerySrc || "",
    title: thumb.dataset.galleryTitle || ""
  }));

  let activeIndex = 0;
  let autoAdvanceTimer = null;

  function setActive(index, options = {}) {
    const { behavior = "smooth", revealThumb = false } = options;

    activeIndex = (index + items.length) % items.length;
    const item = items[activeIndex];

    image.src = item.src;
    image.alt = item.alt;

    if (title) {
      title.textContent = item.title;
    }

    if (count) {
      count.textContent = `${activeIndex + 1} / ${items.length}`;
    }

    if (status) {
      status.textContent = item.title;
    }

    thumbs.forEach((thumb, thumbIndex) => {
      const isActive = thumbIndex === activeIndex;

      thumb.classList.toggle("is-active", isActive);
      thumb.setAttribute("aria-current", isActive ? "true" : "false");
    });

    if (revealThumb) {
      thumbs[activeIndex].scrollIntoView({
        behavior,
        block: "nearest",
        inline: "nearest"
      });
    }
  }

  function goNext() {
    setActive(activeIndex + 1);
  }

  function goPrevious() {
    setActive(activeIndex - 1);
  }

  previousButton?.addEventListener("click", () => {
    goPrevious();
    restartAutoAdvance();
  });
  nextButton?.addEventListener("click", () => {
    goNext();
    restartAutoAdvance();
  });

  thumbs.forEach((thumb, index) => {
    thumb.addEventListener("click", () => {
      setActive(index, { revealThumb: true });
      restartAutoAdvance();
    });
  });

  function startAutoAdvance() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    autoAdvanceTimer = window.setInterval(goNext, 3600);
  }

  function restartAutoAdvance() {
    window.clearInterval(autoAdvanceTimer);
    startAutoAdvance();
  }

  gallery.addEventListener("mouseenter", () => window.clearInterval(autoAdvanceTimer));
  gallery.addEventListener("mouseleave", restartAutoAdvance);
  gallery.addEventListener("focusin", () => window.clearInterval(autoAdvanceTimer));
  gallery.addEventListener("focusout", restartAutoAdvance);

  setActive(0, { behavior: "auto" });
  startAutoAdvance();
}

function initDocsVersion() {
  const switcher = document.querySelector("[data-doc-version]");

  if (!switcher) {
    return;
  }

  const panels = [...document.querySelectorAll("[data-doc-panel]")];
  const labels = [...document.querySelectorAll("[data-doc-version-label]")];

  function showVersion(version) {
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.docPanel !== version;
    });

    labels.forEach((label) => {
      label.textContent = version;
    });
  }

  switcher.addEventListener("change", () => showVersion(switcher.value));
  showVersion(switcher.value);
}

renderSiteChrome();
initTheme();
initGallery();
initDocsVersion();
