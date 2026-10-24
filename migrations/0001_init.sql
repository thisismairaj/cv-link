-- One row per tracked link (one link per person you send your resume to).
CREATE TABLE links (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,          -- who it is for, e.g. "Trackerbot, CTO"
  created_at TEXT NOT NULL,          -- ISO 8601, UTC
  sent_at    TEXT                    -- set when you send the email; used to spot instant scanner clicks
);

-- One row per open. Automatic-looking opens are kept and marked, never dropped.
CREATE TABLE clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id    TEXT NOT NULL REFERENCES links(id),
  at         TEXT NOT NULL,          -- ISO 8601, UTC
  country    TEXT,                   -- from Cloudflare, two letters
  user_agent TEXT,
  visitor    TEXT,                   -- salted hash of the IP, never the IP itself
  bot_reason TEXT                    -- NULL = looks like a person
);

CREATE INDEX clicks_by_link ON clicks (link_id, at);
