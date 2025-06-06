// Simple hash function for password verification
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Admin password hash
const ADMIN_PASSWORD_HASH = '9c8f4559260f6b52921c4b45428cc0b07dce630a38dd25d5d2a63e752621761a';

// Function to display current rankings
function displayCurrentRankings() {
    const rankingsContainer = document.getElementById('currentRankings');
    if (!rankingsContainer) return;

    try {
        const jsonStr = document.getElementById('rankingsJson').value;
        const data = JSON.parse(jsonStr);
        const rankings = data.rankings || data;

        if (!Array.isArray(rankings)) {
            rankingsContainer.innerHTML = '<div class="alert alert-info">No rankings available</div>';
            return;
        }

        // Sort rankings by rank and filter for top 100
        const topRankings = rankings
            .filter(golfer => golfer.ranking <= 100)
            .sort((a, b) => a.ranking - b.ranking);

        // Generate HTML for rankings
        const html = topRankings.map(golfer => `
            <div class="list-group-item d-flex justify-content-between align-items-center" data-ranking="${golfer.ranking}">
                <span class="mr-2">${golfer.ranking}.</span>
                <span class="flex-grow-1">${golfer.fullName || golfer.name}</span>
                <button type="button" class="btn btn-sm btn-danger remove-golfer" 
                        onclick="removeGolfer(${golfer.ranking})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');

        rankingsContainer.innerHTML = html || '<div class="alert alert-info">No rankings available</div>';

    } catch (error) {
        rankingsContainer.innerHTML = '<div class="alert alert-danger">Error displaying rankings</div>';
    }
}

// Function to remove a golfer
function removeGolfer(rankingToRemove) {
    try {
        const jsonStr = document.getElementById('rankingsJson').value;
        const data = JSON.parse(jsonStr);
        const rankings = data.rankings || data;

        if (!Array.isArray(rankings)) return;

        // Remove the golfer with the specified ranking
        const updatedRankings = rankings.filter(golfer => golfer.ranking !== rankingToRemove);

        // Update the textarea with new rankings - no need to adjust other rankings
        const updatedData = data.rankings ? { ...data, rankings: updatedRankings } : updatedRankings;
        document.getElementById('rankingsJson').value = JSON.stringify(updatedData, null, 2);

        // Auto-save the changes
        saveSettings(true);
    } catch (error) {
        console.error('Error removing golfer:', error);
    }
}

// Validate and parse rankings JSON
function validateRankingsJson(jsonStr) {
    try {
        const data = JSON.parse(jsonStr);
        
        // Check if it's the new format with "rankings" array
        const rankings = data.rankings || data;
        
        // Validate that it's an array
        if (!Array.isArray(rankings)) {
            throw new Error('Input must be an array or an object with a rankings array.');
        }

        // Validate each entry
        rankings.forEach((entry, index) => {
            // Check for required fields
            if (!entry.name || !entry.ranking || 
                typeof entry.name !== 'string' || 
                typeof entry.ranking !== 'number') {
                throw new Error(`Invalid entry at position ${index}: missing required fields (name and ranking)`);
            }
        });

        // Sort by ranking
        return rankings.sort((a, b) => a.ranking - b.ranking);
    } catch (error) {
        throw new Error(`Invalid JSON format: ${error.message}`);
    }
}

// Function to load settings from JSON files
async function loadSettings() {
    try {
        // Load settings
        const settingsResponse = await fetch('/data/settings.json?' + new Date().getTime());
        const settings = await settingsResponse.json();
        
        // Load rankings
        const rankingsResponse = await fetch('/data/rankings.json?' + new Date().getTime());
        const rankingsData = await rankingsResponse.json();

        // Update form elements
        document.getElementById('formToggle').checked = settings.formEnabled;
        document.getElementById('hidePickSubmissionTab').checked = settings.hidePickSubmissionTab;
        document.getElementById('rankingsDate').value = settings.rankingsDate || '';
        document.getElementById('tournament').value = settings.rankingsTournament || '';
        document.getElementById('submissionSubtext').value = settings.submissionSubtext || '';

        // Update rankings textarea
        document.getElementById('rankingsJson').value = JSON.stringify(rankingsData, null, 2);
        displayCurrentRankings();
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Function to save settings using GitHub API
async function saveSettings(showMessage = false) {
    if (!isAuthenticated()) {
        console.error('Not authenticated');
        return;
    }

    try {
        // Prepare settings data
        const settings = {
            formEnabled: document.getElementById('formToggle').checked,
            hidePickSubmissionTab: document.getElementById('hidePickSubmissionTab').checked,
            rankingsDate: document.getElementById('rankingsDate').value,
            rankingsTournament: document.getElementById('tournament').value,
            submissionSubtext: document.getElementById('submissionSubtext').value
        };

        // Prepare rankings data
        const rankingsJson = document.getElementById('rankingsJson').value;
        let rankingsData;
        try {
            rankingsData = JSON.parse(rankingsJson);
            validateRankingsJson(rankingsJson);
        } catch (error) {
            const errorMsg = document.getElementById('jsonError');
            errorMsg.textContent = error.message;
            errorMsg.style.display = 'block';
            return;
        }

        // Create commits using GitHub API
        const token = sessionStorage.getItem('github_token');
        if (!token) {
            throw new Error('GitHub token not found. Please log in again.');
        }

        // Function to create/update file in GitHub
        async function updateGitHubFile(path, content) {
            // Get current file SHA (if it exists)
            const repo = 'swyse5/swyse5.github.io';
            let sha = '';
            try {
                const fileResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                if (fileResponse.ok) {
                    const fileData = await fileResponse.json();
                    sha = fileData.sha;
                }
            } catch (error) {
                console.log('File might not exist yet:', error);
            }

            // Create/update file
            const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Update ${path}`,
                    content: btoa(JSON.stringify(content, null, 2)),
                    sha: sha || undefined
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to update ${path}`);
            }
        }

        // Update both files
        await updateGitHubFile('data/settings.json', settings);
        await updateGitHubFile('data/rankings.json', rankingsData);

        // Show success message
        const statusMsg = document.getElementById('saveStatus');
        statusMsg.textContent = 'Changes saved successfully! The site will update in a few minutes.';
        statusMsg.style.display = 'block';
        statusMsg.style.animation = 'none';
        statusMsg.offsetHeight; // Trigger reflow
        statusMsg.style.animation = 'fadeInOut 3s ease-in-out';
        setTimeout(() => {
            statusMsg.style.display = 'none';
        }, 3000);

        document.getElementById('jsonError').style.display = 'none';
        displayCurrentRankings();
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Error saving changes. Please check the console for details.');
    }
}

// Function to authenticate with GitHub
async function authenticateWithGitHub() {
    const clientId = 'YOUR_GITHUB_CLIENT_ID'; // You'll need to create this
    const redirectUri = window.location.origin + '/admin.html';
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=repo`;
}

// Check for GitHub authentication callback
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
        // Exchange code for token (this needs a backend service)
        // For now, you'll need to manually add a personal access token
        // We'll use a temporary solution where you paste your token
        if (!sessionStorage.getItem('github_token')) {
            const token = prompt('Please enter your GitHub personal access token:');
            if (token) {
                sessionStorage.setItem('github_token', token);
            }
        }
    }

    if (isAuthenticated()) {
        showAdminPanel();
        loadSettings();

        // Add change listeners for auto-save
        const inputs = ['formToggle', 'hidePickSubmissionTab', 'rankingsDate', 'tournament', 'rankingsJson', 'submissionSubtext'];
        inputs.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                const eventType = element.tagName === 'TEXTAREA' ? 'input' : 'change';
                element.addEventListener(eventType, () => saveSettings());
            }
        });

        // Add input listener to rankings JSON textarea for display updates
        const rankingsTextarea = document.getElementById('rankingsJson');
        if (rankingsTextarea) {
            rankingsTextarea.addEventListener('input', displayCurrentRankings);
        }
    }
});

