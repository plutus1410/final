#!/usr/bin/env python3
"""
PLUTUS - company-document preparation job (runs in GitHub Actions, free).

For one stock symbol it:
  1. finds the company's latest annual report and up to four recent earnings conference-call transcripts
       Annual report — US: SEC EDGAR; India: NSE/BSE; then the company website
       Call transcripts — NSE corporate announcements and the company investor-relations website
       data/report_sources.json can pin an annual report and/or transcript URLs (optional escape hatch)
  2. extracts the text (page numbers kept, financial tables kept as rows)
  3. splits every document into labelled chunks with document/source metadata
  4. writes data/reports/<SYMBOL>.json  (the website's voice bot searches this combined file)

If anything fails, a small {"status": "failed", "reason": ...} file is written instead, so the bot can tell the
visitor honestly instead of guessing.

Usage:
  python scripts/prepare_report.py --symbol AAPL [--force]
  python scripts/prepare_report.py --refresh          # nightly: look for newly published reports
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Comment, NavigableString

try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover - only needed for PDF reports
    fitz = None

OUT_DIR = Path(os.environ.get("REPORTS_DIR", "data/reports"))
SOURCES_FILE = Path(os.environ.get("REPORT_SOURCES_FILE", "data/report_sources.json"))


def configured_worker_url():
    """Use the workflow variable when present; otherwise reuse the site's public config.

    The browser already needs WORKER_URL in js/config.js.  GitHub Actions jobs created before the
    document assistant was added often do not also define a repository variable with the same value,
    which used to disable the company-site transcript finder for every US company and for the Indian
    fallback.  Keeping the environment variable first preserves an explicit deployment override.
    """
    value = (os.environ.get("WORKER_URL") or "").strip()
    if value:
        return value.rstrip("/")
    here = Path(__file__).resolve().parent
    candidates = (
        Path.cwd() / "js" / "config.js", Path.cwd() / "config.js",
        here / "config.js", here.parent / "js" / "config.js", here.parent / "config.js",
    )
    seen = set()
    for path in candidates:
        try:
            key = str(path.resolve())
            if key in seen:
                continue
            seen.add(key)
            text = path.read_text(encoding="utf-8")
            match = re.search(r"\bWORKER_URL\s*:\s*(['\"])(https?://[^'\"]+)\1", text)
            if match:
                return match.group(2).rstrip("/")
        except (OSError, UnicodeError):
            pass
    return ""


WORKER_URL = configured_worker_url()
SEC_UA = os.environ.get("SEC_USER_AGENT") or "PlutusReportPrep contact-not-set@example.com"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0 Safari/537.36")
SCHEMA = 3
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.&^-]{0,19}$")
ANNUAL_FORMS = ("10-K", "10-K405", "10-KT", "20-F", "40-F")
MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024
MAX_TOTAL_CHARS = 2_600_000          # annual-report budget; keeps the JSON quick to load in a browser
MAX_TRANSCRIPT_CHARS = 700_000         # shared by the newest conference-call transcripts
MAX_TRANSCRIPTS = max(1, min(8, int(os.environ.get("MAX_CONCALL_TRANSCRIPTS", "4"))))
MIN_TRANSCRIPT_CHARS = 800
CHUNK_TARGET = 1400
CHUNK_MAX = 1900
MIN_TEXT_CHARS = 20_000              # below this the file is almost certainly a scan (no OCR here)
REFRESH_OK_DAYS = 7
REFRESH_FAILED_DAYS = 3
REFRESH_MAX_PER_RUN = 10

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
     "november", "december"], 1)}


def log(*a):
    print("[plutus]", *a, flush=True)


def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_name(symbol):
    """Must match safeName() in js/voice.js."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", symbol)


def clean(s):
    s = (s or "").replace("\xa0", " ").replace("\u200b", "").replace("\u2009", " ")
    return re.sub(r"\s+", " ", s).strip()


# =============================================================================================== HTTP helpers
def http_get(url, *, headers=None, timeout=60, stream=False, session=None, tries=3):
    last = None
    for i in range(tries):
        try:
            r = (session or requests).get(url, headers=headers, timeout=timeout, stream=stream)
            if r.status_code in (429, 500, 502, 503, 504):
                last = RuntimeError(f"HTTP {r.status_code}")
                time.sleep(2 + i * 3)
                continue
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            last = e
            time.sleep(1.5 + i * 2)
    raise RuntimeError(f"GET {url[:90]} failed: {last}")


def sec_get(url, **kw):
    time.sleep(0.25)  # SEC fair-access: well under 10 requests / second
    return http_get(url, headers={"User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate"}, **kw)


