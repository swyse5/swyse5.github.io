# Majors Best Ball - Setup Guide

This application allows you to run your fantasy golf best ball league entirely through a web application, with automatic scoring from ESPN.

## Features

- **Google Sign-in**: Users authenticate with their Google account
- **Lineup Submission**: Pick 4 golfers within a salary cap
- **Live Scoring**: Automatic score updates from ESPN every 10 minutes
- **Best Ball Calculation**: Automatic best ball scoring across all 4 rounds
- **Real-time Leaderboard**: Live standings with expandable golfer details
- **Scorecard View**: Detailed hole-by-hole best ball scores
- **Admin Panel**: Create tournaments, manage golfer fields, control scoring

## Setup Instructions

### Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add Project" and follow the setup wizard
3. Name it something like "majors-best-ball"

### Step 2: Enable Authentication

1. In Firebase Console, go to **Authentication** → **Sign-in method**
2. Enable **Google** as a sign-in provider
3. Add your domain to authorized domains:
   - `localhost` (for testing)
   - `swyse5.github.io` (your production domain)

### Step 3: Create Firestore Database

1. Go to **Firestore Database** → **Create database**
2. Choose **Start in production mode**
3. Select a region close to your users

### Step 4: Set Up Security Rules

In Firestore, go to **Rules** and paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Anyone can read tournaments, only admins can write
    match /tournaments/{tournamentId} {
      allow read: if true;
      allow write: if request.auth != null && 
        get(/databases/$(database)/documents/config/admins).data.emails.hasAny([request.auth.token.email]);
    }
    
    // Users can read all lineups, but only write their own
    match /lineups/{lineupId} {
      allow read: if true;
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      allow update: if request.auth != null && resource.data.userId == request.auth.uid;
    }
    
    // Anyone can read scores
    match /scores/{tournamentId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    // Config is readable by all, writable by admins
    match /config/{docId} {
      allow read: if true;
      allow write: if request.auth != null && 
        (docId == 'admins' && get(/databases/$(database)/documents/config/admins).data.emails.hasAny([request.auth.token.email]));
    }
  }
}
```

### Step 5: Get Firebase Config

1. In Firebase Console, go to **Project Settings** (gear icon)
2. Scroll to "Your apps" and click **Add app** → **Web**
3. Register the app (no need for hosting)
4. Copy the `firebaseConfig` object

### Step 6: Update Firebase Config

Edit `js/firebase-config.js` and replace the placeholder values:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_ACTUAL_API_KEY",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

### Step 7: Test Locally First

Before deploying to production, test everything locally:

1. **Start a local server** (from your project directory):
   ```bash
   # Using Python
   python -m http.server 8080
   
   # Or using Node.js
   npx serve -p 8080
   ```

2. **Open in browser**: `http://localhost:8080/app.html`

3. **Test the full flow**:
   - Sign in with Google
   - Go to `http://localhost:8080/tournament-admin.html` to create a test tournament
   - Submit a lineup
   - Test the leaderboard and scorecard views

4. **Important**: Make sure `localhost` is in your Firebase authorized domains (Step 2)

### Step 8: Deploy to GitHub Pages (When Ready)

Once you've tested thoroughly:

1. Create a feature branch for safety:
   ```bash
   git checkout -b feature/new-app
   git add .
   git commit -m "Add new best ball application"
   git push -u origin feature/new-app
   ```

2. Test on the branch if you want (won't affect main site)

3. When ready to go live, merge to main:
   ```bash
   git checkout main
   git merge feature/new-app
   git push
   ```

4. GitHub Pages will automatically deploy

**Note**: The new app is at `app.html`, so your existing `index.html` site remains untouched until you decide to replace it.

### Step 9: Initial Admin Setup

1. Visit your app (locally: `http://localhost:8080/tournament-admin.html`)
2. Sign in with Google
3. The first user to sign in becomes an admin automatically
4. Add additional admin emails in the Admin Users section

## Usage

### Creating a Tournament

1. Go to Tournament Admin
2. Fill in tournament details:
   - **Tournament Name**: e.g., "Masters 2026"
   - **ESPN Event Name**: Use keywords like "masters", "pga championship", "us open", "the open"
   - **Dates**: Tournament start and end dates
   - **Salary Cap**: Budget for picking 4 golfers
   - **Golfer Field**: Paste golfers in format `Name $Salary`

3. Set status:
   - **Upcoming**: Hidden from users
   - **Lineup Open**: Users can submit lineups
   - **In Progress**: Tournament is live, scoring active
   - **Completed**: Tournament finished

### Managing Live Scoring

1. In Tournament Admin, go to "Live Scoring"
2. Select the tournament
3. Click "Start Auto-Update" for automatic 10-minute updates
4. Or use "Update Now" for manual refresh

### ESPN Event Names

Use these keywords to match ESPN tournaments:
- Masters: `masters`
- PGA Championship: `pga championship`
- US Open: `us open`
- The Open Championship: `the open` or `british open`

## File Structure

```
├── app.html              # Main application
├── tournament-admin.html # Admin panel
├── css/
│   └── app.css          # Application styles
├── js/
│   ├── firebase-config.js
│   ├── auth.js
│   ├── scoring.js
│   ├── lineup.js
│   ├── leaderboard.js
│   └── app.js
└── SETUP.md             # This file
```

## Troubleshooting

### "Access Denied" on Admin Page
- Make sure your email is in the admin list
- Check that you're signed in with the correct Google account

### Scores Not Updating
- Verify the ESPN event name matches an active tournament
- Check browser console for errors
- ESPN only provides scores for in-progress tournaments

### CORS Errors
- The ESPN API is public and should work without CORS issues
- If problems persist, check browser extensions that might block requests

## Support

For issues or questions, create a GitHub issue on the repository.
