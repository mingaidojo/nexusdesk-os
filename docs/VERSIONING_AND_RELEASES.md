# Versioning & Release Guide

Nexus Desk OS uses **Semantic Versioning (`MAJOR.MINOR.PATCH`)** paired with an **immutable frontend build stamp (`YYYYMMDD-NN`)**.

---

## 1. Version Sources

| Component | Source of Truth | Format | Where Surfaced |
| :--- | :--- | :--- | :--- |
| **Application Version** | [`VERSION`](../VERSION) | `MAJOR.MINOR.PATCH` (e.g. `2.0.0`) | FastAPI OpenAPI (`app.version`), `GET /api/version`, `GET /api/system`, UI Footer |
| **Frontend Build ID** | [`frontend/.build_version.json`](../frontend/.build_version.json) | `YYYYMMDD-NN` (e.g. `20261113-05`) | `frontend/dist/index.html` footer (`v2.0.0 • Build 20261113-05`), `GET /api/version`, `GET /api/system` |
| **Release History** | [`CHANGELOG.md`](../CHANGELOG.md) | Keep a Changelog | Human-readable release notes |

---

## 2. Checking Live Version

```bash
# CLI helper
python3 scripts/bump_version.py

# Live HTTP API
curl -s http://127.0.0.1:9200/api/version
```

Example response:
```json
{
  "name": "Nexus Desk OS",
  "version": "2.0.0",
  "build": "20261113-06"
}
```

---

## 3. Bumping Versions

Use [`scripts/bump_version.py`](../scripts/bump_version.py) so `VERSION` and the compiled frontend bundle stay synchronized:

```bash
# Bump patch release (2.0.0 -> 2.0.1) and rebuild frontend/dist/index.html
python3 scripts/bump_version.py --patch --build

# Bump minor release (2.0.1 -> 2.1.0) and rebuild frontend
python3 scripts/bump_version.py --minor --build

# Bump major release (2.1.0 -> 3.0.0) and rebuild frontend
python3 scripts/bump_version.py --major --build

# Set an explicit version
python3 scripts/bump_version.py --set 2.1.0 --build
```

Then:
1. Update [`CHANGELOG.md`](../CHANGELOG.md) with the release notes.
2. Verify no War Room is active (`curl -s "http://127.0.0.1:9200/api/war-room/state?room_id=general"`).
3. Restart the service cleanly: `./manage.sh restart`.
