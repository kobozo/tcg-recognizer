"""Dataset downloader — pull *every* official card image to a local cache.

Pages through the entire Pokémon TCG API, downloads each card's image to a
local directory, and writes a `manifest.jsonl` (one card per line: metadata +
the relative path to its cached image). The cache lives outside the repo
(git-ignored `ml/datasets`, mounted into the trainer at $DATASET_DIR) so the
full dataset is downloaded once and reused for every training run — offline,
reproducibly, and without re-hitting the API.

Resumable: an image that already exists on disk (non-empty) is skipped, so an
interrupted run continues where it left off. Concurrent image fetches keep the
wall-clock reasonable for ~20k cards. All failures are tolerated per-card; the
run reports how many succeeded / were skipped / failed.
"""
from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

API_URL = "https://api.pokemontcg.io/v2/cards"
PAGE_SIZE = 250  # API maximum
SELECT = "id,name,set,number,rarity,types,images"

_SAFE = re.compile(r"[^A-Za-z0-9_.-]")


def _safe_name(card_id: str) -> str:
    return _SAFE.sub("_", card_id)


def _session(api_key: str | None) -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry, pool_maxsize=32))
    if api_key:
        s.headers["X-Api-Key"] = api_key
    return s


def _get_page(s: requests.Session, page: int, page_size: int) -> dict:
    """Fetch one catalogue page with extra per-page retries.

    The API intermittently returns 404/5xx for a valid page under load (not
    covered by the session's status-forcelist for 404). Retry a few times with
    a short backoff before giving up on the page."""
    last_exc: Exception | None = None
    for attempt in range(1, 5):
        try:
            r = s.get(
                API_URL,
                params={"page": page, "pageSize": page_size, "select": SELECT},
                timeout=30,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001 - transient page errors are retried
            last_exc = e
            print(f"[download] page {page} attempt {attempt} failed: {e}")
            time.sleep(1.5 * attempt)
    raise last_exc  # type: ignore[misc]


def fetch_all_metadata(
    game: str,
    api_key: str | None,
    page_size: int = PAGE_SIZE,
    limit: int | None = None,
    cache_path: str | None = None,
) -> list[dict]:
    """Page through the catalogue, returning normalized card dicts.

    Stops early once `limit` cards have been collected (keeps capped/smoke runs
    from paging the entire 20k catalogue). A page that keeps failing after
    retries is logged and ends pagination rather than crashing the whole run,
    so the images already gathered still get a manifest. When `cache_path` is
    given, the collected metadata is written there for reuse."""
    if game != "pokemon":
        raise ValueError(f"download only supports game=pokemon (got {game!r})")

    s = _session(api_key)
    cards: list[dict] = []
    page = 1
    total = None
    while True:
        try:
            body = _get_page(s, page, page_size)
        except Exception as e:  # noqa: BLE001 - give up on this page, keep the rest
            print(f"[download] page {page} permanently failed ({e}); stopping pagination")
            break
        if total is None:
            total = body.get("totalCount")
            print(f"[download] catalogue totalCount={total}")
        data = body.get("data", [])
        if not data:
            break
        for c in data:
            images = c.get("images") or {}
            types = c.get("types") or []
            cards.append(
                {
                    "card_id": c.get("id", ""),
                    "name": c.get("name", ""),
                    "set_name": (c.get("set") or {}).get("name", ""),
                    "number": c.get("number", ""),
                    "rarity": c.get("rarity", ""),
                    "type": types[0] if types else "",
                    "image_small": images.get("small", ""),
                    "image_large": images.get("large", ""),
                }
            )
        print(f"[download] page {page}: +{len(data)} (running {len(cards)})")
        if limit is not None and len(cards) >= limit:
            cards = cards[:limit]
            break
        if total is not None and len(cards) >= total:
            break
        page += 1

    if cache_path:
        tmp = cache_path + ".part"
        with open(tmp, "w") as f:
            for c in cards:
                f.write(json.dumps(c) + "\n")
        os.replace(tmp, cache_path)
        print(f"[download] cached {len(cards)} card metadata rows -> {cache_path}")
    return cards


def _load_meta_cache(cache_path: str) -> list[dict]:
    cards: list[dict] = []
    with open(cache_path) as f:
        for line in f:
            line = line.strip()
            if line:
                cards.append(json.loads(line))
    return cards


def _download_one(
    s: requests.Session, url: str, dest: str
) -> str:
    """Download a single image to dest. Returns 'ok' | 'skip' | 'fail'."""
    if not url:
        return "fail"
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return "skip"
    try:
        r = s.get(url, timeout=30)
        if not r.ok or not r.content:
            return "fail"
        tmp = dest + ".part"
        with open(tmp, "wb") as f:
            f.write(r.content)
        os.replace(tmp, dest)
        return "ok"
    except Exception:
        try:
            if os.path.exists(dest + ".part"):
                os.remove(dest + ".part")
        except Exception:
            pass
        return "fail"


def download_images(
    cards: list[dict],
    images_dir: str,
    image_size: str = "small",
    workers: int = 16,
    api_key: str | None = None,
) -> dict:
    """Download all card images concurrently. Returns counts + per-card paths."""
    os.makedirs(images_dir, exist_ok=True)
    s = _session(api_key)
    key = "image_large" if image_size == "large" else "image_small"

    jobs: list[tuple[dict, str, str]] = []
    for c in cards:
        url = c.get(key) or c.get("image_small") or c.get("image_large") or ""
        fname = f"{_safe_name(c['card_id'])}.png"
        dest = os.path.join(images_dir, fname)
        c["_fname"] = fname
        jobs.append((c, url, dest))

    counts = {"ok": 0, "skip": 0, "fail": 0}
    done = 0
    total = len(jobs)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_download_one, s, url, dest): c for c, url, dest in jobs}
        for fut in as_completed(futs):
            res = fut.result()
            counts[res] += 1
            done += 1
            if done % 500 == 0 or done == total:
                print(
                    f"[download] images {done}/{total} "
                    f"ok={counts['ok']} skip={counts['skip']} fail={counts['fail']}"
                )
    return counts


