// Saves real supplier samples into tests/fixtures so the parser tests run against live markup.
// Run from a machine that can reach both sites:  npm run capture-fixtures -- <hub360 product url> [...]
import { mkdirSync, writeFileSync } from "node:fs";
import { userAgent } from "../src/lib/sync/types";

async function main() {
  mkdirSync("tests/fixtures", { recursive: true });
  const feed = await fetch("https://www.microscale.net/products.json?limit=20&page=1", { headers: { "user-agent": userAgent() } });
  writeFileSync("tests/fixtures/microscale-products.real.json", await feed.text());
  console.log("microscale-products.real.json saved");
  let i = 0;
  for (const url of process.argv.slice(2)) {
    const res = await fetch(url, { headers: { "user-agent": userAgent() } });
    writeFileSync(`tests/fixtures/hub360-product-${++i}.real.html`, await res.text());
    console.log(`hub360-product-${i}.real.html saved (${url})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const search = await fetch("https://hub360.cc/shop?search=arduino", { headers: { "user-agent": userAgent() } });
  writeFileSync("tests/fixtures/hub360-search.real.html", await search.text());
  console.log("hub360-search.real.html saved");
}
main();
