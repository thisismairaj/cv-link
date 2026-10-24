# cv-link

Give each person you send your resume to their own link, and see who opened it.

A small Cloudflare Worker. `https://cv-link.<you>.workers.dev/r/<id>` logs the open and sends
the visitor on to your resume (a Google Drive link, a PDF, anything with a URL). One link per
person means an open tells you who it was. Have more than one resume (say, data and backend)?
Each link remembers which one it sends. Runs on Cloudflare's free tier, no domain needed.

## Why not a UTM tag or Drive's own stats?

UTM tags are read by analytics on a site you run. Google Drive doesn't read them, and a file
shared as "anyone with the link" doesn't tell you who opened it.

## Opens that aren't people

Company email security gateways open links before a person sees the email, and chat apps fetch
links to build previews. cv-link keeps those opens but marks them, with the reason:

- a `HEAD` request, or no user agent;
- a user agent from a scanner or preview fetcher (Barracuda, Mimecast, Proofpoint, Slack, ...);
- an open within 60 seconds of you marking the link as sent.

`stats` shows opens by people and automatic opens separately. Treat an open as a signal of
interest, not proof that someone read the whole thing: a forwarded email can also be opened by
a colleague.

## Privacy

It stores the time, the country Cloudflare reports, the user agent, and a salted hash of the IP
(enough to tell repeat opens apart). Never the IP itself. No tracking pixels. When your search is
over, delete the database (`npx wrangler d1 delete cv-link`).

## Set up (about 10 minutes)

Needs Node 20+ and a free Cloudflare account.

```
git clone https://github.com/thisismairaj/cv-link && cd cv-link
npm install
npx wrangler login                    # opens a browser
npx wrangler d1 create cv-link        # copy the database_id into wrangler.jsonc
npm run db:remote                     # creates the tables
npx wrangler secret put RESUMES       # JSON: {"data":"<share link>","backend":"<share link>"}
npx wrangler secret put ADMIN_KEY     # a long random string, used by the CLI
npx wrangler secret put HASH_SALT     # another random string
npm run deploy                        # prints https://cv-link.<you>.workers.dev
```

## Use

```
export CV_LINK_URL=https://cv-link.<you>.workers.dev
export CV_LINK_ADMIN_KEY=<the ADMIN_KEY you set>

npm run cv -- add "Acme, Head of Data" data   # prints the link for that one email (data resume)
npm run cv -- sent <id>                    # right after sending
npm run cv -- stats
```

```
k3f9xq2mna  Acme, Head of Data [data cv]
    sent 2026-10-24T10:42:17Z; opened 1x by 1 visitor(s), first 2026-10-24T14:02:51Z, ..., 2 automatic
```

If a resume's share link changes, run `npx wrangler secret put RESUMES` again with the new
JSON; every existing link follows. A link created without a resume key goes to `default` if you
list one, else the first entry. An unknown key is refused when you create the link.

## API

All `/api/*` routes need `Authorization: Bearer <ADMIN_KEY>`.

- `GET /r/<id>`: logs the open, `302` to that link's resume. Unknown ids get a plain `404`.
- `POST /api/links` with `{"label": "...", "cv": "data"}` (`cv` optional): creates a link,
  returns `{id, label, cv, url}`.
- `POST /api/links/<id>/sent`: records the send time.
- `GET /api/stats`: one row per link.

## Development

```
npm test               # unit tests (node --test)
npm run typecheck      # generates worker types, then tsc
cp .dev.vars.example .dev.vars && npm run db:local && npm run dev
```

Tested locally with `wrangler dev` and a local D1 database: a browser open is counted, a
scanner user agent and an open right after "sent" are marked automatic, two links with
different resume keys redirect to their own resume, and unknown ids, unknown resume keys and
API calls without the key are refused. Not yet tested on a deployed Worker against real email
gateways.

## License

MIT