def write_manifest(cards: list[dict], manifest_path: str, game: str, rel_prefix: str) -> int:
    """Write one JSON line per successfully-cached card."""
    written = 0
    tmp = manifest_path + ".part"
    with open(tmp, "w") as f:
        for c in cards:
            fname = c.get("_fname")
            if not fname:
                continue
            f.write(
                json.dumps(
                    {
                        "card_id": c["card_id"],
                        "name": c["name"],
                        "set_name": c["set_name"],
                        "number": c["number"],
                        "rarity": c["rarity"],
                        "type": c["type"],
                        "image_url": c.get("image_small") or c.get("image_large") or "",
                        "image_path": os.path.join(rel_prefix, "images", fname),
                    }
                )
                + "\n"
            )
            written += 1
    os.replace(tmp, manifest_path)
    return written


def download_all(
    game: str = "pokemon",
    dataset_dir: str = "/data",
    image_size: str = "small",
    api_key: str | None = None,
    limit: int | None = None,
    workers: int = 16,
) -> dict:
    """Download every card image + write the manifest. Returns a summary."""
    started = time.time()
    game_dir = os.path.join(dataset_dir, game)
    images_dir = os.path.join(game_dir, "images")
    manifest_path = os.path.join(game_dir, "manifest.jsonl")
    meta_cache = os.path.join(game_dir, "cards_meta.jsonl")
    os.makedirs(images_dir, exist_ok=True)

    # Reuse cached metadata on a re-run (idempotent, no API re-paging) unless a
    # smaller limit is requested.
    if limit is None and os.path.exists(meta_cache):
        cards = _load_meta_cache(meta_cache)
        print(f"[download] loaded {len(cards)} card metadata rows from cache")
    else:
        cards = fetch_all_metadata(
            game, api_key, limit=limit, cache_path=(meta_cache if limit is None else None)
        )
        if limit is not None:
            print(f"[download] limited to {len(cards)} cards (DOWNLOAD_LIMIT)")

    counts = download_images(cards, images_dir, image_size, workers, api_key)

    # Only manifest cards whose image is actually present on disk. Guard with
    # exists() first — getsize() raises on the paths that failed to download.
    def _on_disk(c: dict) -> bool:
        fn = c.get("_fname")
        if not fn:
            return False
        p = os.path.join(images_dir, fn)
        return os.path.exists(p) and os.path.getsize(p) > 0

    present = [c for c in cards if _on_disk(c)]
    written = write_manifest(present, manifest_path, game, game)

    summary = {
        "game": game,
        "image_size": image_size,
        "cards": len(cards),
        "downloaded": counts["ok"],
        "skipped": counts["skip"],
        "failed": counts["fail"],
        "manifest_rows": written,
        "manifest_path": manifest_path,
        "elapsed_s": round(time.time() - started, 1),
    }
    print(f"[download] DONE {summary}")
    return summary
