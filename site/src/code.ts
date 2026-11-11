/**
 * A tiny TypeScript highlighter for the code samples. It only colours keywords, strings, numbers, comments and
 * names, and it builds DOM nodes with textContent: no HTML strings, so no injection.
 */

const KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'const',
  'let',
  'for',
  'of',
  'if',
  'await',
  'async',
  'return',
  'new',
  'function',
]);

const TOKEN = /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)|(\s+)|([^\s\w$'])/g;

type Kind = 'comment' | 'string' | 'number' | 'keyword' | 'call' | 'plain';

function kindOf(match: RegExpExecArray, source: string): Kind {
  if (match[1]) return 'comment';
  if (match[2]) return 'string';
  if (match[3]) return 'number';
  if (match[4]) {
    if (KEYWORDS.has(match[4])) return 'keyword';
    return source[TOKEN.lastIndex] === '(' ? 'call' : 'plain';
  }
  return 'plain';
}

export function highlight(target: HTMLElement, source: string): void {
  const fragment = document.createDocumentFragment();
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(source); match; match = TOKEN.exec(source)) {
    const kind = kindOf(match, source);
    if (kind === 'plain') {
      fragment.append(match[0]);
      continue;
    }
    const span = document.createElement('span');
    span.className = `tok-${kind}`;
    span.textContent = match[0];
    fragment.append(span);
  }
  target.replaceChildren(fragment);
}

/** Highlights every static code sample on the page, and lets keyboard users scroll the wide ones. */
export function highlightAll(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('pre.code').forEach(block => {
    block.tabIndex = 0;
  });
  root
    .querySelectorAll<HTMLElement>('pre.code > code:not([id])')
    .forEach(block => highlight(block, block.textContent ?? ''));
}

/** "Copy" buttons copy the text of the element named in their data-copy attribute. */
export function wireCopyButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach(button => {
    const label = button.textContent ?? 'Copy';
    button.addEventListener('click', () => {
      const source = document.querySelector(button.dataset.copy ?? '');
      navigator.clipboard.writeText(source?.textContent ?? '').then(
        () => {
          button.textContent = 'Copied';
          setTimeout(() => {
            button.textContent = label;
          }, 1600);
        },
        () => {
          button.textContent = 'Copy failed';
        },
      );
    });
  });
}
