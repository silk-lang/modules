# Native placement for virtual lists (proposal)

Keep the existing tree virtualizer. Change who lays out the list: the parent
layout engine allocates one bounded scrollport, the list assigns rectangles to
its mounted row roots, and ordinary layout still owns the contents of each row.
An unmounted item has a logical extent, never a layout node. The frontend owns
item data, keys, rendering and reconciliation; it does not calculate positions.

## Sizing contract

Start with vertical lists that fill the scrollport's content width. Sizes are
border-box heights in logical CSS pixels; the list owns gaps between rows.
Proposed frontend vocabulary (not existing API):

```
list(count: messages.length, sizing: estimated(48), gap: 4)
row(message.id, height: message.collapsed ? exact(32) : auto)
```

- `fixed(h)` on the list: every row gets the same height. Offset is index times
  stride; total extent excludes the final gap. No per-index allocation, row
  height query, or measurement correction, including on a distant jump.
- `estimated(h)` on the list: unknown items start at `h`. A client that knows
  better can submit exact heights in an indexed batch without creating nodes.
  No synchronous callback across the frontend boundary during scroll or layout.
- `auto` in an estimated list: lay out the mounted subtree at its assigned width
  with natural height. Consume its resulting border box; do not run a second
  layout just to ask how tall it is. Remeasure only when relevant content,
  style, fonts or width change. An exact row instead gets definite constraints:
  overflowing contents do not enlarge its slot.

Unlike spacer-based flex layout, a change of scroll offset within the mounted
window should require only scroll translation and existing clipping, not row
layout. The engine needs a way to publish a scrollable content extent independent
of child bounds, and to use assigned boxes consistently for painting, inspection,
hit testing and accessibility. Do not implement this as a paint-only transform.

## Frame and frontend contract

Extend the existing configure / query requested range / bind indexed children
protocol rather than adding a list-specific renderer. Keep focus pinning, pixel
overscan and range hysteresis. Adapters reconcile only when the requested range
or pin changes; inputs for a range and its bindings should carry a generation
so a delayed response after a data reset cannot bind obsolete rows. Deliver
range changes through each host's frame scheduling, not a per-scroll JS loop.

Batch measurement deltas, preserve the first visible index and its intra-row
offset, clamp to the new extent, then publish one corrected range. Bound work
per frame: if new rows still need mounting, schedule a continuation rather than
looping to convergence. A data revision resets index-based hints; stable keys
preserve frontend state, not tree measurements across arbitrary reorders.

## Delivery and decision gate

1. Instrument the existing spacer path. Add opt-in fixed placement through the
   shared protocol and demonstrate it in direct Silk, loom, and the JS host
   bindings. Expose the same contract through core and framework adapters;
   no adapter should need spacer elements, observers or prefix sums.
2. Add opt-in estimated placement using the existing prefix-sum index first.
   It is linear in count to initialize and logarithmic to update or seek. Only
   replace it with a sparse index if large variable lists justify the complexity.
   Preserve the current spacer behavior for existing clients during validation.
3. Compare identical row trees on the old and new paths: initial mount, steady
   scrolling, a jump to the last of a million rows, width changes with wrapped
   text, and a focused input outside overscan. Record p95 frame time, layout
   visits, measurement reads, allocations and frontend range deliveries.
   Require zero spacer nodes, zero fixed-row height reads, count-independent
   fixed-mode geometry storage, and no row relayout on a scroll within the
   retained window. Verify scroll extent, hit targets and focus on each host.

## Screen-reader behavior is a release criterion

Use the same list rendered without virtualization as the reference. A reader
moving from row 40 to row 41 should encounter the same text, links and controls
in the same order, even when row 41 is outside overscan. Announcing “40 of 500”
is useful context, but it is not a substitute for reaching the next row.

Publish each item's one-based logical position and the logical set size, not
its offset in the mounted window. Use list/list-item roles for ordinary lists;
feed/article is for streams of articles, not a synonym for virtualization.

For keyboard navigation, keep the exact focused node and its row alive across
scrolling. When Tab or a widget's arrow-key command crosses the mount boundary,
realize the next logical target before handing off focus, reveal it, and only
then release the old row. Test both directions with a control nested in a row.
For widgets using `aria-activedescendant`, also retain the referenced node:
keyboard focus stays on the container, so a focus-only pin is insufficient.

Separate semantic identity from mounted node IDs. Frontends must be able to
supply row and descendant semantics from their model, or fulfill a tree request
to realize the relevant subtree. Count and height alone cannot describe a link.
Keep the reader's browse position by stable item and descendant identity,
independent of keyboard focus. When an action needs a live control, resolve
that identity, materialize it, and deliver the action once. Merely enumerating
offscreen content must not steal focus or scroll the viewport.

Prototype crossing a mount boundary with the built-in reader and each native
accessibility bridge before settling the protocol. Do not assume a platform
notifies us when its reader advances a browse cursor: verify how children are
discovered, what must already be published, and the cost on a million-row list.
Compare forward/backward reading, finding an offscreen link, activating it,
and retaining the reading position after scrolling against the nonvirtual list.
Track semantic memory separately from layout memory. Do not claim parity on
a host until these workflows pass with its actual screen reader.

Keep grids, masonry, sticky headers and reverse feeds out of the first increment.
