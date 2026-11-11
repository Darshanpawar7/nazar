import '@fontsource-variable/bricolage-grotesque/wght.css';
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles.css';
import { highlightAll, wireCopyButtons } from './code';
import { renderGallery } from './gallery';
import { startHero } from './hero';
import { startPlayground } from './playground';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The page is missing #${id}`);
  return found as T;
}

function wireTheme(): void {
  const button = element<HTMLButtonElement>('theme');
  const root = document.documentElement;
  const label = () => {
    const light = root.dataset.theme === 'light';
    button.setAttribute('aria-label', light ? 'Switch to the dark theme' : 'Switch to the light theme');
  };
  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try {
      localStorage.setItem('nazar-theme', next);
    } catch {
      // Without storage the choice still applies until the page is closed.
    }
    label();
    // Canvases read their colours from CSS, so they redraw when the theme changes.
    document.dispatchEvent(new Event('themechange'));
  });
  label();
}

function wireTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (chosen: HTMLButtonElement) => {
    for (const tab of tabs) {
      const selected = tab === chosen;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !selected;
    }
  };
  tabs.forEach((tab, index) => {
    tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (next) {
        select(next);
        next.focus();
      }
    });
  });
}

wireTheme();
wireTabs();
wireCopyButtons(document);
highlightAll(document);
startHero(element('hero-canvas'), element('hero-log'), element('hero-play'), element('hero-status'));
renderGallery(element('cards'));
startPlayground();
