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

// Function to save settings to localStorage
function saveSettings(showMessage = false) {
    // Save form toggle and rankings info
    const formEnabled = document.getElementById('formToggle').checked;
    const rankingsDate = document.getElementById('rankingsDate').value;
    const tournament = document.getElementById('tournament').value;

    localStorage.setItem('formEnabled', formEnabled);
    localStorage.setItem('rankingsDate', rankingsDate);
    localStorage.setItem('rankingsTournament', tournament);

    // Save golfer rankings
    try {
        const jsonStr = document.getElementById('rankingsJson').value;
        const rankings = validateRankingsJson(jsonStr);
        
        // Convert to simple array of names for backward compatibility
        const namesArray = rankings.map(r => r.name);
        localStorage.setItem('golferRankings', JSON.stringify(namesArray));
        
        // Store the full rankings data in a new key
        localStorage.setItem('golferRankingsData', jsonStr);

        // Only show the status message if explicitly requested
        if (showMessage) {
            const statusMsg = document.getElementById('saveStatus');
            statusMsg.textContent = 'Settings saved successfully!';
            statusMsg.style.display = 'block';
            setTimeout(() => {
                statusMsg.style.display = 'none';
            }, 3000);
        }
        document.getElementById('jsonError').style.display = 'none';
        
        // Refresh the rankings display
        displayCurrentRankings();
    } catch (error) {
        const errorMsg = document.getElementById('jsonError');
        errorMsg.textContent = error.message;
        errorMsg.style.display = 'block';
    }
}

// Load settings from localStorage
function loadSettings() {
    // Load form toggle and rankings info
    const formEnabled = localStorage.getItem('formEnabled') === 'true';
    const rankingsDate = localStorage.getItem('rankingsDate') || '';
    const tournament = localStorage.getItem('rankingsTournament') || '';

    document.getElementById('formToggle').checked = formEnabled;
    document.getElementById('rankingsDate').value = rankingsDate;
    document.getElementById('tournament').value = tournament;

    // Load golfer rankings
    const rankingsJson = localStorage.getItem('golferRankingsData');
    if (rankingsJson) {
        document.getElementById('rankingsJson').value = rankingsJson;
        displayCurrentRankings();
    }
}

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
    loadSettings();
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
        const inputs = ['formToggle', 'rankingsDate', 'tournament', 'rankingsJson'];
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