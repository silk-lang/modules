# Can I use

Which CSS, SVG and JavaScript features work in an app that Silk UI draws itself, on the `window` and `web-canvas` targets. An app on the `web-dom` target is a browser page, and has whatever the browser has.

The list of features is [caniuse](https://caniuse.com)'s, from its [public data](https://github.com/Fyrd/caniuse) (CC BY 4.0): each name links to its page there, and under it are the first versions of Chrome, Firefox and Safari that have it. The answer on the right is ours.

## How an answer is checked

| Answer | What it means |
| --- | --- |
| **Works** | A stylesheet that uses the feature changes what the UI tree lays out or draws, and a test holds it to that |
| **Partly** | Some of it works, and the note says what does not. The parts that are missing have a test too, which fails the day they start to work |
| **Not yet** | The tree ignores it |
| **Not for apps** | It is about web pages or printing, and an app has no use for it |
| **Not checked** | Nobody has tested it yet, so there is no answer |

"Works" means the feature does something, not that every corner of its specification is done. The answers live in `docs/caniuse/support` in the Silk UI repository, each with the stylesheets that back it, and the tree's test suite runs them all.

## CSS

::caniuse CSS

## SVG

::caniuse SVG

## JavaScript

The language itself, as the SilkJS Engine runs it.

::caniuse JavaScript

## JavaScript APIs

What a JavaScript app can call: SilkJS's own APIs and the ones `@silkui/core` adds.

::caniuse JavaScript APIs
