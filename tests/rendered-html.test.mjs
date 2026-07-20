import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function renderedHtml() {
  return readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
}

test("statically renders the public market dashboard", async () => {
  const html = await renderedHtml();

  assert.match(html, /<html[^>]+lang="ja"/i);
  assert.match(html, /パークシティ杉並/);
  assert.match(html, /3LDKの参考価格/);
  assert.match(html, /3LDK取引㎡単価の推移と予測/);
  assert.match(html, /2026年 ナウキャスト/);
  assert.match(html, /2027年は予測/);
  assert.match(html, /80%予測レンジ/);
  assert.match(html, /周辺再開発・まちづくりウォッチ/);
  assert.match(html, /再開発差分モデル v0.1/);
  assert.match(html, /基礎予測/);
  assert.match(html, /計画見直し中/);
  assert.match(html, /二重計上を避けるため、現状価格への追加補正は0.00ポイント/);
  assert.match(html, /2027年は供用接近と計画進捗のネット差分として\+0.05ポイント/);
  assert.match(html, /不動産情報ライブラリ 不動産取引価格情報/);
  assert.match(html, /東京23区の今週/);
  assert.match(html, /利用上の重要な注意/);
  assert.match(html, /法令上認められる範囲で責任を負いません/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|SkeletonPreview/);
});

test("does not publish the private transaction details", async () => {
  const html = await renderedHtml();

  assert.doesNotMatch(html, /家屋番号|正確な所在|部屋番号/);
  assert.doesNotMatch(html, /購入価格|リフォーム込み|総投下額/);
  assert.doesNotMatch(html, /融資金額|手付金|残代金/);
});
