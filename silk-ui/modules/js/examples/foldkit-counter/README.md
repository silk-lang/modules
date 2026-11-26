# Foldkit starter page

The ui-js starter page as a [Foldkit](https://foldkit.dev) program: click anywhere and the
count rolls. It is the [React starter](../react-counter)'s twin, and draws with the same
[motion.js](../react-counter/src/motion.js) and [theme.js](../react-counter/src/theme.js).

- [src/main.ts](src/main.ts) is the program: the Model (clicks, streak, theme), the Messages,
  `update` and `view`. What moves between clicks stays out of the Model: a Mount starts the
  motion on the page element and reports clicks, and Commands tell it about a click and a
  theme change.
- [src/entry.ts](src/entry.ts) imports `@silkui/foldkit` and boots the Runtime in
  `document.getElementById('root')`, as a Foldkit program does in a browser.

From `modules/js`, `npm ci && npm run build`, then from the repository root:

```sh
silk run --manifest-path modules/js/demo/silk.toml --optimization none modules/js/examples/foldkit-counter/dist/app.js
```

`npm run typecheck` checks the program with TypeScript.
