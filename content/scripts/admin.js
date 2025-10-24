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

// Function to format salary with proper decimal places
function formatSalary(salary) {
    // Show cents only if there are non-zero cents
    return salary % 1 === 0 ? salary.toString() : salary.toFixed(2);
}

// Function to handle CSV file upload
function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const csvText = e.target.result;
        document.getElementById('salaryData').value = csvText;
        parseAndDisplayGolfers();
    };
    reader.readAsText(file);
}

// Function to parse CSV data and convert to golfer objects
function parseCSVData(csvText) {
    const lines = csvText.trim().split('\n');
    const golfers = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Split by comma, but handle quoted names
        const match = line.match(/^"?([^"]*)"?,\s*(.+)$/) || line.match(/^([^,]+),\s*(.+)$/);
        if (match) {
            const name = match[1].trim().replace(/^"|"$/g, '');
            const salaryStr = match[2].trim().replace(/^\$/, ''); // Remove leading $ if present
            const salary = parseFloat(salaryStr);
            
            if (name && !isNaN(salary) && salary > 0) {
                golfers.push({
                    name: name,
                    salary: salary
                });
            }
        }
    }
    
    return golfers.sort((a, b) => b.salary - a.salary); // Sort by salary descending
}

// Function to parse and display current golfers
function parseAndDisplayGolfers() {
    const container = document.getElementById('currentGolfers');
    if (!container) return;

    try {
        const csvText = document.getElementById('salaryData').value;
        if (!csvText.trim()) {
            container.innerHTML = '<div class="alert alert-info">No golfers added yet</div>';
            return;
        }

        const golfers = parseCSVData(csvText);
        
        if (golfers.length === 0) {
            container.innerHTML = '<div class="alert alert-warning">No valid golfer data found</div>';
            return;
        }

        // Generate HTML for golfers
        const html = golfers.map((golfer, index) => `
            <div class="list-group-item d-flex justify-content-between align-items-center" data-index="${index}">
                <span class="flex-grow-1">${golfer.name}</span>
                <span class="badge badge-primary badge-pill mr-2">$${formatSalary(golfer.salary)}</span>
                <button type="button" class="btn btn-sm btn-outline-danger remove-golfer" 
                        onclick="removeGolferByIndex(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');

        container.innerHTML = html + `
            <div class="list-group-item bg-light">
                <small class="text-muted">Total: ${golfers.length} golfers</small>
            </div>
        `;

        document.getElementById('csvError').style.display = 'none';

    } catch (error) {
        container.innerHTML = '<div class="alert alert-danger">Error parsing golfer data</div>';
        document.getElementById('csvError').style.display = 'block';
        document.getElementById('csvError').textContent = 'Error parsing CSV data: ' + error.message;
    }
}

// Function to remove a golfer by index
function removeGolferByIndex(indexToRemove) {
    try {
        const csvText = document.getElementById('salaryData').value;
        const golfers = parseCSVData(csvText);
        
        // Remove the golfer at the specified index
        golfers.splice(indexToRemove, 1);
        
        // Convert back to CSV format
        const newCsvText = golfers.map(g => `${g.name}, ${formatSalary(g.salary)}`).join('\n');
        document.getElementById('salaryData').value = newCsvText;
        
        // Update the display
        parseAndDisplayGolfers();
    } catch (error) {
        console.error('Error removing golfer:', error);
    }
}



// Validate CSV data
function validateCSVData(csvText) {
    try {
        const golfers = parseCSVData(csvText);
        
        if (golfers.length === 0) {
            throw new Error('No valid golfer data found in CSV');
        }

        // Check for duplicate names
        const names = golfers.map(g => g.name.toLowerCase());
        const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
        if (duplicates.length > 0) {
            throw new Error(`Duplicate golfer names found: ${duplicates.join(', ')}`);
        }

        return golfers;
    } catch (error) {
        throw new Error(`Invalid CSV format: ${error.message}`);
    }
}

// Function to update save button text based on testing mode
function updateSaveButtonText() {
    const isLocalTesting = document.getElementById('localTestingMode').checked;
    const saveButtonText = document.getElementById('saveButtonText');
    
    if (isLocalTesting) {
        saveButtonText.textContent = 'Save Locally for Testing';
    } else {
        saveButtonText.textContent = 'Save Changes to GitHub';
    }
}

// Function to clear local testing data
function clearLocalTestingData() {
    if (confirm('Are you sure you want to clear all local testing data? This will reload the settings from GitHub.')) {
        localStorage.removeItem('admin_local_settings');
        localStorage.removeItem('admin_local_rankings');
        localStorage.removeItem('local_testing_settings');
        localStorage.removeItem('local_testing_rankings');
        
        // Reload settings from GitHub
        loadSettings();
        
        // Update checkbox state
        document.getElementById('localTestingMode').checked = false;
        updateSaveButtonText();
        
        // Show notification
        const statusMsg = document.getElementById('saveStatus');
        statusMsg.textContent = 'Local testing data cleared. Settings reloaded from GitHub.';
        statusMsg.style.display = 'block';
        statusMsg.style.animation = 'none';
        statusMsg.offsetHeight;
        statusMsg.style.animation = 'fadeInOut 3s ease-in-out';
        setTimeout(() => {
            statusMsg.style.display = 'none';
        }, 3000);
    }
}

// Function to load settings from JSON files or localStorage
async function loadSettings() {
    try {
        let settings, rankingsData;
        
        // Check if we have local testing data
        const localSettings = localStorage.getItem('admin_local_settings');
        const localRankings = localStorage.getItem('admin_local_rankings');
        
        if (localSettings && localRankings) {
            // Load from localStorage (local testing mode)
            settings = JSON.parse(localSettings);
            rankingsData = JSON.parse(localRankings);
            
            // Enable local testing mode checkbox
            document.getElementById('localTestingMode').checked = true;
            updateSaveButtonText();
            
            console.log('Loaded settings from local testing data');
        } else {
            // Load from GitHub (normal mode)
            const settingsResponse = await fetch('/data/settings.json?' + new Date().getTime());
            settings = await settingsResponse.json();
            
            const rankingsResponse = await fetch('/data/rankings.json?' + new Date().getTime());
            rankingsData = await rankingsResponse.json();
            
            console.log('Loaded settings from GitHub');
        }

        // Update form elements
        document.getElementById('formToggle').checked = settings.formEnabled;
        document.getElementById('hidePickSubmissionTab').checked = settings.hidePickSubmissionTab;
        document.getElementById('rankingsDate').value = settings.rankingsDate || '';
        document.getElementById('tournament').value = settings.rankingsTournament || '';
        document.getElementById('submissionSubtext').value = settings.submissionSubtext || '';
        document.getElementById('salaryCap').value = settings.salaryCap || 100;


        // Update salary data textarea
        if (rankingsData.golfers && Array.isArray(rankingsData.golfers)) {
            const csvText = rankingsData.golfers.map(g => `${g.name}, ${formatSalary(g.salary)}`).join('\n');
            document.getElementById('salaryData').value = csvText;
        } else {
            document.getElementById('salaryData').value = '';
        }
        parseAndDisplayGolfers();
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Function to save settings (either to GitHub or localStorage for testing)
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
            submissionSubtext: document.getElementById('submissionSubtext').value,
            salaryCap: parseFloat(document.getElementById('salaryCap').value)
        };

        // Prepare golfer salary data
        const csvText = document.getElementById('salaryData').value;
        let golfersData;
        try {
            const golfers = validateCSVData(csvText);
            golfersData = { golfers: golfers };
        } catch (error) {
            const errorMsg = document.getElementById('csvError');
            errorMsg.textContent = error.message;
            errorMsg.style.display = 'block';
            return;
        }

        // Check if local testing mode is enabled
        const isLocalTesting = document.getElementById('localTestingMode').checked;
        
        if (isLocalTesting) {
            // Save to localStorage for local testing
            localStorage.setItem('admin_local_settings', JSON.stringify(settings));
            localStorage.setItem('admin_local_rankings', JSON.stringify(golfersData));
            
            // Show success message for local save
            const statusMsg = document.getElementById('saveStatus');
            statusMsg.textContent = 'Changes saved locally for testing! These changes are only visible on your machine.';
            statusMsg.style.display = 'block';
            statusMsg.style.animation = 'none';
            statusMsg.offsetHeight; // Trigger reflow
            statusMsg.style.animation = 'fadeInOut 3s ease-in-out';
            setTimeout(() => {
                statusMsg.style.display = 'none';
            }, 3000);

            document.getElementById('csvError').style.display = 'none';
            parseAndDisplayGolfers();
            return;
        }

        // Original GitHub saving logic
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
                        'Authorization': `token ${sessionStorage.getItem('github_token')}`,
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
            try {
                // Convert content to UTF-8 encoded base64
                const contentStr = JSON.stringify(content, null, 2);
                const encoder = new TextEncoder();
                const data = encoder.encode(contentStr);
                const base64Content = btoa(String.fromCharCode(...new Uint8Array(data)));

                const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${sessionStorage.getItem('github_token')}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: `Update ${path}`,
                        content: base64Content,
                        sha: sha || undefined
                    })
                });

                if (!response.ok) {
                    throw new Error(`Failed to update ${path}`);
                }
            } catch (error) {
                console.error('Error saving settings:', error);
                throw error;
            }
        }

        // Update both files
        await updateGitHubFile('data/settings.json', settings);
        await updateGitHubFile('data/rankings.json', golfersData);

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

        document.getElementById('csvError').style.display = 'none';
        parseAndDisplayGolfers();
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

        // Add input listener to salary data textarea for display updates only (no autosave)
        const salaryTextarea = document.getElementById('salaryData');
        if (salaryTextarea) {
            salaryTextarea.addEventListener('input', parseAndDisplayGolfers);
        }

        // Add event listener for local testing mode checkbox
        const localTestingCheckbox = document.getElementById('localTestingMode');
        if (localTestingCheckbox) {
            localTestingCheckbox.addEventListener('change', updateSaveButtonText);
            updateSaveButtonText(); // Initialize button text
        }
    }
});

// Authentication function
async function authenticate() {
    const password = document.getElementById('password').value;
    const hashedPassword = await hashPassword(password);
    
    if (hashedPassword === ADMIN_PASSWORD_HASH) {
        sessionStorage.setItem('adminAuthenticated', 'true');
        
        // Prompt for GitHub token if not already set
        if (!sessionStorage.getItem('github_token')) {
            const token = prompt('Please enter your GitHub personal access token:');
            if (token) {
                sessionStorage.setItem('github_token', token);
            }
        }
        
        showAdminPanel();
        loadSettings();
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

// Additional event listener setup for second initialization
document.addEventListener('DOMContentLoaded', function() {
    if (isAuthenticated()) {
        showAdminPanel();

        // Add input listener to rankings JSON textarea for display updates only (no autosave)
        const rankingsTextarea = document.getElementById('rankingsJson');
        if (rankingsTextarea) {
            rankingsTextarea.addEventListener('input', displayCurrentRankings);
        }
    }
}); 