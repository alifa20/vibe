import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseUrl, resolveLink, sameOrigin, isHttp } from "../src/url.mjs";

test("lowercases scheme and host, drops the fragment and the default port", () => {
  assert.equal(normaliseUrl("HTTP://Example.com:80/a#x"), "http://example.com/a");
  assert.equal(normaliseUrl("https://EXAMPLE.com:443/A/b"), "https://example.com/A/b", "paths keep their case");
  assert.equal(normaliseUrl("http://example.com:8080/"), "http://example.com:8080/");
  assert.equal(normaliseUrl("http://example.com"), "http://example.com/");
});

test("query strings are kept and stay distinct", () => {
  assert.notEqual(normaliseUrl("http://example.com/a?b=1"), normaliseUrl("http://example.com/a?b=2"));
  assert.equal(normaliseUrl("http://example.com/a?b=1#top"), "http://example.com/a?b=1");
});

test("resolveLink resolves relative links against the base", () => {
  assert.equal(resolveLink("/a?b=1", "http://example.com/x/y"), "http://example.com/a?b=1");
  assert.equal(resolveLink("../c", "http://example.com/x/y/z"), "http://example.com/x/c");
  assert.equal(resolveLink("d", "http://example.com/base/"), "http://example.com/base/d");
  assert.equal(resolveLink("  /spaced  ", "http://example.com/"), "http://example.com/spaced");
});

test("resolveLink skips mailto:, tel:, javascript: and data: links, empty and fragment-only hrefs", () => {
  for (const href of ["mailto:a@b.c", "tel:+123", "javascript:void(0)", "JavaScript:alert(1)", "data:text/html,hi", "", "#top"]) {
    assert.equal(resolveLink(href, "http://example.com/"), null, href);
  }
});

test("resolveLink returns null for unparseable hrefs", () => {
  assert.equal(resolveLink("http://[bad", "http://example.com/"), null);
});

test("sameOrigin compares scheme, host and port", () => {
  assert.equal(sameOrigin("http://example.com/a", "http://EXAMPLE.com:80/b"), true);
  assert.equal(sameOrigin("http://example.com/a", "https://example.com/a"), false);
  assert.equal(sameOrigin("http://example.com/a", "http://sub.example.com/a"), false);
  assert.equal(sameOrigin("http://example.com:81/a", "http://example.com/a"), false);
});

test("isHttp accepts only http and https", () => {
  assert.equal(isHttp("https://x.test/"), true);
  assert.equal(isHttp("ftp://x.test/"), false);
});
