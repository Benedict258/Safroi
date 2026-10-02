// Prints the colors and fonts used by waste2light.com so they can be pasted into src/app/tokens.css.
// Run from a machine that can reach the site:  npm run extract-brand
async function main() {
  const html = await (await fetch("https://waste2light.com")).text();
  const sheets = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => new URL(m[1], "https://waste2light.com").href);
  const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const css = [...inline, ...(await Promise.all(sheets.map((u) => fetch(u).then((r) => r.text()))))].join("\n");
  const count = (re: RegExp) => {
    const m = new Map<string, number>();
    for (const x of css.matchAll(re)) m.set(x[0].toLowerCase(), (m.get(x[0].toLowerCase()) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 15);
  };
  console.log("Stylesheets:", sheets);
  console.log("Top colors:", count(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi));
  console.log("Font families:", count(/font-family:\s*[^;}]+/gi));
  console.log("CSS variables:", [...css.matchAll(/--[\w-]+:\s*[^;}]+/g)].map((m) => m[0]).slice(0, 40));
}
main();