// Authentication function
async function authenticate() {
    const password = document.getElementById('password').value;
    const hashedPassword = await hashPassword(password);
    
    if (hashedPassword === ADMIN_PASSWORD_HASH) {
        sessionStorage.setItem('adminAuthenticated', 'true');
        showAdminPanel();
    } else {
        document.getElementById('loginError').style.display = 'block';
        document.getElementById('password').value = '';
    }
}

// Show admin panel
function showAdminPanel() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
}

// Check if user is authenticated
function isAuthenticated() {
    return sessionStorage.getItem('adminAuthenticated') === 'true';
}

// Logout function
function logout() {
    sessionStorage.removeItem('adminAuthenticated');
    location.reload();
}

// Add event listener for JSON changes
document.addEventListener('DOMContentLoaded', function() {
    if (isAuthenticated()) {
        showAdminPanel();

        // Add change listeners for auto-save
        const inputs = ['formToggle', 'rankingsDate', 'tournament', 'rankingsJson', 'submissionSubtext'];
        inputs.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                // Use input event for textarea to catch all changes
                const eventType = element.tagName === 'TEXTAREA' ? 'input' : 'change';
                element.addEventListener(eventType, () => saveSettings());
            }
        });

        // Add input listener to rankings JSON textarea for display updates
        const rankingsTextarea = document.getElementById('rankingsJson');
        if (rankingsTextarea) {
            rankingsTextarea.addEventListener('input', displayCurrentRankings);
        }
    }
}); 