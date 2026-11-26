// What a chat application ships beside React and does not run at first render: a Markdown
// parser and a syntax highlighter with its languages. They bring the bundle to the size of
// a real one (about 1 MB), so parsing and compiling it costs what it does in an application.
import hljs from "highlight.js";
import { marked } from "marked";

export function renderMarkdown(source) {
  return marked.parse(source);
}

export function highlight(code, language) {
  return hljs.highlight(code, { language }).value;
}
