import { test } from "node:test";
import assert from "node:assert/strict";
import { URL, URLSearchParams } from "../src/url.js";

test("a URL resolves against its base and normalizes as the standard says", () => {
  const url = new URL("../b/./c/../d?x=1 2#top", "HTTPS://Example.com:443/a/c");
  assert.equal(url.href, "https://example.com/b/d?x=1%202#top");
  assert.equal(url.origin, "https://example.com");
  assert.equal(new URL("./x.js", "file:///app/dist/app.js").href, "file:///app/dist/x.js");
  assert.equal(new URL("http://[::1]:3000/").host, "[::1]:3000");
  assert.equal(new URL("mailto:me@x.com").pathname, "me@x.com");
  assert.equal(new URL("custom://h/a/../b").href, "custom://h/b");
  assert.equal(new URL("https://h/é").pathname, "/%C3%A9");
  assert.throws(() => new URL("nope"), TypeError);
  assert.throws(() => new URL("https://h:99999/"), TypeError);
  assert.equal(URL.canParse("/x", "https://h"), true);
  assert.equal(URL.parse("http://"), null);
});

test("searchParams and search stay in step", () => {
  const url = new URL("https://h/p?a=1&a=2");
  assert.deepEqual(url.searchParams.getAll("a"), ["1", "2"]);
  url.searchParams.set("b", "x y&z");
  assert.equal(url.search, "?a=1&a=2&b=x+y%26z");
  url.search = "?c=ü";
  assert.equal(url.searchParams.get("c"), "ü");
  url.searchParams.delete("c");
  assert.equal(url.href, "https://h/p");
  const params = new URLSearchParams("?b=2&a=1&b=1+1&e=%F0%9F%98%80");
  params.sort();
  assert.equal(params.toString(), "a=1&b=2&b=1+1&e=%F0%9F%98%80");
  assert.equal(params.get("e"), "😀");
  assert.equal(new URLSearchParams({ x: "1" }).toString(), "x=1");
  assert.deepEqual([...new URLSearchParams([["k", "v"]])], [["k", "v"]]);
  assert.equal(params.size, 4);
});
