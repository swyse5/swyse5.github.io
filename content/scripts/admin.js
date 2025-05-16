// Simple hash function for password verification
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Admin password hash (you should change this to your desired password's hash)
const ADMIN_PASSWORD_HASH = '9c8f4559260f6b52921c4b45428cc0b07dce630a38dd25d5d2a63e752621761a';

// Check if user is authenticated
function isAuthenticated() {
    return sessionStorage.getItem('adminAuthenticated') === 'true';
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

// Logout function
function logout() {
    sessionStorage.removeItem('adminAuthenticated');
    location.reload();
}

// Save settings to localStorage
function saveSettings() {
    const formEnabled = document.getElementById('formToggle').checked;
    const rankingsDate = document.getElementById('rankingsDate').value;
    const tournament = document.getElementById('tournament').value;

    localStorage.setItem('formEnabled', formEnabled);
    localStorage.setItem('rankingsDate', rankingsDate);
    localStorage.setItem('rankingsTournament', tournament);

    // Update the status message
    const statusMsg = document.getElementById('saveStatus');
    statusMsg.textContent = 'Settings saved successfully!';
    statusMsg.style.display = 'block';
    setTimeout(() => {
        statusMsg.style.display = 'none';
    }, 3000);
}

// Load settings from localStorage
function loadSettings() {
    const formEnabled = localStorage.getItem('formEnabled') === 'true';
    const rankingsDate = localStorage.getItem('rankingsDate') || '';
    const tournament = localStorage.getItem('rankingsTournament') || '';

    document.getElementById('formToggle').checked = formEnabled;
    document.getElementById('rankingsDate').value = rankingsDate;
    document.getElementById('tournament').value = tournament;
}

// Show admin panel
function showAdminPanel() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    loadSettings();
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', function() {
    if (isAuthenticated()) {
        showAdminPanel();
    }
}); 