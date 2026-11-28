import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = await readFile(new URL('../js/silk-ui-dom.js', import.meta.url), 'utf8');
const { Page, Reader } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(source + '\nexport { Page, Reader };').toString('base64')
);

function u8(v) {
  return Buffer.from([v & 0xff]);
}

function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

function text(s) {
  const utf8 = Buffer.from(s, 'utf8');
  return Buffer.concat([u32(utf8.length), utf8]);
}

function toReader(chunks) {
  const bytes = Buffer.concat(chunks);
  return new Reader(bytes.buffer, bytes.byteOffset, bytes.length);
}

test('attribute decoders parse PreventRules (23), DragRegion (24), and EditMode (25)', () => {
  const meta = new Map([[1, {}]]);
  const page = { nodes: new Map([[1, {}]]), meta };

  // 23: PreventRules with actions=66 (PREVENT_SCROLL | PREVENT_BEFORE_INPUT) and 2 key rules
  const preventReader = toReader([
    u8(23),
    u32(66),
    u32(2),
    // Rule 0: Allow Enter on any modifiers
    u8(1), u8(0), text('Enter'), u32(0), u32(0), u32(0), u8(0), u8(0),
    // Rule 1: Prevent AnyKey (default-deny) when not composing
    u8(0), u8(3), text(''), u32(0), u32(0), u32(0), u8(1), u8(0),
  ]);
  Page.prototype.attribute.call(page, 1, preventReader);
  assert.equal(preventReader.done, true);
  assert.equal(meta.get(1).preventRules.actions, 66);
  assert.equal(meta.get(1).preventRules.keyRules.length, 2);
  assert.deepEqual(meta.get(1).preventRules.keyRules[0], {
    action: 1,
    matchKind: 0,
    value: 'Enter',
    modifiersMask: 0,
    modifiersValue: 0,
    anyModifierMask: 0,
    requireNotComposing: false,
    caseInsensitive: false,
  });

  // 24: DragRegion = true
  const dragReader = toReader([u8(24), u8(1)]);
  Page.prototype.attribute.call(page, 1, dragReader);
  assert.equal(dragReader.done, true);
  assert.equal(meta.get(1).dragRegion, true);

  // 25: EditMode (Filtered=1, maxLength=8, allowedChars=2 (AsciiHex), allowed="0x", caseTransform=1, rejectWhitespace=true)
  const editReader = toReader([u8(25), u8(1), u32(8), u8(2), text('0x'), u8(1), u8(1)]);
  Page.prototype.attribute.call(page, 1, editReader);
  assert.equal(editReader.done, true);
  assert.deepEqual(meta.get(1).editMode, {
    ownership: 1,
    filter: {
      maxLength: 8,
      allowedChars: 2,
      allowed: '0x',
      caseTransform: 1,
      rejectWhitespace: true,
    },
  });
});

test('preventsKey evaluates physical code, modifier mask, default-deny allowlist, and composition guard', () => {
  const parent = { id: 10 };
  const child = { id: 20 };
  const page = {
    idOf: (n) => n.id,
    meta: new Map([
      [
        10,
        {
          preventRules: {
            actions: 0,
            keyRules: [
              // Allow Enter without modifiers
              {
                action: 1,
                matchKind: 0,
                value: 'Enter',
                modifiersMask: 15,
                modifiersValue: 0,
                anyModifierMask: 0,
                requireNotComposing: false,
                caseInsensitive: false,
              },
              // Prevent Ctrl+K by physical code KeyK
              {
                action: 0,
                matchKind: 1,
                value: 'KeyK',
                modifiersMask: 2,
                modifiersValue: 2,
                anyModifierMask: 0,
                requireNotComposing: true,
                caseInsensitive: false,
              },
              // Prevent NamedKeys when not composing
              {
                action: 0,
                matchKind: 2,
                value: '',
                modifiersMask: 0,
                modifiersValue: 0,
                anyModifierMask: 0,
                requireNotComposing: true,
                caseInsensitive: false,
              },
              // Default-deny AnyKey when not composing
              {
                action: 0,
                matchKind: 3,
                value: '',
                modifiersMask: 0,
                modifiersValue: 0,
                anyModifierMask: 0,
                requireNotComposing: true,
                caseInsensitive: false,
              },
            ],
          },
        },
      ],
      [20, {}],
    ]),
  };

  assert.equal(
    Page.prototype.preventsKey.call(page, [parent, child], { key: 'Enter', code: 'Enter' }),
    false,
    'Allow rule exempts unmodified Enter ahead of default-deny'
  );
  assert.equal(
    Page.prototype.preventsKey.call(page, [parent, child], { key: 'k', code: 'KeyK', ctrlKey: true }),
    true,
    'Ctrl+KeyK matches PhysicalCode + modifier mask'
  );
  assert.equal(
    Page.prototype.preventsKey.call(page, [parent, child], { key: 'F5', code: 'F5' }),
    true,
    'NamedKeys matches F5'
  );
  assert.equal(
    Page.prototype.preventsKey.call(page, [parent, child], { key: 'x', code: 'KeyX' }),
    true,
    'AnyKey default-deny catches printable keys when not composing'
  );
  assert.equal(
    Page.prototype.preventsKey.call(page, [parent, child], {
      key: 'a',
      code: 'KeyA',
      isComposing: true,
    }),
    false,
    'requireNotComposing lets IME composition keys through'
  );
});

test('apply handles SetValue (43), ForceValue (44), and SubscribeGeometry (45)', () => {
  const written = [];
  const node7 = { id: 7 };
  const bytes = Buffer.concat([
    u8(43), u32(7), text('rev-text'), u32(5), u32(0),
    u8(44), u32(7), text('forced-text'),
    u8(45), u32(2), u32(7), u32(9),
  ]);
  const page = {
    destroyed: [],
    nodes: new Map([[7, node7]]),
    exports: { memory: { buffer: bytes.buffer } },
    setText: (node, value) => written.push([node.id, value]),
    place() {},
    virtualSoon() {},
  };

  Page.prototype.apply.call(page, bytes.byteOffset, bytes.length);
  assert.deepEqual(written, [
    [7, 'rev-text'],
    [7, 'forced-text'],
  ]);
});
