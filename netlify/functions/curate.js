// Phase 4 (optional): in-dashboard curation → commits curation.json via GitHub API.
// Set env vars in Netlify: GH_TOKEN (fine-grained, contents:write on this repo),
// GH_REPO ("owner/name"), CURATE_SECRET (shared secret; send as x-curate-key header).
export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-curate-key") !== process.env.CURATE_SECRET)
    return new Response("Forbidden", { status: 403 });

  const changes = await req.json(); // { "<signal-id>": { fit, heat, play, status, note }, ... }
  const gh = { Authorization: `Bearer ${process.env.GH_TOKEN}`, "User-Agent": "ledgerline" };
  const url = `https://api.github.com/repos/${process.env.GH_REPO}/contents/data/curation.json`;

  const current = await fetch(url, { headers: gh }).then((r) => r.json());
  const file = JSON.parse(Buffer.from(current.content, "base64").toString("utf8"));
  Object.assign(file.entries, changes);

  const res = await fetch(url, {
    method: "PUT",
    headers: gh,
    body: JSON.stringify({
      message: `curation update (${Object.keys(changes).length} signal(s))`,
      content: Buffer.from(JSON.stringify(file, null, 2) + "\n").toString("base64"),
      sha: current.sha,
    }),
  });
  return new Response(res.ok ? "ok" : "GitHub API error", { status: res.ok ? 200 : 502 });
};
