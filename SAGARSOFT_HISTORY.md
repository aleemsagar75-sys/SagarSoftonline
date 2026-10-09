## 2026-10-09 — Professional Institute Profile + Code Organization

### Objective
Upgrade Institute Profile to a professional two-column (form + sticky live preview) UI, organize the dashboard route blocks with section banners, remove verified-dead/duplicate code, update asset versions to 20261009, and ship with clean JS syntax and documented history.

### Work Completed
- Replaced the old single-panel Institute Profile block with a premium two-panel layout: School Identity, Contact Information, Registration Information, Address Information, Save/Update actions, and a sticky live preview (uses existing `ip-*` CSS design system). 
- Added reusable JS helpers (`_ipToast`, `_ipMarkDirty`, `_ipSetLogo`, `renderProfilePreview`) with proper guards; kept save/write logic identical in behavior (writes `school_settings.instituteProfile` and `accountSettings` via `saveDatabase`, calls `saveProfileToServer`, refreshes top-profile identity, adds spinner/toast feedback).
- Restored lost `.view.module--institute-profile` class toggle (v190-era) and integrated description via new `#moduleSectionDesc` in the section header.
- Inserted section banners (e.g. `GENERAL SETTINGS — INSTITUTE PROFILE`, grouped family banners) for top-level route blocks (54 route blocks) to improve readability.
- Removed verified-dead WhatsApp locals (`studentSuggestions`, `employeeSuggestions`) that were unused after refactor; verified no other zero-reference top-level deletions.
- Added CSS: `.section-desc`, sticky preview (`.ip-layout__preview`), institute-profile scroll constraints, responsive tweaks (≤1024), `.ip-save-bar__left[hidden]`.
- Updated HTML: `#moduleSectionDesc` in section-head; css/js queries `?v=20261009`.
- Updated `sw.js`: precache css/js to `?v=20261009`; `CACHE="sagarsoft-v194"` unchanged.
- Deleted unreferenced `js/dashboard.js.bak`; JS syntax passes `node --check js/dashboard.js`.

### Files Changed
- css/dashboard.css
- dashboard.html
- js/dashboard.js (major structural edits + banners + new institute block)
- sw.js
- SAGARSOFT_HISTORY.md (this entry)

### Database Changes
- None.

### Testing
- `node --check js/dashboard.js` → PASS.
- Static verification: anchors present, preview renderer exists, toast/logos helpers present, no `instituteLogoPreview` references, WhatsApp dead locals removed, banners inserted, version queries updated.

### Git Commit
- (to follow) `feat: professional institute profile and code organization`

### Deployment
- (to follow) push to `main` and verify Render deployment serving `?v=20261009`.

### Known Issues
- Sticky preview height depends on browser viewport; tested via static CSS only (no browser automation available).
- Global FFRE replacement noise (14) in some legacy strings remains (non-functional, cosmetic).

---