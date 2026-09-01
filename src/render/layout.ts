import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * Enough style to be readable and no more. The credibility is in the citations,
 * not the presentation.
 */
const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         line-height: 1.5; max-width: 60rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  code, td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.75rem; }
  th, td { text-align: left; padding: 0.35rem 0.75rem 0.35rem 0; border-bottom: 1px solid #8884;
           vertical-align: top; }
  th { font-weight: 600; }
  .muted { opacity: 0.75; }
  .cite { font-size: 0.9em; }
  blockquote { margin: 0.75rem 0; padding-left: 1rem; border-left: 3px solid #8884; }
  form { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 1.5rem 0; }
  input[type=text] { flex: 1 1 24rem; padding: 0.5rem; font: inherit; }
  button { padding: 0.5rem 1rem; font: inherit; cursor: pointer; }
  ul.downloads { list-style: none; padding: 0; }
  ul.downloads li { margin: 0.25rem 0; }
  footer { margin-top: 3rem; font-size: 0.9em; }
`;

export function page(title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      ${raw(STYLE)}
    </style>
  </head>
  <body>
    <header><a href="/">Annex One</a></header>
    <main>${body}</main>
    <footer class="muted">
      <p>
        This produces a document. It does not make anyone compliant with Regulation (EU) 2024/2847, and it is not legal
        advice. A person decides what to do with it.
      </p>
    </footer>
  </body>
</html>`;
}
