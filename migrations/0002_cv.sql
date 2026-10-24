-- Which resume a link sends people to (a key in the RESUMES secret, e.g. "data" or "backend").
ALTER TABLE links ADD COLUMN cv TEXT;