def download(url, session=None, headers=None):
    h = {"User-Agent": BROWSER_UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    r = http_get(url, headers=h, stream=True, timeout=180, session=session)
    size = 0
    parts = []
    for part in r.iter_content(1 << 20):
        size += len(part)
        if size > MAX_DOWNLOAD_BYTES:
            raise RuntimeError("report file is larger than 150 MB")
        parts.append(part)
    return b"".join(parts), r.headers.get("Content-Type", "")


# =============================================================================================== finders
class Candidate(dict):
    """A report found by a finder: source, url, kind ('html'|'pdf'), form, filed, period_end, fy_end_year, source_id, company."""


def source_config(symbol):
    """Backward compatible: a string still pins only the annual report; an object can also list transcripts."""
    try:
        entry = json.loads(SOURCES_FILE.read_text(encoding="utf-8")).get(symbol)
    except Exception:
        return {}
    if isinstance(entry, str):
        return {"annual_report": entry, "transcripts": []}
    return entry if isinstance(entry, dict) else {}


def _kind(url):
    return "pdf" if urlparse(str(url)).path.lower().endswith(".pdf") else "html"


def find_override(symbol):
    cfg = source_config(symbol)
    raw = cfg.get("annual_report") or cfg.get("report") or cfg.get("url")
    if isinstance(raw, dict):
        url, extra = raw.get("url"), raw
    else:
        url, extra = raw, {}
    if not url:
        return None
    return Candidate(source="Pinned source (data/report_sources.json)", url=url, kind=_kind(url),
                     form=extra.get("form") or "Annual report", filed=extra.get("date") or extra.get("filed"),
                     period_end=extra.get("period_end"), fy_end_year=extra.get("fy_end_year"),
                     source_id=extra.get("source_id") or url, company=extra.get("company"))


def find_sec(symbol):
    base = symbol.upper()
    tickers = sec_get("https://www.sec.gov/files/company_tickers.json").json()
    want = {base, base.replace("-", "."), base.replace(".", "-")}
    hit = next((v for v in tickers.values() if str(v.get("ticker", "")).upper() in want), None)
    if not hit:
        raise RuntimeError("ticker not found in the SEC company list (is it a US-listed company?)")
    cik = str(hit["cik_str"]).zfill(10)
    subs = sec_get(f"https://data.sec.gov/submissions/CIK{cik}.json").json()
    rec = subs["filings"]["recent"]
    for i, form in enumerate(rec["form"]):
        if form in ANNUAL_FORMS:
            acc = rec["accessionNumber"][i]
            doc = rec["primaryDocument"][i]
            period = rec.get("reportDate", [None] * (i + 1))[i] or None
            url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/{doc}"
            return Candidate(source="SEC EDGAR", url=url, kind="html", form=form, filed=rec["filingDate"][i],
                             period_end=period, fy_end_year=int(period[:4]) if period else None, source_id=acc,
                             company=subs.get("name") or hit.get("title"))
    raise RuntimeError("no 10-K / 20-F filing in the company's recent SEC filings")


def _year_end(txt):
    """'2024-25' / '2025' / 'FY25' -> 2025"""
    txt = str(txt or "")
    m = re.search(r"(20\d{2})\s*[-–/]\s*(\d{2,4})", txt)
    if m:
        a, b = m.group(1), m.group(2)
        return int(b) if len(b) == 4 else int(a[:2] + b)
    m = re.search(r"(20\d{2})", txt)
    return int(m.group(1)) if m else None


def find_nse(symbol):
    base = symbol.rsplit(".", 1)[0]
    s = requests.Session()
    s.headers.update({"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9"})
    http_get("https://www.nseindia.com/", session=s, timeout=30)  # sets the cookies the API expects
    r = s.get("https://www.nseindia.com/api/annual-reports", params={"index": "equities", "symbol": base}, timeout=40,
              headers={"Referer": "https://www.nseindia.com/companies-listing/corporate-filings-annual-reports",
                       "Accept": "application/json, text/plain, */*"})
    r.raise_for_status()
    data = r.json().get("data") or []
    rows = []
    for d in data:
        f = str(d.get("fileName") or "")
        if f.lower().endswith(".pdf"):
            rows.append((_year_end(d.get("toYr")) or _year_end(d.get("fromYr")) or 0, d))
    if not rows:
        raise RuntimeError("NSE returned no annual-report PDFs for this symbol")
    year, d = max(rows, key=lambda x: x[0])
    return Candidate(source="NSE India", url=d["fileName"], kind="pdf", form="Annual report",
                     filed=str(d.get("broadcast_dttm") or d.get("submissionDate") or "")[:10] or None,
                     fy_end_year=year or None, source_id=d["fileName"], company=d.get("companyName"),
                     _session=s)


def find_bse(symbol):
    code = symbol.rsplit(".", 1)[0]
    if not code.isdigit():
        raise RuntimeError("BSE needs the numeric scrip code (e.g. 500325.BO)")
    r = requests.get("https://api.bseindia.com/BseIndiaAPI/api/AnnualReport_New/w", params={"scripcode": code},
                     headers={"User-Agent": BROWSER_UA, "Referer": "https://www.bseindia.com/",
                              "Origin": "https://www.bseindia.com"}, timeout=40)
    r.raise_for_status()
    j = r.json()
    rows = j.get("Table") if isinstance(j, dict) else j
    best = None
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        pdf = next((str(v) for v in row.values() if isinstance(v, str) and v.lower().endswith(".pdf")), None)
        if not pdf:
            continue
        year = _year_end(next((row[k] for k in row if "year" in k.lower()), "")) or _year_end(pdf) or 0
        if not best or year > best[0]:
            best = (year, pdf)
    if not best:
        raise RuntimeError("BSE returned no annual-report PDFs for this scrip code")
    url = best[1] if best[1].startswith("http") else "https://www.bseindia.com/bseplus/AnnualReport/" + code + "/" + best[1]
    return Candidate(source="BSE India", url=url, kind="pdf", form="Annual report", fy_end_year=best[0] or None,
                     source_id=url)


def yahoo_profile(symbol):
    """Website + name through the project's own Worker (Yahoo blocks direct calls)."""
    if not WORKER_URL:
        return {}
    from urllib.parse import quote
    u = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{quote(symbol)}?modules=assetProfile,price"
    try:
        j = http_get(f"{WORKER_URL}/?url={quote(u, safe='')}", timeout=40).json()
        res = j["quoteSummary"]["result"][0]
        return {"website": (res.get("assetProfile") or {}).get("website"),
                "name": (res.get("price") or {}).get("longName")}
    except Exception as e:
        log("yahoo profile unavailable:", e)
        return {}


def find_company_site(symbol):
    prof = yahoo_profile(symbol)
    site = prof.get("website")
    if not site:
        raise RuntimeError("company website unknown (set the WORKER_URL repository variable to enable this fallback)")
    host = urlparse(site).netloc.replace("www.", "")
    seen, queue, found = set(), [(site, 0)], []
    while queue and len(seen) < 14:
        url, depth = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            html = http_get(url, headers={"User-Agent": BROWSER_UA}, timeout=30).text
        except Exception:
            continue
        for a in BeautifulSoup(html, "lxml").find_all("a", href=True):
            href = urljoin(url, a["href"])
            text = clean(a.get_text(" "))
            blob = (text + " " + href).lower()
            if href.lower().split("?")[0].endswith(".pdf") and re.search(r"annual[\s_-]*report|integrated[\s_-]*report", blob):
                y = _year_end(blob) or 0
                if y >= dt.date.today().year - 2:
                    found.append((y, href))
            elif depth < 2 and host in urlparse(href).netloc and re.search(r"investor|annual|financial|report", blob):
                queue.append((href, depth + 1))
    if not found:
        raise RuntimeError("no annual-report PDF found on the company website")
    y, href = max(found, key=lambda x: x[0])
    return Candidate(source="Company website", url=href, kind="pdf", form="Annual report", fy_end_year=y or None,
                     source_id=href, company=prof.get("name"))


def finders_for(symbol):
    if symbol.endswith(".NS"):
        return [find_nse, find_company_site]
    if symbol.endswith(".BO"):
        return [find_bse, find_company_site] if symbol[:-3].isdigit() else [find_nse, find_company_site]
    if "." in symbol.replace("-", ""):
        return []  # other exchanges are not supported yet
    return [find_sec]


# =============================================================================================== conference-call transcript finders
TRANSCRIPT_RX = re.compile(r"\btranscript(?:ion|s)?\b|\bconcall\b", re.I)
CALL_RX = re.compile(
    r"con(?:ference)?[\s._-]*call|earnings?[\s_-]*call|results?[\s_-]*call|post[\s_-]*results?|"
    r"investor[\s_-]*(?:call|meet)|analyst[\s_-]*(?:call|meet)|earnings?[\s_-]*conference",
    re.I,
)
FOLLOW_RX = re.compile(
    r"investor|financial|result|earning|quarter|conference|analyst|transcript|concall|"
    r"shareholder|presentation|event",
    re.I,
)
NON_DOCUMENT_EXTENSIONS = {
    ".7z", ".avi", ".css", ".gif", ".gz", ".ico", ".jpeg", ".jpg", ".js", ".json", ".m4a",
    ".mov", ".mp3", ".mp4", ".mpeg", ".png", ".rar", ".svg", ".tar", ".webm", ".webp", ".wav", ".zip",
}


def _row_text(row):
    """Flatten an announcement row without depending on an exchange's changing field names."""
    if not isinstance(row, dict):
        return ""
    values = []
    for value in row.values():
        if isinstance(value, (str, int, float)) and not isinstance(value, bool):
            values.append(str(value)[:1000])
    return clean(" ".join(values))


def _is_transcript_label(text):
    text = clean(text)
    return bool(TRANSCRIPT_RX.search(text) and CALL_RX.search(text))


def _same_site(left, right):
    """True for a host and its subdomains; unlike substring tests, rejects evil-example.com."""
    a = re.sub(r"^www\.", "", (urlparse(left).hostname or "").lower())
    b = re.sub(r"^www\.", "", (urlparse(right).hostname or "").lower())
    return bool(a and b and (a == b or a.endswith("." + b) or b.endswith("." + a)))


def _looks_like_document_url(url):
    """Investor sites commonly serve HTML/PDF documents from extensionless download routes."""
    parsed = urlparse(str(url or ""))
    if parsed.scheme not in ("http", "https"):
        return False
    name = Path(parsed.path).name.lower()
    suffix = Path(name).suffix
    if suffix in NON_DOCUMENT_EXTENSIONS:
        return False
    return suffix in (".pdf", ".htm", ".html", ".txt") or not suffix or bool(
        re.search(r"download|attachment|document|file|transcript|concall", parsed.path + "?" + parsed.query, re.I)
    )


def _date_iso(value):
    text = clean(str(value or ""))
    if not text:
        return None
    m = re.search(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", text)
    if m:
        try:
            return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            pass
    for fmt in ("%d-%b-%Y", "%d %b %Y", "%d-%m-%Y", "%d/%m/%Y", "%b %d, %Y", "%B %d, %Y"):
        try:
            return dt.datetime.strptime(text[:20], fmt).date().isoformat()
        except ValueError:
            pass
    m = re.search(r"\b(\d{1,2})[- /]([A-Za-z]{3,9})[- ,/]+(20\d{2})\b", text)
    if m:
        try:
            return dt.datetime.strptime(" ".join(m.groups()), "%d %b %Y").date().isoformat()
        except ValueError:
            try:
                return dt.datetime.strptime(" ".join(m.groups()), "%d %B %Y").date().isoformat()
            except ValueError:
                pass
    return None


def call_period(text):
    text = clean(text)
    m = re.search(r"\bQ(?:uarter)?\s*([1-4])\s*(?:of\s*)?(?:FY|F[Yy]\s*)?'?(20\d{2}|\d{2})\b", text, re.I)
    if not m:
        m = re.search(r"\b(?:FY|F[Yy]\s*)?'?(20\d{2}|\d{2})\s*Q(?:uarter)?\s*([1-4])\b", text, re.I)
        if m:
            year, quarter = m.group(1), m.group(2)
        else:
            year = quarter = None
    else:
        quarter, year = m.group(1), m.group(2)
    if year and quarter:
        fy = int(year) if len(year) == 4 else 2000 + int(year)
        return f"Q{quarter} FY{fy}", fy
    words = {"first": 1, "second": 2, "third": 3, "fourth": 4}
    m = re.search(r"\b(first|second|third|fourth)\s+quarter\b[\s\S]{0,30}?\b(20\d{2})\b", text, re.I)
    if m:
        return f"Q{words[m.group(1).lower()]} FY{m.group(2)}", int(m.group(2))
    m = re.search(r"\b(?:quarter|three months|six months|nine months)\s+ended\s+([^.;|]{4,45}?20\d{2})\b", text, re.I)
    if m:
        return "period ended " + clean(m.group(1)), _year_end(m.group(1))
    return None, _year_end(text)


def _candidate_url(row, base_url=None):
    if not isinstance(row, dict):
        return None
    preferred = ("attchmntFile", "attachment", "attachmentFile", "attachmentUrl", "fileName", "pdfUrl", "url", "link")
    for key in preferred:
        val = row.get(key)
        if isinstance(val, str) and val.strip():
            url = urldefrag(urljoin(base_url or "", val.strip()))[0]
            if _looks_like_document_url(url):
                return url
    for key, val in row.items():
        if isinstance(val, str) and ("attach" in key.lower() or "file" in key.lower()):
            url = urldefrag(urljoin(base_url or "", val.strip()))[0]
            if _looks_like_document_url(url):
                return url
    return None


def find_pinned_transcripts(symbol):
    raw = source_config(symbol).get("transcripts") or source_config(symbol).get("conference_calls") or []
    if isinstance(raw, (str, dict)):
        raw = [raw]
    found = []
    for item in raw if isinstance(raw, list) else []:
        item = {"url": item} if isinstance(item, str) else item
        if not isinstance(item, dict) or not item.get("url"):
            continue
        url = item["url"]
        label, fy = call_period(" ".join(str(item.get(k) or "") for k in ("title", "period", "date")))
        found.append(Candidate(source="Pinned source (data/report_sources.json)", url=url, kind=_kind(url),
                               form="Conference call transcript", title=item.get("title") or label or "Earnings call transcript",
                               filed=_date_iso(item.get("date") or item.get("filed")), period_label=item.get("period") or label,
                               fy_end_year=item.get("fy_end_year") or fy, source_id=item.get("source_id") or url))
    return found


def find_nse_transcripts(symbol):
    base = symbol.rsplit(".", 1)[0]
    s = requests.Session()
    s.headers.update({"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9"})
    http_get("https://www.nseindia.com/", session=s, timeout=30)
    # NSE sometimes refuses long date ranges, so cover roughly six quarters in short windows.
    oldest, end = dt.date.today() - dt.timedelta(days=550), dt.date.today()
    rows = []
    while end >= oldest:
        start = max(oldest, end - dt.timedelta(days=119))
        params = {"index": "equities", "symbol": base, "from_date": start.strftime("%d-%m-%Y"),
                  "to_date": end.strftime("%d-%m-%Y")}
        try:
            r = s.get("https://www.nseindia.com/api/corporate-announcements", params=params, timeout=50,
                      headers={"Referer": "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
                               "Accept": "application/json, text/plain, */*"})
            r.raise_for_status()
            payload = r.json()
            rows.extend((payload.get("data") if isinstance(payload, dict) else payload) or [])
        except Exception:
            if not rows:
                raise
            break
        end = start - dt.timedelta(days=1)
        time.sleep(0.2)
    out = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        # NSE has moved the useful label between desc, subject, attchmntText and other fields over time.
        # Searching every scalar field avoids silently dropping a valid transcript after such a schema change.
        blob = _row_text(row)
        if not _is_transcript_label(blob):
            continue
        url = _candidate_url(row, "https://www.nseindia.com/")
        if not url:
            continue
        date = _date_iso(row.get("an_dt") or row.get("broadcast_dttm") or row.get("date") or row.get("submissionDate"))
        label, fy = call_period(blob + " " + (date or ""))
        out.append(Candidate(source="NSE India", url=url, kind=_kind(url), form="Conference call transcript",
                             title=clean(blob)[:120] or label or "Earnings call transcript", filed=date,
                             period_label=label, fy_end_year=fy, source_id=url, company=row.get("sm_name"), _session=s))
    out = list({item["source_id"]: item for item in out}.values())
    if not out:
        raise RuntimeError("NSE returned no recent conference-call transcript filings")
    return out


def find_sec_transcripts(symbol):
    """Find issuer-filed call transcripts attached to recent 8-K/6-K filings.

    Not every issuer files a transcript, but when it does this is a stable, first-party fallback that does not
    depend on the layout of an investor-relations site.
    """
    base = symbol.upper()
    tickers = sec_get("https://www.sec.gov/files/company_tickers.json").json()
    want = {base, base.replace("-", "."), base.replace(".", "-")}
    hit = next((v for v in tickers.values() if str(v.get("ticker", "")).upper() in want), None)
    if not hit:
        raise RuntimeError("ticker not found in the SEC company list")
    cik = str(hit["cik_str"]).zfill(10)
    rec = sec_get(f"https://data.sec.gov/submissions/CIK{cik}.json").json()["filings"]["recent"]
    found, checked = [], 0
    for i, form in enumerate(rec.get("form") or []):
        if form not in ("8-K", "8-K/A", "6-K", "6-K/A"):
            continue
        filed = (rec.get("filingDate") or [None] * len(rec["form"]))[i]
        try:
            if filed and (dt.date.today() - dt.date.fromisoformat(filed)).days > 550:
                continue
        except ValueError:
            pass
        accession = rec["accessionNumber"][i]
        root = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/"
        checked += 1
        try:
            soup = BeautifulSoup(sec_get(root + accession + "-index.html", timeout=45).text, "lxml")
        except Exception:
            if checked >= 40:
                break
            continue
        for a in soup.find_all("a", href=True):
            row = a.find_parent("tr")
            blob = clean(" ".join(filter(None, [a.get_text(" "), row.get_text(" ") if row else "", a["href"]])))
            href = urldefrag(urljoin(root, a["href"]))[0]
            if not _is_transcript_label(blob) or not _looks_like_document_url(href):
                continue
            label, fy = call_period(blob + " " + (filed or ""))
            found.append(Candidate(source="SEC EDGAR", url=href, kind=_kind(href), form="Conference call transcript",
                                   title=clean(a.get_text(" "))[:120] or label or "Earnings call transcript",
                                   filed=filed, period_label=label, fy_end_year=fy,
                                   source_id=accession + ":" + href, company=hit.get("title")))
        if checked >= 40 or len(found) >= MAX_TRANSCRIPTS * 4:
            break
    if not found:
        raise RuntimeError("SEC returned no issuer-filed conference-call transcripts in recent 8-K/6-K filings")
    return found


def find_company_transcripts(symbol):
    prof = yahoo_profile(symbol)
    site = prof.get("website")
    if not site:
        raise RuntimeError("company website unknown (set WORKER_URL to enable the transcript fallback)")
    seen, queue, found = set(), [(site, 0)], []
    for _ in range(60):
        if not queue:
            break
        url, depth = queue.pop(0)
        url = urldefrag(url)[0]
        if url in seen:
            continue
        seen.add(url)
        try:
            html = http_get(url, headers={"User-Agent": BROWSER_UA}, timeout=30).text
        except Exception:
            continue
        for a in BeautifulSoup(html, "lxml").find_all("a", href=True):
            href = urldefrag(urljoin(url, a["href"]))[0]
            if urlparse(href).scheme not in ("http", "https"):
                continue
            text = clean(a.get_text(" "))
            blob = clean(" ".join(filter(None, [text, a.get("title"), a.get("aria-label"), href])))
            # A transcript explicitly linked by the company's own site is trustworthy even when the PDF lives on a CDN.
            if _looks_like_document_url(href) and _is_transcript_label(blob) and not re.search(r"\b(invitation|audio|webcast|schedule)\b", blob, re.I):
                label, fy = call_period(blob)
                found.append(Candidate(source="Company website", url=href, kind=_kind(href), form="Conference call transcript",
                                       title=text[:120] or label or "Earnings call transcript", filed=_date_iso(blob),
                                       period_label=label, fy_end_year=fy, source_id=href, company=prof.get("name")))
            elif depth < 3 and _same_site(site, href) and FOLLOW_RX.search(blob) and href not in seen:
                queue.append((href, depth + 1))
    if not found:
        raise RuntimeError("no recent conference-call transcript found on the company website")
    return found


def transcript_candidates(symbol):
    found, tried = find_pinned_transcripts(symbol), []
    funcs = []
    if symbol.endswith(".NS") or (symbol.endswith(".BO") and not symbol[:-3].isdigit()):
        funcs.append(find_nse_transcripts)
    elif "." not in symbol.replace("-", ""):
        funcs.append(find_sec_transcripts)
    funcs.append(find_company_transcripts)
    for fn in funcs:
        try:
            found.extend(fn(symbol))
        except Exception as e:
            tried.append(f"{fn.__name__.replace('find_', '')}: {str(e)[:160]}")
            log("transcript finder", fn.__name__, "failed:", e)
    dedup = {}
    for c in found:
        dedup.setdefault(c.get("source_id") or c.get("url"), c)
    rows = list(dedup.values())
    rows.sort(key=lambda c: (c.get("filed") or "", c.get("fy_end_year") or 0, c.get("period_label") or ""), reverse=True)
    # Discovery metadata is imperfect. Keep spare candidates so one invitation, empty scan or blocked link
    # cannot prevent a later valid transcript from being tried. prepare() still stores at most MAX_TRANSCRIPTS.
    return rows[:MAX_TRANSCRIPTS * 4], tried


# =============================================================================================== headings
def _h(label, tag, pat):
    return (re.compile(pat, re.I), label, tag)


HEADINGS = [
    _h("Cash Flow Statement", "cashflow", r"^(?:the\s+)?(?:consolidated\s+|standalone\s+|condensed\s+)*(?:statements?\s+of\s+cash\s+flows?|cash\s+flow\s+statements?)\b"),
    _h("Balance Sheet", "balance", r"^(?:the\s+)?(?:consolidated\s+|standalone\s+|condensed\s+)*(?:balance\s+sheets?|statements?\s+of\s+financial\s+position)\b"),
    _h("Income Statement", "income", r"^(?:the\s+)?(?:consolidated\s+|standalone\s+|condensed\s+)*statements?\s+of\s+(?:profit\s+and\s+loss|profit\s+or\s+loss|operations|income|comprehensive\s+income|earnings)\b"),
    _h("Notes to Financial Statements", "notes", r"^notes?\s+(?:to|forming\s+part\s+of)\s+(?:the\s+)?(?:consolidated\s+|standalone\s+)*(?:financial\s+statements|accounts)"),
    _h("Management Discussion & Analysis", "mdna", r"management(?:['’]?s)?\s+discussion\s+(?:and|&)\s+analysis|^item\s*7\b(?!\s*a)|operating\s+and\s+financial\s+review"),
    _h("Risk Factors", "risk", r"^item\s*1a\b|^risk\s+factors\b|^(?:key\s+)?risks?\s+and\s+(?:concerns|uncertainties|mitigation)"),
    _h("Business", "business", r"^item\s*1\b\.?\s*[-—–:.]?\s*business|^business\s+overview"),
    _h("Directors' Report", "directors", r"^(?:board(?:['’]?s)?|directors?(?:['’]s?)?)\s+report"),
    _h("Corporate Governance", "governance", r"^(?:report\s+on\s+)?corporate\s+governance"),
    _h("Auditor's Report", "auditor", r"^independent\s+auditor|^report\s+of\s+independent"),
    _h("Sustainability / BRSR", "esg", r"^business\s+responsibility|^sustainability\s+report|^brsr\b"),
    _h("AGM Notice", "notice", r"^notice\b.*annual\s+general\s+meeting"),
    _h("Other sections", "other", r"^item\s*\d+[abc]?\b"),   # any other 10-K / 20-F item: ends the previous section
]
HEADINGS_20F = [_h("Management Discussion & Analysis", "mdna", r"^item\s*5\b")] + HEADINGS


def detect_heading(text, form=None):
    t = clean(text)
    if not t or len(t) > 110 or len(t) < 6:
        return None
    t = re.sub(r"^[\W_]+", "", t)
    for rx, label, tag in (HEADINGS_20F if form == "20-F" else HEADINGS):
        if rx.search(t):
            if tag in ("cashflow", "balance", "income"):
                low = t.lower()
                scope = "Consolidated" if "consolidated" in low else ("Standalone" if "standalone" in low else "")
                return (f"{label} ({scope})" if scope else label, tag)
            return (label, tag)
    return None


# =============================================================================================== HTML -> blocks
BLOCK_TAGS = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "ul", "ol", "center",
              "blockquote", "dl", "dd", "dt", "body", "html", "header", "footer", "main"}
SKIP_TAGS = {"script", "style", "head", "ix:header", "noscript", "svg"}
CURRENCY_ONLY = {"$", "€", "£", "₹", "(", "US$"}
SUFFIX_ONLY = {")", "%", ")%", "%)"}


def _pb_before(style):
    return "page-break-before:always" in style or "break-before:page" in style


def _pb_after(style):
    return "page-break-after:always" in style or "break-after:page" in style


def _table_rows(tbl):
    rows = []
    for tr in tbl.find_all("tr"):
        cells = []
        for td in tr.find_all(["td", "th"]):
            t = clean(td.get_text(" "))
            if not t or t in CURRENCY_ONLY:
                continue
            if t in SUFFIX_ONLY and cells:
                cells[-1] += t
                continue
            cells.append(t)
        if cells:
            rows.append(" | ".join(cells))
    return rows


def html_to_blocks(html):
    """-> (blocks [(text, page|None)], page_breaks_found)"""
    soup = BeautifulSoup(html, "lxml")
    out, st = [], {"buf": [], "page": 1, "pb": 0}

    def flush():
        t = clean(" ".join(st["buf"]))
        st["buf"] = []
        if t:
            out.append((t, st["page"]))

    def walk(el):
        for ch in el.children:
            if isinstance(ch, Comment):
                continue
            if isinstance(ch, NavigableString):
                t = clean(str(ch))
                if t:
                    st["buf"].append(t)
                continue
            name = (ch.name or "").lower()
            style = (ch.get("style") or "").lower().replace(" ", "")
            if name in SKIP_TAGS or "display:none" in style:
                continue
            if _pb_before(style):
                flush(); st["page"] += 1; st["pb"] += 1
            if name == "table":
                flush()
                for row in _table_rows(ch):
                    out.append((row, st["page"]))
            elif name == "br":
                flush()
            elif name in BLOCK_TAGS:
                flush(); walk(ch); flush()
            else:
                walk(ch)
            if _pb_after(style):
                flush(); st["page"] += 1; st["pb"] += 1

    walk(soup.body or soup)
    flush()
    return out, st["pb"]


# =============================================================================================== PDF -> blocks
def pdf_to_blocks(data):
    if fitz is None:
        raise RuntimeError("PyMuPDF is not installed")
    doc = fitz.open(stream=data, filetype="pdf")
    blocks, total_chars = [], 0
    fin_rx = re.compile(r"cash\s+flows?|balance\s+sheet|profit\s+and\s+loss|statements?\s+of|financial\s+position|operating\s+activities", re.I)
    for pno, page in enumerate(doc, 1):
        items = []
        raw_blocks = page.get_text("blocks", sort=True)
        page_text = " ".join(b[4] for b in raw_blocks if len(b) > 4)
        total_chars += len(page_text)
        table_rects = []
        if fin_rx.search(page_text) and len(re.findall(r"\d[\d,]{2,}", page_text)) > 12:
            try:
                for t in page.find_tables().tables:
                    rows = [[clean(c) for c in r if c and clean(c)] for r in t.extract()]
                    rows = [r for r in rows if r]
                    if len(rows) >= 3 and max(len(r) for r in rows) >= 2:
                        table_rects.append(fitz.Rect(t.bbox))
                        for i, r in enumerate(rows):
                            items.append((t.bbox[1] + i * 0.001, " | ".join(r)))
            except Exception:
                table_rects = []
        for b in raw_blocks:
            if len(b) < 5 or (len(b) > 6 and b[6] != 0):
                continue
            rect = fitz.Rect(b[:4])
            if any((rect & tr).get_area() > 0.5 * max(rect.get_area(), 1) for tr in table_rects):
                continue
            t = clean(b[4])
            if t and not re.fullmatch(r"\d{1,3}", t):
                items.append((b[1], t))
        items.sort(key=lambda x: x[0])
        blocks.extend((t, pno) for _, t in items)
    n_pages = len(doc)
    doc.close()
    return blocks, n_pages, total_chars


# =============================================================================================== chunking
def _split_long(text, limit=CHUNK_MAX):
    if len(text) <= limit:
        return [text]
    parts, cur = [], ""
    for s in re.split(r"(?<=[.;:!?])\s+", text):
        if len(cur) + len(s) + 1 > limit and cur:
            parts.append(cur)
            cur = ""
        while len(s) > limit:
            parts.append(s[:limit]); s = s[limit:]
        cur = (cur + " " + s).strip()
    if cur:
        parts.append(cur)
    return parts


def build_chunks(blocks, form=None, use_pages=True):
    section, chunks = ("Front matter", "other"), []
    cur, cur_len, cur_page = [], 0, None

    def flush(carry=True):
        nonlocal cur, cur_len, cur_page
        if not cur:
            return
        text = "\n".join(cur).strip()
        if len(text) >= 80:
            chunks.append({"id": f"c{len(chunks) + 1}", "section": section[0], "tag": section[1],
                           "page": cur_page if use_pages else None, "text": text})
        tail = cur[-1] if (carry and cur and len(cur[-1]) < 300 and len(cur) > 1) else None
        cur, cur_len = ([tail], len(tail)) if tail else ([], 0)
        cur_page = None

    for text, page in blocks:
        h = detect_heading(text, form)
        if h and h != section:
            flush(carry=False)
            section = h
        for piece in _split_long(text):
            if cur_len + len(piece) > CHUNK_TARGET and cur:
                flush()
            if cur_page is None:
                cur_page = page
            cur.append(piece)
            cur_len += len(piece) + 1
    flush(carry=False)
    return chunks



def build_transcript_chunks(blocks, use_pages=True, prefix="t", title="Conference call"):
    section, tag = title, "call"
    chunks, cur, cur_len, cur_page = [], [], 0, None

    def flush(carry=True):
        nonlocal cur, cur_len, cur_page
        if not cur:
            return
        text = "\n".join(cur).strip()
        if len(text) >= 80:
            chunks.append({"id": f"{prefix}c{len(chunks) + 1}", "section": section, "tag": tag,
                           "page": cur_page if use_pages else None, "text": text})
        tail = cur[-1] if carry and len(cur) > 1 and len(cur[-1]) < 260 else None
        cur, cur_len, cur_page = ([tail], len(tail), None) if tail else ([], 0, None)

    for text, page in blocks:
        t = clean(text)
        low = t.lower()
        new_section = None
        if len(t) <= 120 and re.search(r"question(?:s)?\s*(?:and|&)\s*answer|q\s*&\s*a|question-and-answer", low):
            new_section, new_tag = f"{title} · Questions and answers", "call_qa"
        elif len(t) <= 120 and re.search(r"prepared remarks|opening remarks|management commentary", low):
            new_section, new_tag = f"{title} · Prepared remarks", "call_prepared"
        elif len(t) <= 100 and (re.fullmatch(r"operator[:\s]*", low)
                                or re.match(r"^[A-Z][A-Za-z .'-]{2,55}\s*[-–—|:]\s*[A-Za-z][A-Za-z &/.-]{2,60}:?\s*$", t)
                                or re.fullmatch(r"(?:[A-Z][A-Za-z.'-]*\s+){1,7}[A-Z][A-Za-z.'-]*:?", t)):
            speaker = t.rstrip(": ")
            new_section, new_tag = f"{title} · {speaker}", tag
        if new_section:
            flush(carry=False)
            section, tag = new_section[:180], new_tag
        for piece in _split_long(t):
            if cur_len + len(piece) > CHUNK_TARGET and cur:
                flush()
            if cur_page is None:
                cur_page = page
            cur.append(piece)
            cur_len += len(piece) + 1
    flush(carry=False)
    return chunks


def bundle_id(report, transcripts):
    ids = [str(report.get("source_id") or report.get("url") or "")]
    ids.extend(str(c.get("source_id") or c.get("url") or "") for c in transcripts)
    return hashlib.sha256("\n".join(ids).encode("utf-8")).hexdigest()[:20]


def trim_to_budget(chunks):
    total = sum(len(c["text"]) for c in chunks)
    for drop in ("notice", "esg", "governance", "auditor", "other"):
        if total <= MAX_TOTAL_CHARS:
            break
        kept = [c for c in chunks if c["tag"] != drop]
        total = sum(len(c["text"]) for c in kept)
        chunks = kept
    if total > MAX_TOTAL_CHARS:  # still too large: keep the most useful tags first
        priority = ["cashflow", "mdna", "income", "balance", "risk", "business", "directors", "notes", "other"]
        chunks = sorted(chunks, key=lambda c: priority.index(c["tag"]) if c["tag"] in priority else 99)
        kept, size = [], 0
        for c in chunks:
            if size + len(c["text"]) > MAX_TOTAL_CHARS:
                continue
            kept.append(c); size += len(c["text"])
        chunks = sorted(kept, key=lambda c: int(c["id"][1:]))
    return chunks


# =============================================================================================== period detection
def detect_period(text):
    """Find 'year ended 31 March 2025' style statements near the start of the report -> (iso date | None, end year | None)."""
    mon = "|".join(MONTHS)
    pats = [
        rf"(?:financial\s+year|fiscal\s+year|year|period)\s+ended\s+(?:on\s+)?(?:the\s+)?(\d{{1,2}})(?:st|nd|rd|th)?\s+({mon}),?\s+(\d{{4}})",
        rf"(?:financial\s+year|fiscal\s+year|year|period)\s+ended\s+(?:on\s+)?({mon})\s+(\d{{1,2}}),?\s+(\d{{4}})",
    ]
    found = []
    for i, p in enumerate(pats):
        for m in re.finditer(p, text, re.I):
            try:
                if i == 0:
                    d, mo, y = int(m.group(1)), MONTHS[m.group(2).lower()], int(m.group(3))
                else:
                    mo, d, y = MONTHS[m.group(1).lower()], int(m.group(2)), int(m.group(3))
                found.append(dt.date(y, mo, d))
            except (ValueError, KeyError):
                pass
    cutoff = dt.date.today() + dt.timedelta(days=200)
    found = [d for d in found if d <= cutoff and d.year >= 2000]
    if found:
        # the most frequently stated date wins; ties -> latest
        best = max(set(found), key=lambda d: (found.count(d), d))
        return best.isoformat(), best.year
    m = re.search(r"annual\s+report\s+(20\d{2})\s*[-–]\s*(\d{2,4})", text, re.I)
    if m:
        return None, _year_end(m.group(0))
    return None, None


def period_label(iso):
    if not iso:
        return None
    d = dt.date.fromisoformat(iso)
    return f"year ended {d.day} {d.strftime('%B %Y')}"


# =============================================================================================== orchestration
def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def read_existing(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def fail(symbol, reason, tried):
    log("FAILED:", reason)
    write_json(OUT_DIR / f"{safe_name(symbol)}.json",
               {"status": "failed", "schema": SCHEMA, "symbol": symbol, "reason": reason, "tried": tried,
                "prepared_at": now_iso()})
    return False


def prepare(symbol, force=False):
    symbol = symbol.strip().upper()
    if not SYMBOL_RE.match(symbol):
        raise SystemExit(f"bad symbol: {symbol!r}")
    path = OUT_DIR / f"{safe_name(symbol)}.json"
    existing = read_existing(path)
    log("symbol", symbol)

    finders = finders_for(symbol)
    pinned = find_override(symbol)
    if not finders and not pinned:
        return fail(symbol, "Only US (SEC EDGAR) and Indian (NSE/BSE) companies are supported right now.", [])

    cand, tried = None, []
    if pinned:
        cand = pinned
    else:
        for f in finders:
            try:
                cand = f(symbol)
                log("found annual report via", f.__name__, "->", cand.get("url"))
                break
            except Exception as e:
                tried.append(f"{f.__name__.replace('find_', '')}: {str(e)[:160]}")
                log("finder", f.__name__, "failed:", e)
    if not cand:
        return fail(symbol, "I couldn't find the company's latest annual report automatically.", tried)

    calls, call_tried = transcript_candidates(symbol)
    bid = bundle_id(cand, calls)
    existing_call_ids = {x.get("source_id") for x in (existing or {}).get("transcripts", []) if x.get("source_id")}
    candidate_call_ids = {x.get("source_id") for x in calls if x.get("source_id")}
    calls_match = existing_call_ids == candidate_call_ids and (bool(calls) or not call_tried)
    if (not force and existing and existing.get("status") == "ready" and existing.get("schema") == SCHEMA
            and existing.get("bundle_id") == bid and calls_match):
        existing["checked_at"] = now_iso()
        if call_tried:
            existing.setdefault("quality", {})["transcript_lookup_notes"] = call_tried
        write_json(path, existing)
        log("document bundle already up to date")
        return True

    session = cand.pop("_session", None)
    try:
        data, ctype = download(cand["url"], session=session,
                               headers={"User-Agent": SEC_UA} if cand["source"] == "SEC EDGAR" else None)
    except Exception as e:
        return fail(symbol, "The annual report was found but could not be downloaded.", tried + [str(e)[:200]])

    is_pdf = data[:5] == b"%PDF-"
    try:
        if is_pdf:
            blocks, n_pages, total_chars = pdf_to_blocks(data)
            use_pages, page_kind = True, "pdf"
        else:
            html = data.decode("utf-8", errors="replace")
            blocks, pb = html_to_blocks(html)
            n_pages, total_chars = max(pb, 1), sum(len(t) for t, _ in blocks)
            use_pages, page_kind = pb >= 5, "html_est"
    except Exception as e:
        return fail(symbol, "The annual report could not be read.", tried + [str(e)[:200]])

    if total_chars < MIN_TEXT_CHARS:
        return fail(symbol, "The annual report has almost no selectable text (it may be a scanned document).", tried)

    head_text = " ".join(t for t, p in blocks[:400])
    period_iso, fy_end = detect_period(head_text)
    period_iso = cand.get("period_end") or period_iso
    fy_end = cand.get("fy_end_year") or fy_end or (int(period_iso[:4]) if period_iso else None)
    annual_title = f"{cand.get('form') or 'Annual report'}{(' · ' + period_label(period_iso)) if period_label(period_iso) else ((' · FY' + str(fy_end)) if fy_end else '')}"

    chunks = trim_to_budget(build_chunks(blocks, cand.get("form"), use_pages))
    if len(chunks) < 20:
        return fail(symbol, "Too little readable text was found in the annual report.", tried)
    for c in chunks:
        c.update({"doc_type": "annual_report", "document": annual_title, "document_date": cand.get("filed") or period_iso,
                  "document_rank": 0, "page_kind": page_kind if use_pages else "none"})
    tags = {c["tag"] for c in chunks}
    cash_text = any(re.search(r"operating\s+activities", c["text"], re.I) and re.search(r"cash\s+flows?", c["text"], re.I)
                    for c in chunks)
    warnings = []
    if "mdna" not in tags:
        warnings.append("Management Discussion section not detected")
    if "cashflow" not in tags and not cash_text:
        warnings.append("Cash-flow statement not detected")

    transcript_meta, transcript_chunks, transcript_chars = [], [], 0
    for call in calls:
        if len(transcript_meta) >= MAX_TRANSCRIPTS:
            break
        call_session = call.pop("_session", None)
        try:
            raw, _ = download(call["url"], session=call_session)
            call_pdf = raw[:5] == b"%PDF-"
            if call_pdf:
                cblocks, cpages, cchars = pdf_to_blocks(raw)
                cuse_pages, cpage_kind = True, "pdf"
            else:
                cblocks, cpb = html_to_blocks(raw.decode("utf-8", errors="replace"))
                cpages, cchars = max(cpb, 1), sum(len(t) for t, _ in cblocks)
                cuse_pages, cpage_kind = cpb >= 2, "html_est"
            if cchars < MIN_TRANSCRIPT_CHARS:
                raise RuntimeError("almost no selectable transcript text")
            head = " ".join(t for t, _ in cblocks[:100])
            label, fy = call_period(" ".join(filter(None, [call.get("title"), call.get("period_label"), head[:5000]])))
            call["period_label"] = call.get("period_label") or label
            call["fy_end_year"] = call.get("fy_end_year") or fy
            title = call.get("title") or call.get("period_label") or "Earnings call transcript"
            title = clean(title)[:140]
            if call.get("period_label") and call.get("period_label").lower() not in title.lower():
                title = f"{title} · {call['period_label']}"
            rank = len(transcript_meta) + 1
            cc = build_transcript_chunks(cblocks, cuse_pages, f"t{rank}", title)
            if not cc:
                raise RuntimeError("no usable transcript chunks")
            remaining = MAX_TRANSCRIPT_CHARS - transcript_chars
            kept = []
            for c in cc:
                if len(c["text"]) > remaining:
                    break
                c.update({"doc_type": "conference_call", "document": title, "document_date": call.get("filed"),
                          "document_rank": rank, "page_kind": cpage_kind if cuse_pages else "none"})
                kept.append(c)
                remaining -= len(c["text"])
            if not kept:
                break
            transcript_chars += sum(len(c["text"]) for c in kept)
            transcript_chunks.extend(kept)
            transcript_meta.append({"source": call.get("source"), "form": "Conference call transcript", "title": title,
                                    "url": call.get("url"), "filed": call.get("filed"), "period_label": call.get("period_label"),
                                    "fy_end_year": call.get("fy_end_year"), "source_id": call.get("source_id"),
                                    "page_kind": cpage_kind if cuse_pages else "none", "chunks": len(kept), "pages": cpages})
        except Exception as e:
            call_tried.append(f"{call.get('source') or 'transcript'}: {str(e)[:160]}")
            log("transcript skipped:", e)
    if not transcript_meta:
        warnings.append("No conference-call transcript was found automatically")

    company = cand.get("company") or (yahoo_profile(symbol).get("name") if WORKER_URL else None) or symbol
    out = {
        "status": "ready", "schema": SCHEMA, "symbol": symbol, "company": company, "bundle_id": bid,
        "report": {"source": cand["source"], "form": cand.get("form"), "url": cand["url"], "filed": cand.get("filed"),
                   "period_end": period_iso, "fy_end_year": fy_end, "period_label": period_label(period_iso),
                   "source_id": cand.get("source_id"), "page_kind": page_kind if use_pages else "none"},
        "transcripts": transcript_meta,
        "quality": {"chunks": len(chunks) + len(transcript_chunks), "annual_report_chunks": len(chunks),
                    "transcript_chunks": len(transcript_chunks), "transcripts": len(transcript_meta), "pages": n_pages,
                    "has_cashflow": "cashflow" in tags or cash_text, "has_mdna": "mdna" in tags,
                    "warnings": warnings, "transcript_lookup_notes": call_tried},
        "prepared_at": now_iso(), "checked_at": now_iso(), "chunks": chunks + transcript_chunks,
    }
    write_json(path, out)
    log(f"OK: {len(chunks)} annual-report chunks + {len(transcript_chunks)} transcript chunks from {len(transcript_meta)} call(s), "
        f"{path.stat().st_size // 1024} KB, warnings={warnings}")
    return True

def refresh():
    today = dt.datetime.now(dt.timezone.utc)
    due = []
    for p in sorted(OUT_DIR.glob("*.json")):
        j = read_existing(p)
        if not j or "symbol" not in j:
            continue
        stamp = j.get("checked_at") or j.get("prepared_at")
        try:
            age = (today - dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))).days
        except Exception:
            age = 999
        limit = REFRESH_OK_DAYS if j.get("status") == "ready" else REFRESH_FAILED_DAYS
        if age >= limit:
            due.append((age, j["symbol"]))
    due.sort(reverse=True)
    log(f"{len(due)} company document bundle(s) due for a check")
    for _, sym in due[:REFRESH_MAX_PER_RUN]:
        try:
            prepare(sym)
        except SystemExit as e:
            log("skip", sym, e)
        except Exception as e:  # never let one company stop the others
            log("error for", sym, e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    if a.refresh:
        refresh()
    elif a.symbol:
        prepare(a.symbol, a.force)
    else:
        ap.error("give --symbol SYMBOL or --refresh")


if __name__ == "__main__":
    main()
