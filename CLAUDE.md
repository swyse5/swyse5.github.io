# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A static GitHub Pages site for a fantasy golf league ("Majors Best Ball"). Users submit golfer picks for major tournaments (Masters, PGA Championship, US Open, Open Championship) with a salary cap system. There is also an admin page for the commissioner to manage settings.

## Development

No build system or package manager — this is a pure static site. Open `index.html` directly in a browser or serve with any static file server:

```bash
python3 -m http.server 8000
```

CSS is compiled from SCSS, but the compiled `content/styles/styles.css` is committed directly. The SCSS source is in `content/styles/` with `styles.scss` as the entry point importing partials from `global/`, `base/`, and `elements/` subdirectories.

The `content/scripts/scripts.js` file (gitignored) is generated/bundled — do not edit or commit it directly.

## Architecture

### Data Flow

Settings and golfer salary data live in `data/settings.json` and `data/rankings.json`. These files are:
- **Read** by the frontend via `fetch('/data/settings.json')` and `fetch('/data/rankings.json')`
- **Written** by the admin panel via the GitHub Contents API (`PUT https://api.github.com/repos/swyse5/swyse5.github.io/contents/data/...`) using a GitHub token stored in `sessionStorage`
- **Overridden locally** for testing via `localStorage` keys `admin_local_settings` and `admin_local_rankings` (the "Local Testing Mode" toggle in admin)

### Key Files

- `index.html` — main page with Bootstrap 4 tab navigation (Pick Submission, tournament leaderboards via Google Sheets iframes, League History, Rules)
- `admin.html` — commissioner admin panel; password-protected via SHA-256 hash in `admin.js`; saves to GitHub API or localStorage
- `content/scripts/form-handler.js` — loads settings/rankings, toggles form enabled state, controls tab visibility
- `content/scripts/golfer-rankings.js` — populates golfer select dropdowns, implements searchable dropdown UI, prevents duplicate golfer selection
- `content/scripts/salary-calculator.js` — tracks salary cap budget as golfers are selected (4 golfers per submission)
- `content/scripts/admin.js` — admin authentication, settings load/save, CSV/manual golfer data entry, GitHub API writes
- `content/scripts/league-history.js` — loads all-time leaderboard data for the League History tab

### Data Formats

`data/rankings.json`:
```json
{ "golfers": [{ "name": "Last, First", "salary": 40 }] }
```
Golfer names in `rankings.json` may be in "Last, First" format. `convert_names.py` is a CLI utility to convert "Last, First" → "First Last" format when preparing data.

`data/settings.json`:
```json
{
  "formEnabled": true,
  "hidePickSubmissionTab": true,
  "rankingsDate": "2026-01-19",
  "rankingsTournament": "Open Championship",
  "submissionSubtext": "Text displayed on form",
  "salaryCap": 100
}
```
Note: `hidePickSubmissionTab: true` means the tab **is shown** (inverted naming).

### External Dependencies

- Bootstrap 4.2.1 (CDN) + jQuery 3.6.0 (CDN)
- Font Awesome 5.15.4 (CDN)
- Formspree (`https://formspree.io/f/xvgadzdo`) for pick submission emails
- Google Sheets iframes for tournament leaderboards
- GitHub Contents API for admin data persistence

### Admin Authentication

Password is verified client-side via SHA-256 hash stored in `admin.js` (`ADMIN_PASSWORD_HASH`). GitHub token is stored in `sessionStorage` after login and used for API calls to update data files.
